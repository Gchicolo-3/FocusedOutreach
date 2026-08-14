// One-shot (but idempotent, re-runnable) backfill for the canonical contact
// identity system:
//   1. Stamps canonical_key on every brokers/partners/prospects/cold_brokers row.
//   2. Resolves every activities row against the contact tables using
//      lib/identity.ts and writes contact_table/contact_id/match_status/
//      match_method/match_confidence/match_candidates/canonical_key.
//   3. Prints a resolution report.
//
// Run:
//   SUPABASE_URL=... SUPABASE_KEY=... \
//     node --experimental-strip-types scripts/backfill-contact-identity.ts [--dry-run]
//
// Uses only REST reads/writes, no schema changes — the schema comes from
// db/migrations/2026-08-13-contact-identity.sql.

import { createClient } from '@supabase/supabase-js';
import {
  buildContactIndex,
  canonicalKey,
  contactRefFromRow,
  resolveContact,
  type ContactRef,
  type ContactTable,
} from '../lib/identity.ts';

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key =
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_KEY (or the NEXT_PUBLIC_ equivalents).');
  process.exit(1);
}
const dryRun = process.argv.includes('--dry-run');
const supabase = createClient(url, key);

const PAGE = 1000;

async function fetchAll(table: string, columns: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data || []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < PAGE) return rows;
  }
}

async function upsertBatches(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string
): Promise<void> {
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const { error } = await supabase.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

const CONTACT_SELECTS: Record<ContactTable, string> = {
  brokers: 'id, first_name, last_name, firm, email, canonical_key',
  partners: 'id, first_name, last_name, company, email, canonical_key',
  prospects: 'id, contact, company, email, canonical_key',
  cold_brokers: 'id, name, firm, email, canonical_key',
};

async function main() {
  // ---- 1. contact tables: stamp canonical_key ----
  const allRefs: ContactRef[] = [];
  for (const table of Object.keys(CONTACT_SELECTS) as ContactTable[]) {
    const rows = await fetchAll(table, CONTACT_SELECTS[table]);
    const updates: Record<string, unknown>[] = [];
    for (const row of rows) {
      const ref = contactRefFromRow(table, row);
      if (ref.id) allRefs.push(ref);
      const ck = canonicalKey(ref.name, ref.company);
      if (ck !== (row.canonical_key || '')) {
        updates.push({ id: row.id, canonical_key: ck || null });
      }
    }
    if (!dryRun && updates.length) await upsertBatches(table, updates, 'id');
    console.log(`${table}: ${rows.length} rows, ${updates.length} canonical_key updates`);
  }

  const index = buildContactIndex(allRefs);

  // ---- 2. activities: resolve each row ----
  const activities = await fetchAll(
    'activities',
    'contact_key, full_name, company, contact_table, contact_id, match_status'
  );

  const counts = new Map<string, number>();
  const methodCounts = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) || 0) + 1);
  const ambiguousSamples: string[] = [];
  const updates: Record<string, unknown>[] = [];

  for (const row of activities) {
    const name = String(row.full_name || '');
    const company = String(row.company || '');
    const result = resolveContact(index, { name, company });

    bump(counts, result.status);
    if (result.method) bump(methodCounts, result.method);
    if (result.status === 'ambiguous' && ambiguousSamples.length < 15) {
      const cands = (result.candidates || [])
        .map((c) => `${c.table}/${c.id}`)
        .join(', ');
      ambiguousSamples.push(`  "${name}" @ "${company}" -> ${cands}`);
    }

    updates.push({
      contact_key: row.contact_key,
      canonical_key: canonicalKey(name, company) || null,
      contact_table: result.match?.table || null,
      contact_id: result.match?.id || null,
      match_status: result.status,
      match_method: result.method || null,
      match_confidence: result.confidence ?? null,
      match_candidates: result.candidates
        ? result.candidates.map((c) => ({
            table: c.table, id: c.id, name: c.name, company: c.company,
          }))
        : null,
    });
  }

  if (!dryRun) await upsertBatches('activities', updates, 'contact_key');

  // ---- 3. report ----
  console.log(`\nactivities: ${activities.length} rows resolved${dryRun ? ' (dry run)' : ''}`);
  for (const [status, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${n}`);
  }
  console.log('by method:');
  for (const [method, n] of [...methodCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${method}: ${n}`);
  }
  if (ambiguousSamples.length) {
    console.log('ambiguous samples:');
    for (const s of ambiguousSamples) console.log(s);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
