// lib/ms/tokenStore.ts
// Server-only persistence for the connected Microsoft account's tokens.
// Uses the Supabase service-role key so it works regardless of RLS.

import { type SupabaseClient } from '@supabase/supabase-js';
import { getServerSupabase } from '@/lib/serverSupabase';

const ROW_ID = 'default';

export type MsToken = {
  access_token: string;
  refresh_token: string | null;
  expires_at: string; // ISO
  account_email: string | null;
  scope: string | null;
};

function db(): SupabaseClient {
  return getServerSupabase();
}

export async function getStoredToken(): Promise<MsToken | null> {
  const { data, error } = await db()
    .from('ms_oauth_tokens')
    .select('access_token, refresh_token, expires_at, account_email, scope')
    .eq('id', ROW_ID)
    .maybeSingle();
  if (error) {
    console.error('[ms] getStoredToken:', error.message);
    return null;
  }
  return (data as MsToken) || null;
}

export async function saveToken(token: MsToken): Promise<void> {
  const { error } = await db()
    .from('ms_oauth_tokens')
    .upsert({ id: ROW_ID, ...token, updated_at: new Date().toISOString() });
  if (error) throw new Error(`saveToken: ${error.message}`);
}

export async function clearToken(): Promise<void> {
  await db().from('ms_oauth_tokens').delete().eq('id', ROW_ID);
}
