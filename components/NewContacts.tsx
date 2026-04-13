'use client';

import { useState, useEffect } from 'react';
import { ColdBroker } from '@/types';
import { getColdBrokers, updateColdBroker, initDefaultColdBrokers } from '@/lib/storage';
import { C, F, labelMono, btnPrimary, btnSecondary, btnGhost, pillStyle } from '@/lib/design';

const statusPill: Record<string, { label: string; variant: 'blue' | 'amber' | 'accent' | 'purple' }> = {
  new: { label: 'New', variant: 'blue' },
  outreach_sent: { label: 'Outreach Sent', variant: 'amber' },
  connected: { label: 'Connected', variant: 'accent' },
  active_broker: { label: 'Active Broker', variant: 'purple' },
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

  useEffect(() => {
    initDefaultColdBrokers();
    setContacts(getColdBrokers());
  }, []);

  function changeStatus(id: string, status: ColdBroker['status']) {
    updateColdBroker(id, { status });
    setContacts(getColdBrokers());
  }

  const firms = ['all', ...Array.from(new Set(contacts.map((c) => c.firm)))];
  const filtered = filterFirm === 'all' ? contacts : contacts.filter((c) => c.firm === filterFirm);

  return (
    <div className="flex flex-col gap-4 fade-up">
      <div className="flex items-baseline justify-between">
        <h2 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700, color: C.text }}>New Contacts</h2>
        <span style={labelMono}>{filtered.length} contacts</span>
      </div>

      <div className="flex gap-2 flex-wrap">
        {firms.map((f) => (
          <button key={f} onClick={() => setFilterFirm(f)} style={filterFirm === f ? btnPrimary : btnGhost}>
            {f === 'all' ? 'All Firms' : f}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {filtered.map((contact) => {
          const sp = statusPill[contact.status];

          return (
            <div
              key={contact.id}
              style={{
                background: C.surface,
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: 20,
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: C.purpleBg,
                    color: C.purple,
                    fontFamily: F.display,
                    fontWeight: 700,
                    fontSize: 13,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {getInitials(contact.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ fontFamily: F.display, fontWeight: 600, fontSize: 15 }}>{contact.name}</span>
                    <span style={pillStyle('muted')}>{contact.firm}</span>
                  </div>
                  <p style={{ ...labelMono, marginTop: 2 }}>{contact.title}</p>
                  <div style={{ marginTop: 12 }}>
                    <a
                      href={`mailto:${contact.email}`}
                      style={{ color: C.accent, fontSize: 13, wordBreak: 'break-all', textDecoration: 'none' }}
                    >
                      {contact.email}
                    </a>
                    {contact.phone && <div style={labelMono}>{contact.phone}</div>}
                    {contact.mobile && <div style={labelMono}>M: {contact.mobile}</div>}
                  </div>
                </div>
              </div>

              <div
                style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}
                className="flex items-center justify-between gap-2 flex-wrap"
              >
                <span style={pillStyle(sp.variant)}>{sp.label}</span>
                <div className="flex gap-2 flex-wrap">
                  {contact.status === 'new' && (
                    <button onClick={() => changeStatus(contact.id, 'outreach_sent')} style={btnSecondary}>
                      Outreach sent
                    </button>
                  )}
                  {contact.status === 'outreach_sent' && (
                    <button onClick={() => changeStatus(contact.id, 'connected')} style={btnPrimary}>
                      Connected
                    </button>
                  )}
                  {contact.status !== 'active_broker' && (
                    <button onClick={() => changeStatus(contact.id, 'active_broker')} style={btnPrimary}>
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
