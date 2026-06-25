import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// True only when both env vars are present. Components surface this so an
// empty-looking app reads as "not connected" instead of silently showing 0.
export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);

if (!supabaseConfigured && typeof window !== 'undefined') {
  console.error(
    '[supabase] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Data will not load. Set these in your deployment environment.'
  );
}

// Fall back to harmless placeholders so createClient() never throws at import
// time during build; runtime calls will fail clearly and supabaseConfigured is false.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseKey || 'placeholder-anon-key'
);
