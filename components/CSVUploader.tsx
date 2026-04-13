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
      alert('Failed to read file. See console.');
    };
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      console.log('[CSVUploader] file read, length:', text?.length);
      onText(text);
    };
    reader.readAsText(file);
  }

  function handleContactsFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    console.log('[CSVUploader] contacts file selected:', file?.name);
    if (!file) return;

    readFile(file, (text) => {
      try {
        const tagMap = new Map<string, ContactType>();
        for (const tag of getUserTags()) {
          tagMap.set(tag.id, tag.type);
        }

        const parsed = parseCSV(text, tagMap);
        console.log('[CSVUploader] parsed contacts:', {
          prospects: parsed.prospects.length,
          brokers: parsed.brokers.length,
          partners: parsed.partners.length,
          uncategorized: parsed.uncategorized.length,
        });

        // Re-apply stored activities to newly imported contacts
        const storedActivities = getActivities();
        const enrichedProspects = enrichLeadsWithActivities(parsed.prospects, storedActivities);
        const enrichedBrokersNew = enrichBrokersWithActivities(parsed.brokers, storedActivities);
        const enrichedPartnersNew = enrichPartnersWithActivities(parsed.partners, storedActivities);

        // Merge with existing brokers/partners (preserve tier, notes, deal count from before)
        const existingBrokers = getBrokers();
        const mergedBrokers = [...existingBrokers];
        for (const b of enrichedBrokersNew) {
          if (!mergedBrokers.find((existing) => existing.id === b.id)) {
            mergedBrokers.push(b);
          }
        }
        const existingPartners = getPartners();
        const mergedPartners = [...existingPartners];
        for (const p of enrichedPartnersNew) {
          if (!mergedPartners.find((existing) => existing.id === p.id)) {
            mergedPartners.push(p);
          }
        }

        setProspects(enrichedProspects);
        setBrokers(mergedBrokers);
        setPartners(mergedPartners);
        setUncategorized(parsed.uncategorized);
        setLastImport(new Date().toISOString());
        console.log('[CSVUploader] contacts imported');
        onImport();
      } catch (err) {
        console.error('[CSVUploader] contacts parse failed:', err);
        alert('Contacts import failed. See console for details.');
      }
    });
  }

  function handleActivitiesFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    console.log('[CSVUploader] activities file selected:', file?.name);
    if (!file) return;

    readFile(file, (text) => {
      try {
        const newActivities = parseActivityCSV(text);
        const activityCount = Object.keys(newActivities).length;
        console.log('[CSVUploader] parsed activities for', activityCount, 'contacts');

        if (activityCount === 0) {
          alert(
            'No activity rows parsed. Make sure the CSV has Contact and Comments columns.'
          );
          return;
        }

        const mergedActivities = mergeActivities(newActivities);
        console.log('[CSVUploader] total stored activities:', Object.keys(mergedActivities).length);

        // Re-enrich everything in storage
        const enrichedProspects = enrichLeadsWithActivities(getProspects(), mergedActivities);
        const enrichedBrokers = enrichBrokersWithActivities(getBrokers(), mergedActivities);
        const enrichedPartners = enrichPartnersWithActivities(getPartners(), mergedActivities);

        const tier1Count = enrichedProspects.filter((p) => p.tier === 1).length;
        const tier2Count = enrichedProspects.filter((p) => p.tier === 2).length;
        console.log(
          '[CSVUploader] post-enrichment tiers — Tier 1:',
          tier1Count,
          'Tier 2:',
          tier2Count,
          'Tier 3:',
          enrichedProspects.length - tier1Count - tier2Count
        );

        setProspects(enrichedProspects);
        setBrokers(enrichedBrokers);
        setPartners(enrichedPartners);
        setLastActivityImport(new Date().toISOString());
        console.log('[CSVUploader] activities imported');
        onImport();
      } catch (err) {
        console.error('[CSVUploader] activities parse failed:', err);
        alert('Activities import failed. See console for details.');
      }
    });
  }

  return (
    <>
      <input
        ref={contactsRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleContactsFile}
        style={{ display: 'none', width: 0, height: 0, padding: 0, border: 0 }}
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={activitiesRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleActivitiesFile}
        style={{ display: 'none', width: 0, height: 0, padding: 0, border: 0 }}
        aria-hidden="true"
        tabIndex={-1}
      />
      <div className="flex gap-2">
        <button type="button" onClick={openContacts} className="btn-primary">
          Import Contacts
        </button>
        <button type="button" onClick={openActivities} className="btn-secondary">
          Import Activities
        </button>
      </div>
    </>
  );
}
