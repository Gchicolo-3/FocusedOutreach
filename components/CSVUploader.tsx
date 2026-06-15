'use client';

import { useRef, useState } from 'react';
import {
  parseCSV,
  parseActivityCSV,
  enrichLeadsWithActivities,
  enrichBrokersWithActivities,
  enrichPartnersWithActivities,
} from '@/lib/parseCSV';
import {
  setProspects,
  setBrokers,
  setPartners,
  setUncategorized,
  setLastImport,
  setLastActivityImport,
  getBrokers,
  getPartners,
  getProspects,
  getUserTags,
  getActivities,
  mergeActivities,
  exportAllToCSV,
} from '@/lib/storage';
import { ContactType, Broker, Partner, Lead } from '@/types';
import { btnPrimary, btnSecondary, btnGhost } from '@/lib/design';
import { computeNextDue, computeStatus, defaultTierForBroker, defaultTierForPartner } from '@/lib/cadence';
import { prioritizeLead, assignChannel } from '@/lib/prioritize';

const CONTACT_CHUNK = 100;
const ACTIVITY_CHUNK_LINES = 400;

export default function CSVUploader({ onImport }: { onImport: () => void }) {
  const contactsRef = useRef<HTMLInputElement>(null);
  const activitiesRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState('');

  function openContacts() {
    if (!contactsRef.current) return;
    contactsRef.current.value = '';
    contactsRef.current.click();
  }

  function openActivities() {
    if (!activitiesRef.current) return;
    activitiesRef.current.value = '';
    activitiesRef.current.click();
  }

  function readFile(file: File, onText: (t: string) => void) {
    const reader = new FileReader();
    reader.onerror = () => alert('Failed to read file.');
    reader.onload = (ev) => onText(ev.target?.result as string);
    reader.readAsText(file);
  }

  function normalizeType(raw: string): ContactType {
    const v = (raw || '').toLowerCase();
    if (v.includes('referral')) return 'referral_partner';
    if (v.includes('broker') || v.includes('property manager')) return 'broker';
    if (v.includes('prospect') || v.includes('client') || v.includes('customer')) return 'prospect';
    if (v.includes('landlord')) return 'prospect';
    return 'uncategorized';
  }

  function firmFromEmail(email: string): string {
    if (!email || email === 'nan') return '';
    const FIRMS: Record<string, string> = {
      'cbre.com': 'CBRE', 'jll.com': 'JLL', 'am.jll.com': 'JLL',
      'cushwake.com': 'Cushman & Wakefield', 'cushmanwakefield.com': 'Cushman & Wakefield',
      'nmrk.com': 'Newmark', 'savills.us': 'Savills', 'colliers.com': 'Colliers',
      'blauberg.com': 'Blau & Berg', 'triforcecre.com': 'Triforce Commercial',
      'mrhrealestate.com': 'MRH Real Estate', 'naihanson.com': 'NAI Hanson',
      'cresa.com': 'Cresa', 'avisonyoung.com': 'Avison Young',
      'marcusmillichap.com': 'Marcus & Millichap',
      'sheldongrossrealty.com': 'Sheldon Gross Realty',
      'weichertcommercial.com': 'Weichert Commercial',
    };
    const domain = email.split('@')[1]?.toLowerCase().trim();
    if (!domain) return '';
    if (FIRMS[domain]) return FIRMS[domain];
    const base = domain.split('.')[0];
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  type JsonContact = {
    id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    mobile?: string;
    subject?: string;
    focusType?: string;
  };

  function parseJsonContacts(json: JsonContact[]) {
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

    return { prospects, brokers, partners };
  }

  // Process contacts in chunks to avoid memory spikes
  async function processContactsInChunks(
    items: JsonContact[],
    onProgress: (msg: string) => void
  ) {
    const allProspects: Lead[] = [];
    const allBrokers: Broker[] = [];
    const allPartners: Partner[] = [];

    for (let i = 0; i < items.length; i += CONTACT_CHUNK) {
      const chunk = items.slice(i, i + CONTACT_CHUNK);
      const result = parseJsonContacts(chunk);
      allProspects.push(...result.prospects);
      allBrokers.push(...result.brokers);
      allPartners.push(...result.partners);
      onProgress(`Processing ${Math.min(i + CONTACT_CHUNK, items.length)} of ${items.length} contacts...`);
      // Yield to browser between chunks
      await new Promise((r) => setTimeout(r, 0));
    }

    return { prospects: allProspects, brokers: allBrokers, partners: allPartners };
  }

  async function handleContactsFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setProgress('Reading file...');

    readFile(file, async (text) => {
      try {
        const trimmed = text.trim();
        const isJson = trimmed.startsWith('[') || trimmed.startsWith('{');

        let prospects: Lead[] = [];
        let brokers: Broker[] = [];
        let partners: Partner[] = [];
        let uncategorized: { id: string; company: string; contact: string; comments: string }[] = [];

        if (isJson) {
          const json: JsonContact[] = JSON.parse(trimmed.startsWith('{') ? `[${trimmed}]` : trimmed);
          setProgress(`Parsed ${json.length} contacts. Processing...`);
          const result = await processContactsInChunks(json, setProgress);
          prospects = result.prospects;
          brokers = result.brokers;
          partners = result.partners;
        } else {
          setProgress('Parsing CSV...');
          await new Promise((r) => setTimeout(r, 0));
          const tagMap = new Map<string, ContactType>();
          for (const tag of getUserTags()) tagMap.set(tag.id, tag.type);
          const parsed = parseCSV(text, tagMap);
          prospects = parsed.prospects;
          brokers = parsed.brokers;
          partners = parsed.partners;
          uncategorized = parsed.uncategorized;
        }

        setProgress('Enriching with activity data...');
        await new Promise((r) => setTimeout(r, 0));

        const storedActivities = getActivities();
        const enrichedProspects = enrichLeadsWithActivities(prospects, storedActivities);
        const enrichedBrokersNew = enrichBrokersWithActivities(brokers, storedActivities);
        const enrichedPartnersNew = enrichPartnersWithActivities(partners, storedActivities);

        setProgress('Merging with existing contacts...');
        await new Promise((r) => setTimeout(r, 0));

        // Merge brokers
        const existingBrokers = getBrokers();
        const brokerMap = new Map(existingBrokers.map((b) => [b.id, b]));
        for (const b of enrichedBrokersNew) {
          if (!brokerMap.has(b.id)) brokerMap.set(b.id, b);
        }
        const mergedBrokers = Array.from(brokerMap.values());

        // Merge partners
        const existingPartners = getPartners();
        const partnerMap = new Map(existingPartners.map((p) => [p.id, p]));
        for (const p of enrichedPartnersNew) {
          if (!partnerMap.has(p.id)) partnerMap.set(p.id, p);
        }
        const mergedPartners = Array.from(partnerMap.values());

        // Merge prospects
        const existingProspects = getProspects();
        const prospectMap = new Map(existingProspects.map((p) => [p.id, p]));
        for (const p of enrichedProspects) {
          if (!prospectMap.has(p.id)) prospectMap.set(p.id, p);
        }
        const mergedProspects = Array.from(prospectMap.values());

        setProgress('Saving...');
        await new Promise((r) => setTimeout(r, 0));

        setProspects(mergedProspects);
        setBrokers(mergedBrokers);
        setPartners(mergedPartners);
        setUncategorized(uncategorized);
        setLastImport(new Date().toISOString());

        setProgress('');
        setImporting(false);
        onImport();
        alert(
          `Imported successfully!\n${mergedProspects.length} prospects · ${mergedBrokers.length} brokers · ${mergedPartners.length} partners`
        );
      } catch (err) {
        console.error('[CSVUploader] contacts parse failed:', err);
        setProgress('');
        setImporting(false);
        alert('Import failed. Check console (F12) for details.');
      }
    });
  }

  async function handleActivitiesFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setProgress('Reading activity file...');

    readFile(file, async (text) => {
      try {
        const lines = text.split(/\r?\n/).filter((l) => l.trim());
        const header = lines[0];
        const dataLines = lines.slice(1);
        const total = dataLines.length;

        if (total === 0) {
          setProgress('');
          setImporting(false);
          alert('No activity rows found.');
          return;
        }

        setProgress(`Processing ${total} activity rows...`);
        await new Promise((r) => setTimeout(r, 0));

        // Process in chunks to avoid blocking browser
        const allActivities: Record<string, import('@/lib/parseCSV').ActivityRecord> = {};

        for (let i = 0; i < dataLines.length; i += ACTIVITY_CHUNK_LINES) {
          const chunk = [header, ...dataLines.slice(i, i + ACTIVITY_CHUNK_LINES)].join('\n');
          const parsed = parseActivityCSV(chunk);

          for (const [key, record] of Object.entries(parsed)) {
            const existing = allActivities[key];
            if (!existing) {
              allActivities[key] = record;
            } else {
              const mergedComments = [existing.comments, record.comments].filter(Boolean).join(' | ');
              const newer = record.date && (!existing.date || record.date > existing.date);
              allActivities[key] = {
                ...existing,
                comments: mergedComments,
                subject: newer ? record.subject || existing.subject : existing.subject,
                activityType: newer ? record.activityType || existing.activityType : existing.activityType,
                date: newer ? record.date : existing.date,
                status: newer ? record.status || existing.status : existing.status,
                priority: newer ? record.priority || existing.priority : existing.priority,
                company: existing.company || record.company,
              };
            }
          }

          const processed = Math.min(i + ACTIVITY_CHUNK_LINES, total);
          setProgress(`Processed ${processed} of ${total} activity rows...`);
          await new Promise((r) => setTimeout(r, 0));
        }

        const count = Object.keys(allActivities).length;
        if (count === 0) {
          setProgress('');
          setImporting(false);
          alert('No activities found. Check column names match expected format.');
          return;
        }

        setProgress(`Merging ${count} contact records...`);
        await new Promise((r) => setTimeout(r, 0));

        const merged = mergeActivities(allActivities);

        setProgress('Updating contacts with activity data...');
        await new Promise((r) => setTimeout(r, 0));

        const enrichedProspects = enrichLeadsWithActivities(getProspects(), merged);
        const enrichedBrokers = enrichBrokersWithActivities(getBrokers(), merged);
        const enrichedPartners = enrichPartnersWithActivities(getPartners(), merged);

        setProspects(enrichedProspects);
        setBrokers(enrichedBrokers);
        setPartners(enrichedPartners);
        setLastActivityImport(new Date().toISOString());

        const t1 = enrichedProspects.filter((p) => p.tier === 1).length;
        const t2 = enrichedProspects.filter((p) => p.tier === 2).length;

        setProgress('');
        setImporting(false);
        onImport();
        alert(
          `Activities imported!\n${count} contacts updated\nTier 1: ${t1} · Tier 2: ${t2} · Tier 3: ${enrichedProspects.length - t1 - t2}`
        );
      } catch (err) {
        console.error('[CSVUploader] activities parse failed:', err);
        setProgress('');
        setImporting(false);
        alert('Activity import failed. Check console (F12) for details.');
      }
    });
  }

  const hiddenInput: React.CSSProperties = {
    position: 'fixed', top: -9999, left: -9999,
    opacity: 0, width: 1, height: 1, overflow: 'hidden',
  };

  return (
    <>
      <input ref={contactsRef} type="file" accept=".csv,.json,text/csv,application/json"
        onChange={handleContactsFile} style={hiddenInput} aria-hidden="true" tabIndex={-1} />
      <input ref={activitiesRef} type="file" accept=".csv,text/csv"
        onChange={handleActivitiesFile} style={hiddenInput} aria-hidden="true" tabIndex={-1} />

      <div className="flex gap-2 flex-wrap items-center">
        <button type="button" onClick={openContacts} style={btnPrimary} disabled={importing}>
          {importing ? 'Importing...' : 'Import Contacts'}
        </button>
        <button type="button" onClick={openActivities} style={btnSecondary} disabled={importing}>
          Import Activities
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
