'use client';

// Salesforce import: one button, both export formats, auto-detected.
// CSV path: parse -> resolve against existing contacts (lib/importEngine) ->
// show what will happen -> apply (lib/importApply). Contacts get created and
// enriched; ambiguous or untyped people land in the Import Review tab
// instead of being guessed at.
// JSON path (contacts pull): unchanged legacy behavior.

import { useRef, useState } from 'react';
import { parseImportCSV, planImport, summarizePlan } from '@/lib/importEngine';
import { applyImportPlan, loadExistingContacts } from '@/lib/importApply';
import {
  setProspects,
  setBrokers,
  setPartners,
  setLastImport,
  setLastActivityImport,
  getBrokers,
  getPartners,
  getProspects,
  exportAllToCSV,
} from '@/lib/storage';
import { Broker, Partner, Lead } from '@/types';
import { btnPrimary, btnGhost } from '@/lib/design';
import { computeNextDue, computeStatus, defaultTierForBroker, defaultTierForPartner } from '@/lib/cadence';
import { prioritizeLead, assignChannel } from '@/lib/prioritize';

export default function CSVUploader({ onImport }: { onImport: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');

  function openFile() {
    if (!fileRef.current) return;
    fileRef.current.value = '';
    fileRef.current.click();
  }

  function readFile(file: File, onText: (t: string) => void) {
    const reader = new FileReader();
    reader.onerror = () => alert('Failed to read file.');
    reader.onload = (ev) => onText(ev.target?.result as string);
    reader.readAsText(file);
  }

  // ============ CSV (both Salesforce export formats) ============

  async function importCSV(text: string) {
    setProgress('Parsing CSV...');
    const { format, rows } = parseImportCSV(text);

    setProgress('Loading existing contacts...');
    const existing = await loadExistingContacts();

    setProgress(`Resolving ${rows.length} rows...`);
    await new Promise((r) => setTimeout(r, 0));
    const plan = planImport(format, rows, existing);

    const proceed = window.confirm(`Import this file?\n\n${summarizePlan(plan)}`);
    if (!proceed) {
      setProgress('');
      setImporting(false);
      return;
    }

    setProgress('Applying...');
    const result = await applyImportPlan(plan);

    setLastImport(new Date().toISOString());
    setLastActivityImport(new Date().toISOString());
    setProgress('');
    setImporting(false);
    onImport();

    const lines = [
      `Imported.`,
      `${result.created} contacts created`,
      `${result.updated} contacts enriched`,
      `${result.activities} activity rows written`,
      result.review > 0 ? `${result.review} need review — see the Import Review tab` : '',
      result.errors.length ? `\nErrors:\n${result.errors.join('\n')}` : '',
    ].filter(Boolean);
    alert(lines.join('\n'));
  }

  // ============ JSON (legacy contacts pull) ============

  type JsonContact = {
    id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    mobile?: string;
    subject?: string;
    focusType?: string;
  };

  function normalizeType(raw: string): 'prospect' | 'broker' | 'referral_partner' | 'uncategorized' {
    const v = (raw || '').toLowerCase();
    if (v.includes('referral')) return 'referral_partner';
    if (v.includes('broker') || v.includes('property manager')) return 'broker';
    if (v.includes('prospect') || v.includes('client') || v.includes('customer')) return 'prospect';
    if (v.includes('landlord')) return 'prospect';
    return 'uncategorized';
  }

  function firmFromEmail(email: string): string {
    if (!email || email === 'nan') return '';
    const domain = email.split('@')[1]?.toLowerCase().trim();
    if (!domain) return '';
    const base = domain.split('.')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  async function importJSON(text: string) {
    const trimmed = text.trim();
    const json: JsonContact[] = JSON.parse(trimmed.startsWith('{') ? `[${trimmed}]` : trimmed);
    setProgress(`Processing ${json.length} contacts...`);
    await new Promise((r) => setTimeout(r, 0));

    const prospects: Lead[] = [];
    const brokers: Broker[] = [];
    const partners: Partner[] = [];

    for (const c of json) {
      const fn = (c.firstName || '').trim();
      const ln = (c.lastName || '').trim();
      const email = c.email && c.email !== 'nan' ? c.email.trim() : '';
      const mobile = c.mobile && c.mobile !== 'nan' ? c.mobile.trim() : '';
      const subject = c.subject && c.subject !== 'nan' ? c.subject.trim() : '';
      const type = normalizeType(c.focusType || '');
      const firm = firmFromEmail(email);
      const id = c.id || email.toLowerCase().replace(/[^a-z0-9]/g, '_') || `${fn}-${ln}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
      if (!fn && !ln) continue;

      if (type === 'prospect') {
        const lead: Lead = {
          id, company: firm || 'Unknown', contact: `${fn} ${ln}`.trim(),
          subject, activityType: '', date: '', status: '', priority: '',
          comments: subject, tier: 3, channel: 'email',
          email: email || undefined, phone: mobile || undefined,
        };
        lead.tier = prioritizeLead(lead);
        lead.channel = assignChannel(lead);
        prospects.push(lead);
      } else if (type === 'broker') {
        const tier = defaultTierForBroker(0);
        brokers.push({
          id, firstName: fn, lastName: ln, firm: firm || 'Unknown',
          title: 'Broker', email: email || undefined, mobile: mobile || undefined,
          tier, dealCount: 0, dealNames: [], lastTouch: '', nextDue: computeNextDue('', tier),
          notes: subject, status: computeStatus('', tier),
        });
      } else if (type === 'referral_partner') {
        const tier = defaultTierForPartner('other');
        partners.push({
          id, firstName: fn, lastName: ln, company: firm || 'Unknown',
          title: '', partnerType: 'other', tier, referralCount: 0,
          lastTouch: '', nextDue: computeNextDue('', tier), notes: subject,
          email: email || undefined, phone: mobile || undefined,
        });
      }
    }

    setProgress('Merging with existing contacts...');
    const [existingBrokers, existingPartners, existingProspects] = await Promise.all([
      getBrokers(), getPartners(), getProspects(),
    ]);
    const brokerMap = new Map(existingBrokers.map((b) => [b.id, b]));
    for (const b of brokers) if (!brokerMap.has(b.id)) brokerMap.set(b.id, b);
    const partnerMap = new Map(existingPartners.map((p) => [p.id, p]));
    for (const p of partners) if (!partnerMap.has(p.id)) partnerMap.set(p.id, p);
    const prospectMap = new Map(existingProspects.map((p) => [p.id, p]));
    for (const p of prospects) if (!prospectMap.has(p.id)) prospectMap.set(p.id, p);

    await setProspects([...prospectMap.values()]);
    await setBrokers([...brokerMap.values()]);
    await setPartners([...partnerMap.values()]);
    setLastImport(new Date().toISOString());

    setProgress('');
    setImporting(false);
    onImport();
    alert(
      `Imported.\n${prospectMap.size} prospects · ${brokerMap.size} brokers · ${partnerMap.size} partners`
    );
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setProgress('Reading file...');

    readFile(file, async (text) => {
      try {
        const trimmed = (text || '').trim();
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
          await importJSON(text);
        } else {
          await importCSV(text);
        }
      } catch (err) {
        console.error('[CSVUploader] import failed:', err);
        setProgress('');
        setImporting(false);
        alert(`Import failed: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    });
  }

  const hiddenInput: React.CSSProperties = {
    position: 'fixed', top: -9999, left: -9999,
    opacity: 0, width: 1, height: 1, overflow: 'hidden',
  };

  return (
    <>
      <input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json"
        onChange={handleFile} style={hiddenInput} aria-hidden="true" tabIndex={-1} />

      <div className="flex gap-2 flex-wrap items-center">
        <button type="button" onClick={openFile} style={btnPrimary} disabled={importing}>
          {importing ? 'Importing...' : 'Import Salesforce CSV'}
        </button>
        <button type="button" onClick={exportAllToCSV} style={btnGhost} disabled={importing}>
          Export CSV
        </button>
        {progress && (
          <span style={{ fontSize: 12, color: '#888', fontFamily: 'monospace' }}>
            {progress}
          </span>
        )}
      </div>
    </>
  );
}
