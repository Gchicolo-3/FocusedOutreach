// lib/ms/config.ts
// Microsoft identity platform + Graph configuration. All secrets come from
// env; the redirect URI is derived from the request origin so the same code
// works on prod and preview deployments (register the prod URL in Azure).

export const MS_SCOPES = [
  'offline_access',
  'openid',
  'email',
  'User.Read',
  'Mail.ReadWrite', // create drafts in George's mailbox
  'Mail.Read', // poll the inbox for replies
];

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export function msTenant(): string {
  return process.env.MS_TENANT_ID || 'common';
}

export function authorizeEndpoint(): string {
  return `https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/authorize`;
}

export function tokenEndpoint(): string {
  return `https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0/token`;
}

export function msClientId(): string {
  const id = process.env.MS_CLIENT_ID;
  if (!id) throw new Error('MS_CLIENT_ID is not configured');
  return id;
}

export function msClientSecret(): string {
  const secret = process.env.MS_CLIENT_SECRET;
  if (!secret) throw new Error('MS_CLIENT_SECRET is not configured');
  return secret;
}

// Redirect URI must byte-match what's registered in the Azure app. Prefer an
// explicit override; otherwise derive from the incoming request's origin.
export function redirectUri(request: Request): string {
  if (process.env.MS_REDIRECT_URI) return process.env.MS_REDIRECT_URI;
  const host = request.headers.get('host');
  const proto = host && host.startsWith('localhost') ? 'http' : 'https';
  const origin = host ? `${proto}://${host}` : new URL(request.url).origin;
  return `${origin}/api/outlook/callback`;
}

// Secret used to HMAC-sign the OAuth `state` param (CSRF). Falls back to
// CRON_SECRET so there's one fewer env var to set.
export function stateSecret(): string {
  const s = process.env.MS_OAUTH_STATE_SECRET || process.env.CRON_SECRET;
  if (!s) throw new Error('MS_OAUTH_STATE_SECRET or CRON_SECRET must be set');
  return s;
}
