'use client';

import { useRef } from 'react';
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
} from '@/lib/storage';
import { ContactType, Broker, Partner, Lead } from '@/types';
import { btnPrimary, btnSecondary } from '@/lib/design';
import { computeNextDue, computeStatus, defaultTierForBroker, defaultTierForPartner } from '@/lib/cadence';
import { prioritizeLead, assignChannel } from '@/lib/prioritize';

export default function CSVUploader({ onImport }: { onImport: () => void }) {
  const contactsRef = useRef<HTMLInputElement>(null);
  const activitiesRef = useRef<HTMLInputElement>(null);

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
    reader.onerror = (err) => {
      console.error('[CSVUploader] FileReader error:', err);
      alert('Failed to read file.');
    };
    reader.onload = (ev) => {
      onText(ev.target?.result as string);
    };
    reader.readAsText(file);
  }

  function normalizeType(raw: string): ContactType {
    const v = (raw || '').toLowerCase();
    if (v.includes('referral')) return 'referral_partner';
    if (v.includes('broker') || v.includes('property manager')) return 'broker';
    if (v.includes('prospect') || v.includes('client')) return 'prospect';
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
      'cresa.com': 'Cresa', 'tocr.com': 'TOCR', 'compass.com': 'Compass',
      'avisonyoung.com': 'Avison Young', 'lee-associates.com': 'Lee & Associates',
      'marcusmillichap.com': 'Marcus & Millichap', 'kw.com': 'Keller Williams',
      'sheldongrossrealty.com': 'Sheldon Gross Realty', 'weichertcommercial.com': 'Weichert Commercial',
      'sitarcompany.com': 'The Sitar Company', 'resource-realty.com': 'Resource Realty',
      'silbertrealestate.com': 'Silbert Real Estate', 'rarefiedrep.com': 'Rarefied Rep',
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

  function handleContactsFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    readFile(file, (text) => {
      try {
        // Detect JSON vs CSV
        const trimmed = text.trim();
        const isJson = trimmed.startsWith('[') || trimmed.startsWith('{');

        let parsed;
        if (isJson) {
          const json: JsonContact[] = JSON.parse(trimmed.startsWith('{') ? `[${trimmed}]` : trimmed);
          const result = parseJsonContacts(json);
          parsed = { ...result, uncategorized: [] as { id: string; company: string; contact: string; comments: string }[] };
          console.log('[CSVUploader] JSON parsed:', {
            prospects: parsed.prospects.length,
            brokers: parsed.brokers.length,
            partners: parsed.partners.length,
          });
        } else {
          const tagMap = new Map<string, ContactType>();
          for (const tag of getUserTags()) tagMap.set(tag.id, tag.type);
          parsed = parseCSV(text, tagMap);
          console.log('[CSVUploader] CSV parsed:', {
            prospects: parsed.prospects.length,
            brokers: parsed.brokers.length,
            partners: parsed.partners.length,
          });
        }

        console.log('[CSVUploader] total contacts:', {
          prospects: parsed.prospects.length,
          brokers: parsed.brokers.length,
          partners: parsed.partners.length,
        });

        const storedActivities = getActivities();
        const enrichedProspects = enrichLeadsWithActivities(parsed.prospects, storedActivities);
        const enrichedBrokersNew = enrichBrokersWithActivities(parsed.brokers, storedActivities);
        const enrichedPartnersNew = enrichPartnersWithActivities(parsed.partners, storedActivities);

        const existingBrokers = getBrokers();
        const mergedBrokers = [...existingBrokers];
        for (const b of enrichedBrokersNew) {
          if (!mergedBrokers.find((x) => x.id === b.id)) mergedBrokers.push(b);
        }
        const existingPartners = getPartners();
        const mergedPartners = [...existingPartners];
        for (const p of enrichedPartnersNew) {
          if (!mergedPartners.find((x) => x.id === p.id)) mergedPartners.push(p);
        }

        setProspects(enrichedProspects);
        setBrokers(mergedBrokers);
        setPartners(mergedPartners);
        setUncategorized(parsed.uncategorized);
        setLastImport(new Date().toISOString());
        onImport();
        alert(
          `Imported: ${enrichedProspects.length} prospects, ${mergedBrokers.length} brokers, ${mergedPartners.length} partners`
        );
      } catch (err) {
        console.error('[CSVUploader] contacts parse failed:', err);
        alert('Contacts import failed. Check console (F12) for details.');
      }
    });
  }

  function handleActivitiesFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    readFile(file, (text) => {
      try {
        const newActivities = parseActivityCSV(text);
        const count = Object.keys(newActivities).length;
        console.log('[CSVUploader] activities parsed for', count, 'contacts');
        if (count === 0) {
          alert('No activity rows found. Expected columns: Company/Account, Contact, Subject, Activity Type, Date, Status, Priority, Comments');
          return;
        }

        const merged = mergeActivities(newActivities);
        const enrichedProspects = enrichLeadsWithActivities(getProspects(), merged);
        const enrichedBrokers = enrichBrokersWithActivities(getBrokers(), merged);
        const enrichedPartners = enrichPartnersWithActivities(getPartners(), merged);

        const t1 = enrichedProspects.filter((p) => p.tier === 1).length;
        const t2 = enrichedProspects.filter((p) => p.tier === 2).length;
        console.log('[CSVUploader] post-enrichment tiers: T1=', t1, 'T2=', t2, 'T3=', enrichedProspects.length - t1 - t2);

        setProspects(enrichedProspects);
        setBrokers(enrichedBrokers);
        setPartners(enrichedPartners);
        setLastActivityImport(new Date().toISOString());
        onImport();
        alert(
          `Activities merged for ${count} contacts. Tier 1: ${t1}, Tier 2: ${t2}, Tier 3: ${enrichedProspects.length - t1 - t2}`
        );
      } catch (err) {
        console.error('[CSVUploader] activities parse failed:', err);
        alert('Activities import failed. Check console (F12) for details.');
      }
    });
  }

  const hiddenInput: React.CSSProperties = {
    position: 'fixed',
    top: -9999,
    left: -9999,
    opacity: 0,
    width: 1,
    height: 1,
    overflow: 'hidden',
  };

  return (
    <>
      <input
        ref={contactsRef}
        type="file"
        accept=".csv,.json,text/csv,application/json"
        onChange={handleContactsFile}
        style={hiddenInput}
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={activitiesRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleActivitiesFile}
        style={hiddenInput}
        aria-hidden="true"
        tabIndex={-1}
      />
      <div className="flex gap-2">
        <button type="button" onClick={openContacts} style={btnPrimary}>
          Import Contacts
        </button>
        <button type="button" onClick={openActivities} style={btnSecondary}>
          Import Activities
        </button>
      </div>
    </>
  );
}
