// lib/engine/auth.ts
// Shared auth gate for the engine API routes. All of them carry contact PII
// (names, phones, notes) or mutate state, so every route requires the same
// Bearer secret the cron uses. Browser clients must never hold this secret;
// dashboard features go through a server-side proxy route that injects it
// (see app/api/engine/trigger/route.ts for the pattern).

export function isEngineRequestAuthorized(request: Request): boolean {
  // Outside production (local dev, previews without the secret) stay open so
  // the engine can be exercised without env setup — same policy the run
  // route has always had.
  if (process.env.NODE_ENV !== 'production') return true;

  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}
