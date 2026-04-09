'use client';

import { useState, useEffect } from 'react';
import { ColdBroker } from '@/types';
import { getColdBrokers, setColdBrokers, updateColdBroker } from '@/lib/storage';

const firmColors: Record<string, string> = {
  CBRE: 'bg-green-100 text-green-800',
  'Cushman & Wakefield': 'bg-blue-100 text-blue-800',
  JLL: 'bg-red-100 text-red-800',
  Newmark: 'bg-purple-100 text-purple-800',
};

const statusLabels: Record<string, { label: string; color: string }> = {
  new: { label: 'New', color: 'bg-blue-100 text-[#1e40af]' },
  outreach_sent: { label: 'Outreach Sent', color: 'bg-amber-100 text-amber-700' },
  connected: { label: 'Connected', color: 'bg-green-100 text-green-700' },
  active_broker: { label: 'Active Broker', color: 'bg-purple-100 text-[#5b21b6]' },
};

const DEFAULT_CONTACTS: ColdBroker[] = [
  { id: 'zi-1', name: 'Jon Sarkisian', title: 'EVP', firm: 'CBRE', email: 'jon.sarkisian@cbre.com', phone: '(856) 359-9408', mobile: '(609) 257-8100', status: 'new' },
  { id: 'zi-2', name: 'Robert Zwengler', title: 'EVP', firm: 'CBRE', email: 'robert.zwengler@cbre.com', phone: '(215) 516-8979', status: 'new' },
  { id: 'zi-3', name: 'Nick Savage', title: 'SVP', firm: 'CBRE', email: 'nick.savage@cbre.com', phone: '(201) 712-5887', mobile: '(203) 722-6076', status: 'new' },
  { id: 'zi-4', name: 'Elli Klapper', title: 'EVP', firm: 'CBRE', email: 'elli.klapper@cbre.com', phone: '(718) 289-7719', status: 'new' },
  { id: 'zi-5', name: 'Aviva Nussbaum', title: 'VP', firm: 'CBRE', email: 'aviva.nussbaum@cbre.com', phone: '(212) 984-7115', status: 'new' },
  { id: 'zi-6', name: 'Frank Caccavo', title: 'EVP', firm: 'Cushman & Wakefield', email: 'frank.caccavo@cushwake.com', phone: '(732) 452-6163', mobile: '(732) 241-0464', status: 'new' },
  { id: 'zi-7', name: 'Meghan McGrath', title: 'SVP', firm: 'Cushman & Wakefield', email: 'megan.mcgrath@cushmanwakefield.com', mobile: '(917) 902-0226', phone: '', status: 'new' },
  { id: 'zi-8', name: 'Charles Parmelli', title: 'EMD', firm: 'Cushman & Wakefield', email: 'cparmelli@cushmanwakefield.com', phone: '(973) 908-6105', status: 'new' },
  { id: 'zi-9', name: 'Eric Staar', title: 'SVP', firm: 'JLL', email: 'eric.staar@jll.com', phone: '(973) 404-1487', mobile: '(973) 944-8931', status: 'new' },
  { id: 'zi-10', name: 'Colby Scruggs', title: 'SVP', firm: 'Newmark', email: 'colby.scruggs@nmrk.com', phone: '(201) 528-0846', status: 'new' },
];

function initContacts(): ColdBroker[] {
  const existing = getColdBrokers();
  if (existing.length === 0) {
    setColdBrokers(DEFAULT_CONTACTS);
    return DEFAULT_CONTACTS;
  }
  return existing;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

export default function Contacts() {
  const [contacts, setContacts] = useState<ColdBroker[]>([]);
  const [filterFirm, setFilterFirm] = useState<string>('all');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setContacts(initContacts());
  }, []);

  function changeStatus(id: string, status: ColdBroker['status']) {
    updateColdBroker(id, { status });
    setContacts(getColdBrokers());
  }

  if (!mounted) return null;

  const firms = ['all', ...Array.from(new Set(contacts.map((c) => c.firm)))];
  const filtered = filterFirm === 'all' ? contacts : contacts.filter((c) => c.firm === filterFirm);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {firms.map((f) => (
          <button
            key={f}
            onClick={() => setFilterFirm(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filterFirm === f
                ? 'bg-[#1a1a1a] text-white'
                : 'bg-white text-gray-600 border border-[#e8e8e0] hover:bg-gray-50'
            }`}
          >
            {f === 'all' ? 'All Firms' : f}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((contact) => {
          const firmColor = firmColors[contact.firm] || 'bg-gray-100 text-gray-700';
          const st = statusLabels[contact.status];

          return (
            <div key={contact.id} className="bg-white rounded-lg border border-[#e8e8e0] p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#5b21b6] text-white flex items-center justify-center text-sm font-bold">
                  {getInitials(contact.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{contact.name}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${firmColor}`}>
                      {contact.firm}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500">{contact.title}</p>
                  <div className="mt-2 space-y-0.5 text-sm">
                    <p>
                      <a href={`mailto:${contact.email}`} className="text-[#1e40af] hover:underline break-all">
                        {contact.email}
                      </a>
                    </p>
                    {contact.phone && <p className="text-gray-600">{contact.phone}</p>}
                    {contact.mobile && <p className="text-gray-600">M: {contact.mobile}</p>}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#e8e8e0] gap-2 flex-wrap">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${st.color}`}>{st.label}</span>
                <div className="flex gap-1.5 flex-wrap">
                  {contact.status === 'new' && (
                    <button
                      onClick={() => changeStatus(contact.id, 'outreach_sent')}
                      className="px-2.5 py-1 text-xs font-medium bg-[#1a1a1a] text-white rounded-md hover:bg-[#333]"
                    >
                      Mark outreach sent
                    </button>
                  )}
                  {contact.status === 'outreach_sent' && (
                    <button
                      onClick={() => changeStatus(contact.id, 'connected')}
                      className="px-2.5 py-1 text-xs font-medium bg-[#059669] text-white rounded-md hover:bg-[#047857]"
                    >
                      Mark connected
                    </button>
                  )}
                  {contact.status !== 'active_broker' && (
                    <button
                      onClick={() => changeStatus(contact.id, 'active_broker')}
                      className="px-2.5 py-1 text-xs font-medium bg-[#5b21b6] text-white rounded-md hover:bg-[#4c1d95]"
                    >
                      Move to Broker Engine
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
