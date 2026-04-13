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

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;

      const tagMap = new Map<string, ContactType>();
      for (const tag of getUserTags()) {
        tagMap.set(tag.id, tag.type);
      }

      const parsed = parseCSV(text, tagMap);

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
      onImport();
    };
    reader.readAsText(file);

    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        onChange={handleFile}
        className="hidden"
        id="csv-upload"
        style={{ width: 'auto' }}
      />
      <label htmlFor="csv-upload" className="btn-primary cursor-pointer inline-flex items-center">
        Import CSV
      </label>
    </>
  );
}
