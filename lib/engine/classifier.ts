// lib/engine/classifier.ts
// One-time (and re-runnable) contact qualification: classifies each contact
// into a persona and decides whether it belongs in the outreach cadence.
// Only high-confidence verdicts set the qualified flag; low-confidence calls
// keep qualified NULL so the contact stays in the cadence until George
// reviews it. NEVER disqualifies on a guess.

import Anthropic from '@anthropic-ai/sdk';
import { getServerSupabase } from '@/lib/serverSupabase';

export const PERSONAS = [
  'tenant_rep',
  'landlord_rep',
  'landlord',
  'property_mgr',
  'end_user',
  'partner',
  'other',
] as const;

// Below this confidence we record the persona/reason but leave `qualified`
// NULL (contact keeps flowing through the cadence, flagged for human review).
const CONFIDENCE_FLOOR = 0.7;
const BATCH_SIZE = 20;

const CLASSIFY_SYSTEM = `You classify contacts for George Chicolo, Senior Associate of Business Development at Focus Studio, a workplace interiors firm (design, build, furnish office spaces, full turnkey) serving Northern New Jersey and the NYC metro.

George's outreach cadence should ONLY contain contacts who can plausibly lead to office interior projects or referrals:
- tenant_rep: commercial real estate broker representing office tenants. Highest-value target.
- landlord_rep: CRE broker representing building owners/landlords on office leasing. Target.
- landlord: building owner or asset manager with office holdings. Target.
- property_mgr: commercial property manager. Target.
- end_user: a company that occupies (or will need) office space itself. Target.
- partner: referral source - attorney, accountant, banker, mover, networking contact, past client. Target.
- other: none of the above - residential agents, recruiters, vendors selling TO Focus Studio, students, unrelated contacts. NOT qualified.

qualified = true when the persona is a target AND the contact is plausibly in George's market (Northern NJ / NYC metro, or market unknown). qualified = false only when the evidence clearly shows the contact does not belong (e.g. residential-only agent, industry vendor, wrong line of business entirely).

confidence is 0 to 1: how sure you are of BOTH the persona and the qualified verdict given the evidence. Sparse or ambiguous records deserve low confidence. Keep each reason under 20 words.

Return a result for every contact you are given, matched by id.`;

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'persona', 'qualified', 'confidence', 'reason'],
        properties: {
          id: { type: 'string' },
          persona: { type: 'string', enum: [...PERSONAS] },
          qualified: { type: 'boolean' },
          confidence: { type: 'number' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

type Verdict = {
  id: string;
  persona: (typeof PERSONAS)[number];
  qualified: boolean;
  confidence: number;
  reason: string;
};

function getSupabase() {
  return getServerSupabase();
}

// Compact one contact row into the evidence the model sees. Notes are
// truncated: they can contain merged activity logs of arbitrary length.
function contactEvidence(row: any, table: 'brokers' | 'partners') {
  return {
    id: String(row.id),
    source_table: table,
    name: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    company: table === 'brokers' ? row.firm : row.company,
    title: row.title || null,
    email_domain: row.email ? String(row.email).split('@')[1] || null : null,
    tier: row.tier || null,
    partner_type: row.partner_type || null,
    notes: row.notes ? String(row.notes).slice(0, 400) : null,
  };
}

async function classifyBatch(client: Anthropic, batch: any[]): Promise<Verdict[]> {
  const response = await client.messages.parse({
    model: 'claude-opus-4-8',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    system: CLASSIFY_SYSTEM,
    output_config: { format: { type: 'json_schema', schema: RESULT_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: `Classify these contacts:\n${JSON.stringify(batch, null, 1)}`,
      },
    ],
  } as any);

  const parsed = (response as any).parsed_output as { results: Verdict[] } | null;
  return parsed?.results || [];
}

export async function runClassifier(
  table: 'brokers' | 'partners',
  limit: number
): Promise<{ classified: number; disqualified: number; needsReview: number; errors: string[] }> {
  const supabase = getSupabase();
  const anthropic = new Anthropic();
  const summary = { classified: 0, disqualified: 0, needsReview: 0, errors: [] as string[] };

  const { data, error } = await supabase
    .from(table)
    .select('*')
    .is('persona', null)
    .limit(limit);

  if (error) {
    summary.errors.push(`fetch ${table}: ${error.message}`);
    return summary;
  }

  const rows = data || [];
  console.log(`[Classifier] ${rows.length} unclassified ${table} (limit ${limit})`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((r) => contactEvidence(r, table));
    const byId = new Map(rows.map((r) => [String(r.id), r]));

    let verdicts: Verdict[];
    try {
      verdicts = await classifyBatch(anthropic, batch);
    } catch (err: any) {
      summary.errors.push(`batch at ${i}: ${err.message}`);
      continue;
    }

    for (const v of verdicts) {
      if (!byId.has(v.id)) continue;
      const confident = v.confidence >= CONFIDENCE_FLOOR;
      const update: Record<string, unknown> = {
        persona: v.persona,
        qualification_confidence: v.confidence,
        qualification_reason: v.reason,
        classified_at: new Date().toISOString(),
        // Only a confident verdict sets the gate; otherwise leave NULL so the
        // contact keeps flowing and surfaces for review.
        qualified: confident ? v.qualified : null,
      };

      const { error: updateError } = await supabase.from(table).update(update).eq('id', v.id);
      if (updateError) {
        summary.errors.push(`update ${v.id}: ${updateError.message}`);
        continue;
      }

      summary.classified++;
      if (confident && !v.qualified) summary.disqualified++;
      if (!confident) summary.needsReview++;
    }
  }

  return summary;
}
