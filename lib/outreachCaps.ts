// THE shared config object for daily outreach volume (Amendment 1, Aug 2026).
// Both the warm cadence cap and the cold pipeline cap read from here so the
// two can never live as separate constants in two files and combine past
// dailyTotal. Values persist in the app_settings table (key 'outreach_caps')
// and are editable from the UI without a deploy; these are only the defaults
// and the math.
//
// George's capacity: 20 touches per day across all types, 5-10 of them cold,
// warm capped at 12. When cold sourcing uses its allowance, warm yields:
// warmAllowance = min(warmDaily, dailyTotal - coldUsedToday).

export type OutreachCaps = {
  dailyTotal: number;
  warmDaily: number;
  coldDaily: number;
};

export const OUTREACH_CAPS_KEY = 'outreach_caps';

export const DEFAULT_CAPS: OutreachCaps = { dailyTotal: 20, warmDaily: 12, coldDaily: 8 };

// Hard bounds. Cold is 0-10 (0 pauses the cold pipeline; 10 is the ceiling
// George set). Warm and total protect against a fat-fingered setting turning
// the cap back into an unbounded queue.
const BOUNDS = {
  dailyTotal: { min: 1, max: 40 },
  warmDaily: { min: 0, max: 20 },
  coldDaily: { min: 0, max: 10 },
} as const;

function clamp(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

// Tolerates missing keys, strings, floats, and out-of-range values from the
// jsonb column; always returns a usable caps object.
export function normalizeCaps(raw: unknown): OutreachCaps {
  const r = (raw || {}) as Record<string, unknown>;
  const caps = {
    dailyTotal: clamp(r.daily_total ?? r.dailyTotal, BOUNDS.dailyTotal.min, BOUNDS.dailyTotal.max, DEFAULT_CAPS.dailyTotal),
    warmDaily: clamp(r.warm_daily ?? r.warmDaily, BOUNDS.warmDaily.min, BOUNDS.warmDaily.max, DEFAULT_CAPS.warmDaily),
    coldDaily: clamp(r.cold_daily ?? r.coldDaily, BOUNDS.coldDaily.min, BOUNDS.coldDaily.max, DEFAULT_CAPS.coldDaily),
  };
  // Neither lane may exceed the day's total on its own.
  caps.warmDaily = Math.min(caps.warmDaily, caps.dailyTotal);
  caps.coldDaily = Math.min(caps.coldDaily, caps.dailyTotal);
  return caps;
}

// jsonb shape stored in app_settings (snake_case, matching the seed row).
export function capsToJson(caps: OutreachCaps): Record<string, number> {
  const c = normalizeCaps(caps);
  return { daily_total: c.dailyTotal, warm_daily: c.warmDaily, cold_daily: c.coldDaily };
}

// How many warm touches the cadence manager may flag today, given how much
// of the day's total the cold pipeline has already claimed.
export function warmAllowance(caps: OutreachCaps, coldUsedToday: number): number {
  const used = Math.max(0, Math.round(Number(coldUsedToday)) || 0);
  return Math.max(0, Math.min(caps.warmDaily, caps.dailyTotal - used));
}
