'use client';

import { useRef } from 'react';
import { parseCSV } from '@/lib/parseCSV';
import { setLeads, setLastImport } from '@/lib/storage';

export default function CSVUploader({ onImport }: { onImport: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const leads = parseCSV(text);
      setLeads(leads);
      setLastImport(new Date().toISOString());
      onImport();
    };
    reader.readAsText(file);

    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        onChange={handleFile}
        className="hidden"
        id="csv-upload"
      />
      <label
        htmlFor="csv-upload"
        className="cursor-pointer px-4 py-2 text-sm font-medium bg-[#1a1a1a] text-white rounded-lg hover:bg-[#333] transition-colors"
      >
        Import Leads
      </label>
    </div>
  );
}
