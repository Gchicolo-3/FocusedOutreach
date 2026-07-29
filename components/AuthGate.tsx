'use client';

// Sign-in gate for the app. With RLS enabled, browser reads/writes only work
// with an authenticated Supabase session — the anon key alone sees nothing —
// so every page renders behind this gate. Sessions persist in localStorage
// and auto-refresh, so this is a once-per-device login, not a daily one.
//
// There is no sign-up flow on purpose: the single user is created from the
// Supabase Dashboard (Authentication → Users → Add user). RLS policies are
// additionally keyed to that account's email, so even a stray signed-up user
// would see zero rows.

import { useState, useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { C, F, labelMono, btnPrimary, inputBase } from '@/lib/design';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      setSession(data.session);
      setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (err) setError(err.message);
    setBusy(false);
  }

  if (!ready) return null;

  if (!session) {
    return (
      <div
        style={{
          background: C.bg,
          color: C.text,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
        }}
      >
        <form
          onSubmit={signIn}
          style={{
            background: C.surface,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            padding: 28,
            width: '100%',
            maxWidth: 360,
          }}
        >
          <h1 style={{ fontFamily: F.display, fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
            Focus Studio
          </h1>
          <div style={{ ...labelMono, marginBottom: 20 }}>Prospecting OS — sign in</div>

          <span style={{ ...labelMono, display: 'block', marginBottom: 4 }}>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ ...inputBase, marginBottom: 12 }}
          />
          <span style={{ ...labelMono, display: 'block', marginBottom: 4 }}>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ ...inputBase, marginBottom: 16 }}
          />
          <button type="submit" disabled={busy} style={{ ...btnPrimary, width: '100%', opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {error && (
            <div style={{ marginTop: 12, fontSize: 12, fontFamily: F.body, color: C.red }}>{error}</div>
          )}
        </form>
      </div>
    );
  }

  return (
    <>
      {children}
      <button
        onClick={() => supabase.auth.signOut()}
        title={`Signed in as ${session.user.email}`}
        style={{
          position: 'fixed',
          bottom: 12,
          right: 12,
          zIndex: 30,
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderRadius: 999,
          padding: '6px 12px',
          fontSize: 11,
          fontFamily: F.mono,
          color: C.muted,
          cursor: 'pointer',
        }}
      >
        Sign out
      </button>
    </>
  );
}
