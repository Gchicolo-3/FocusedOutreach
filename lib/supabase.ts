import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazily construct the client on first use. Building the client at module load
// caused "supabaseUrl is required" crashes during Next.js's build-time
// prerender of the client components that import it. The Proxy keeps every
// existing `supabase.from(...)` call site unchanged.
let _client: SupabaseClient | null = null;
function getClient(): SupabaseClient {
  if (_client) return _client;
  _client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return _client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const client = getClient() as unknown as Record<string | symbol, unknown>;
    const value = client[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
