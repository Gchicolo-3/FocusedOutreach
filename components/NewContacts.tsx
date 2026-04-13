'use client';

import { useState, useEffect } from 'react';
import { ColdBroker } from '@/types';
import { getColdBrokers, updateColdBroker, initDefaultColdBrokers } from '@/lib/storage';

const statusPill: Record<string, { label: string; className: string }> = {
  new: { label: 'New', className: 'pill-blue' },
  outreach_sent: { label: 'Outreach Sent', className: 'pill-amber' },
  connected: { label: 'Connected', className: 'pill-accent' },
  active_broker: { label: 'Active Broker', className: 'pill-purple' },
};

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase();
}

export default function NewContacts() {
  const [contacts, setContacts] = useState<ColdBroker[]>([]);
  const [filterFirm, setFilterFirm] = useState<string>('all');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    initDefaultColdBrokers();
    setContacts(getColdBrokers());
  }, []);

  function changeStatus(id: string, status: ColdBroker['status']) {
    updateColdBroker(id, { status });
    setContacts(getColdBrokers());
  }

  if (!mounted) return null;

  const firms = ['all', ...Array.from(new Set(contacts.map((c) => c.firm)))];
  const filtered = filterFirm === 'all' ? contacts : contacts.filter((c) => c.firm === filterFirm);

  return (
    <div className="space-y-4 fade-up">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-xl font-bold">New Contacts</h2>
        <span className="label-mono">{filtered.length} contacts</span>
      </div>

      <div className="flex gap-2 flex-wrap">
        {firms.map((f) => (
          <button
            key={f}
            onClick={() => setFilterFirm(f)}
            className={filterFirm === f ? 'btn-primary' : 'btn-ghost'}
          >
            {f === 'all' ? 'All Firms' : f}
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {filtered.map((contact, idx) => {
          const sp = statusPill[contact.status];
          const fadeClass = `fade-up-${Math.min(idx + 1, 5)}`;

          return (
            <div key={contact.id} className={`card card-hover p-5 ${fadeClass}`}>
              <div className="flex items-start gap-3">
                <div
                  className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-display font-bold"
                  style={{ background: 'var(--purple-bg)', color: 'var(--purple)' }}
                >
                  {getInitials(contact.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-display font-semibold">{contact.name}</span>
                    <span className="pill pill-muted">{contact.firm}</span>
                  </div>
                  <p className="label-mono mt-0.5">{contact.title}</p>
                  <div className="mt-3 space-y-1 text-sm">
                    <p>
                      <a
                        href={`mailto:${contact.email}`}
                        className="hover:underline break-all"
                        style={{ color: 'var(--accent)' }}
                      >
                        {contact.email}
                      </a>
                    </p>
                    {contact.phone && <p className="label-mono">{contact.phone}</p>}
                    {contact.mobile && <p className="label-mono">M: {contact.mobile}</p>}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between mt-4 pt-4 border-t border-[var(--border)] gap-2 flex-wrap">
                <span className={`pill ${sp.className}`}>{sp.label}</span>
                <div className="flex gap-2 flex-wrap">
                  {contact.status === 'new' && (
                    <button onClick={() => changeStatus(contact.id, 'outreach_sent')} className="btn-secondary">
                      Outreach sent
                    </button>
                  )}
                  {contact.status === 'outreach_sent' && (
                    <button onClick={() => changeStatus(contact.id, 'connected')} className="btn-primary">
                      Connected
                    </button>
                  )}
                  {contact.status !== 'active_broker' && (
                    <button onClick={() => changeStatus(contact.id, 'active_broker')} className="btn-primary">
                      To Broker Engine
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
