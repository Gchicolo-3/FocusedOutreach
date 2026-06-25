'use client';

import { useState, useEffect, useCallback } from 'react';
import { ColdBroker, SortKey } from '@/types';
import {
  getColdBrokers,
  updateColdBroker,
  initDefaultColdBrokers,
  getPinsToday,
  addPin,
  removePin,
  supabaseConfigured,
} from '@/lib/storage';
import { C, F, labelMono, btnPrimary, btnSecondary, btnGhost, pillStyle } from '@/lib/design';
import ContactLinks from '@/components/ContactLinks';
import SortBar from '@/components/SortBar';

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

const statusOrder: Record<string, number> = { new: 0, outreach_sent: 1, connected: 2, active_broker: 3 };

export default function NewContacts() {
  const [contacts, setContacts] = useState<ColdBroker[]>([]);
  const [filterFirm, setFilterFirm] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortKey>('contact_type');

  const refresh = useCallback(async () => {
    const [cb, pins] = await Promise.all([getColdBrokers(), getPinsToday()]);
    setContacts(cb);
    setPinnedIds(new Set(pins.map((p) => p.id)));
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await initDefaultColdBrokers();
      await refresh();
    })();
  }, [refresh]);

  async function changeStatus(id: string, status: ColdBroker['status']) {
    await updateColdBroker(id, { status });
    await refresh();
  }

  async function togglePin(id: string) {
    if (pinnedIds.has(id)) await removePin(id);
    else await addPin(id, 'cold_broker');
    await refresh();
  }

  const firms = ['all', ...Array.from(new Set(contacts.map((c) => c.firm)))];
  const filtered = (filterFirm === 'all' ? contacts : contacts.filter((c) => c.firm === filterFirm))
    .slice()
    .sort((a, b) => {
      if (sort === 'company') return (a.firm || '').localeCompare(b.firm || '');
      // contact_type / priority => by pipeline status, then name
      const so = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
      if (so !== 0) return so;
      return (a.name || '').localeCompare(b.name || '');
    });

  if (loading) {
    return (
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 32, textAlign: 'center', color: C.muted }} className="fade-up">
        Loading new contacts from Supabase…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 fade-up">
      {!supabaseConfigured && (
        <div style={{ background: C.redBg, border: `1px solid ${C.red}`, borderRadius: 12, padding: 20, color: C.red }}>
          Not connected to Supabase. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to load contacts.
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h2 style={{ fontFamily: F.display, fontSize: 18, fontWeight: 700, color: C.text }}>New Contacts</h2>
          <span style={labelMono}>{filtered.length} contacts</span>
        </div>
        <SortBar value={sort} onChange={setSort} options={['contact_type', 'company']} />
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
                  <ContactLinks email={contact.email} phone={contact.phone || contact.mobile} />
                </div>
              </div>

              <div
                style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}
                className="flex items-center justify-between gap-2 flex-wrap"
              >
                <span style={pillStyle(sp.variant)}>{sp.label}</span>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => togglePin(contact.id)} style={btnSecondary}>
                    {pinnedIds.has(contact.id) ? '📌 Pinned' : 'Pin to today'}
                  </button>
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
