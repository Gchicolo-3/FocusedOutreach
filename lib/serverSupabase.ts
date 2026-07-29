// lib/serverSupabase.ts
// The one Supabase client for server-side code (API routes, engine, ms/*).
//
// Uses the service-role key, which bypasses RLS. With RLS enabled on the
// contact tables, falling back to the anon key would not fail loudly — reads
// silently return zero rows — so in production a missing service key is a
// hard error instead of a silent empty dashboard/cadence run. Outside
// production the anon fallback is kept so local dev works without secrets
// (RLS is the deployed project's concern).
//
// Lazily constructed: building at module load runs during Next.js's
// build-time page-data collection where env vars may be absent.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getServerSupabase(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SUPABASE_SERVICE_ROLE_KEY is not set. Server code refuses the anon-key ' +
          'fallback in production: with RLS enabled it would silently read zero rows.'
      );
    }
    _client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    return _client;
  }

  _client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
