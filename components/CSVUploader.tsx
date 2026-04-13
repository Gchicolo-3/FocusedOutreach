'use client';

import { useRef } from 'react';
import { parseCSV } from '@/lib/parseCSV';
import {
  setProspects,
  setBrokers,
  setPartners,
  setUncategorized,
  setLastImport,
  getBrokers,
  getPartners,
  getUserTags,
} from '@/lib/storage';
import { ContactType } from '@/types';

export default function CSVUploader({ onImport }: { onImport: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    if (!fileRef.current) return;
    // Reset value so selecting the same file twice still fires change
    fileRef.current.value = '';
    fileRef.current.click();
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    console.log('[CSVUploader] file selected:', file?.name, file?.size);
    if (!file) return;

    const reader = new FileReader();

    reader.onerror = (err) => {
      console.error('[CSVUploader] FileReader error:', err);
      alert('Failed to read file. See console.');
    };

    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      console.log('[CSVUploader] file read, length:', text?.length);

      try {
        const tagMap = new Map<string, ContactType>();
        for (const tag of getUserTags()) {
          tagMap.set(tag.id, tag.type);
        }

        const parsed = parseCSV(text, tagMap);
        console.log('[CSVUploader] parsed:', {
          prospects: parsed.prospects.length,
          brokers: parsed.brokers.length,
          partners: parsed.partners.length,
          uncategorized: parsed.uncategorized.length,
        });

        const existingBrokers = getBrokers();
        const mergedBrokers = [...existingBrokers];
        for (const b of parsed.brokers) {
          if (!mergedBrokers.find((existing) => existing.id === b.id)) {
            mergedBrokers.push(b);
          }
        }

        const existingPartners = getPartners();
        const mergedPartners = [...existingPartners];
        for (const p of parsed.partners) {
          if (!mergedPartners.find((existing) => existing.id === p.id)) {
            mergedPartners.push(p);
          }
        }

        setProspects(parsed.prospects);
        setBrokers(mergedBrokers);
        setPartners(mergedPartners);
        setUncategorized(parsed.uncategorized);
        setLastImport(new Date().toISOString());
        console.log('[CSVUploader] storage updated, calling onImport');
        onImport();
      } catch (err) {
        console.error('[CSVUploader] parse failed:', err);
        alert('CSV import failed. See console for details.');
      }
    };

    reader.readAsText(file);
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        onChange={handleFile}
        style={{ display: 'none', width: 0, height: 0, padding: 0, border: 0 }}
        aria-hidden="true"
        tabIndex={-1}
      />
      <button type="button" onClick={openPicker} className="btn-primary">
        Import CSV
      </button>
    </>
  );
}
