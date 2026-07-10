// lib/ms/graph.ts
// OAuth code/refresh exchange, token persistence, and an authenticated Graph
// fetch that transparently refreshes an expiring or rejected access token.

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  GRAPH_BASE,
  MS_SCOPES,
  authorizeEndpoint,
  msClientId,
  msClientSecret,
  redirectUri,
  stateSecret,
  tokenEndpoint,
} from './config';
import { getStoredToken, saveToken, type MsToken } from './tokenStore';

export class NotConnectedError extends Error {
  constructor() {
    super('Microsoft account is not connected');
    this.name = 'NotConnectedError';
  }
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  scope?: string;
};

// ---- OAuth state (CSRF): HMAC-signed "<nonce>.<issuedAtMs>.<sig>" ----

export function makeState(): string {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const payload = `${nonce}.${Date.now()}`;
  const sig = createHmac('sha256', stateSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyState(state: string | null, maxAgeMs = 10 * 60 * 1000): boolean {
  if (!state) return false;
  const parts = state.split('.');
  if (parts.length !== 3) return false;
  const [nonce, issued, sig] = parts;
  const expected = createHmac('sha256', stateSecret()).update(`${nonce}.${issued}`).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const age = Date.now() - Number(issued);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}

export function buildAuthorizeUrl(request: Request, state: string): string {
  const params = new URLSearchParams({
    client_id: msClientId(),
    response_type: 'code',
    redirect_uri: redirectUri(request),
    response_mode: 'query',
    scope: MS_SCOPES.join(' '),
    state,
  });
  return `${authorizeEndpoint()}?${params.toString()}`;
}

// ---- Token exchange / refresh ----

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `token endpoint ${res.status}: ${data.error || ''} ${data.error_description || ''}`.trim()
    );
  }
  return data as TokenResponse;
}

function toStoredToken(t: TokenResponse, fallbackRefresh: string | null, email: string | null): MsToken {
  return {
    access_token: t.access_token,
    // Azure rotates refresh tokens; keep the previous one if a refresh
    // response omits it.
    refresh_token: t.refresh_token || fallbackRefresh,
    expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
    account_email: email,
    scope: t.scope || MS_SCOPES.join(' '),
  };
}

async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${GRAPH_BASE}/me?$select=mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const me = await res.json();
    return me.mail || me.userPrincipalName || null;
  } catch {
    return null;
  }
}

// Exchange an authorization code for tokens and persist them.
export async function exchangeCodeAndStore(request: Request, code: string): Promise<MsToken> {
  const t = await postToken({
    client_id: msClientId(),
    client_secret: msClientSecret(),
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(request),
    scope: MS_SCOPES.join(' '),
  });
  const email = await fetchAccountEmail(t.access_token);
  const stored = toStoredToken(t, null, email);
  await saveToken(stored);
  return stored;
}

async function refreshAndStore(current: MsToken): Promise<MsToken> {
  if (!current.refresh_token) throw new NotConnectedError();
  const t = await postToken({
    client_id: msClientId(),
    client_secret: msClientSecret(),
    grant_type: 'refresh_token',
    refresh_token: current.refresh_token,
    scope: MS_SCOPES.join(' '),
  });
  const stored = toStoredToken(t, current.refresh_token, current.account_email);
  await saveToken(stored);
  return stored;
}

// Return a valid access token, refreshing if it's expired/near-expiry.
export async function getValidAccessToken(): Promise<string> {
  const current = await getStoredToken();
  if (!current) throw new NotConnectedError();
  const expiresSoon = new Date(current.expires_at).getTime() - Date.now() < 5 * 60 * 1000;
  if (!expiresSoon) return current.access_token;
  const refreshed = await refreshAndStore(current);
  return refreshed.access_token;
}

// ---- Authenticated Graph fetch (one automatic refresh on 401) ----

export async function graphFetch(
  path: string,
  init: RequestInit = {},
  retriedAfterRefresh = false
): Promise<Response> {
  const token = await getValidAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${GRAPH_BASE}${path}`, { ...init, headers });

  if (res.status === 401 && !retriedAfterRefresh) {
    const current = await getStoredToken();
    if (current) {
      await refreshAndStore(current);
      return graphFetch(path, init, true);
    }
  }
  return res;
}
