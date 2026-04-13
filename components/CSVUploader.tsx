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
import { ContactType } from '@/types';
import { btnPrimary, btnSecondary } from '@/lib/design';

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

  function handleContactsFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    readFile(file, (text) => {
      try {
        const tagMap = new Map<string, ContactType>();
        for (const tag of getUserTags()) tagMap.set(tag.id, tag.type);

        const parsed = parseCSV(text, tagMap);
        console.log('[CSVUploader] contacts parsed:', {
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
      } catch (err) {
        console.error('[CSVUploader] contacts parse failed:', err);
        alert('Contacts import failed. See console for details.');
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
      } catch (err) {
        console.error('[CSVUploader] activities parse failed:', err);
        alert('Activities import failed. See console for details.');
      }
    });
  }

  const hiddenInput: React.CSSProperties = {
    display: 'none',
    width: 0,
    height: 0,
    padding: 0,
    border: 0,
  };

  return (
    <>
      <input
        ref={contactsRef}
        type="file"
        accept=".csv,text/csv"
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
