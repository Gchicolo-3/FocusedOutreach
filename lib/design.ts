// Design tokens — used via inline styles so they're always applied and type-safe.
// Deliberately not using CSS variables since they've been fragile through Tailwind v4 compilation.

export const C = {
  bg: '#0e0e0e',
  surface: '#161616',
  surface2: '#1e1e1e',
  border: '#2a2a2a',
  border2: '#333333',
  text: '#f0ede8',
  muted: '#777770',
  muted2: '#555550',
  accent: '#c8f04a',
  accent2: '#a8d030',
  accentBg: 'rgba(200,240,74,0.1)',
  purple: '#b49dff',
  purpleBg: '#1e1a2e',
  teal: '#4affd4',
  tealBg: '#0e2420',
  amber: '#ffc94a',
  amberBg: '#201a0e',
  red: '#ff6b6b',
  redBg: '#200e0e',
  blue: '#4ab0ff',
  blueBg: '#0e1820',
} as const;

export const F = {
  display: "'Syne', -apple-system, sans-serif",
  body: "'DM Sans', -apple-system, sans-serif",
  mono: "'DM Mono', ui-monospace, monospace",
} as const;

export const labelMono: React.CSSProperties = {
  fontFamily: F.mono,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: C.muted,
};

export const card: React.CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 12,
};

export const taskCard: React.CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 14,
};

export const btnPrimary: React.CSSProperties = {
  background: C.accent,
  color: '#0e0e0e',
  fontFamily: F.body,
  fontWeight: 600,
  fontSize: 13,
  border: `1px solid ${C.accent}`,
  borderRadius: 8,
  padding: '8px 14px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  lineHeight: 1.2,
  transition: 'background 0.15s, border-color 0.15s, opacity 0.15s',
};

export const btnSecondary: React.CSSProperties = {
  background: C.surface2,
  color: C.text,
  fontFamily: F.body,
  fontWeight: 500,
  fontSize: 13,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '8px 14px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  lineHeight: 1.2,
};

export const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: C.muted,
  fontFamily: F.body,
  fontWeight: 500,
  fontSize: 13,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: '8px 14px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  lineHeight: 1.2,
};

export function pillStyle(variant: 'accent' | 'purple' | 'teal' | 'amber' | 'red' | 'blue' | 'muted'): React.CSSProperties {
  const map = {
    accent: { background: C.accentBg, color: C.accent },
    purple: { background: C.purpleBg, color: C.purple },
    teal: { background: C.tealBg, color: C.teal },
    amber: { background: C.amberBg, color: C.amber },
    red: { background: C.redBg, color: C.red },
    blue: { background: C.blueBg, color: C.blue },
    muted: { background: C.surface2, color: C.muted },
  };
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 8px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    fontFamily: F.mono,
    ...map[variant],
  };
}

export const inputBase: React.CSSProperties = {
  background: C.surface2,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  color: C.text,
  fontFamily: F.body,
  fontSize: 13,
  padding: '8px 12px',
  outline: 'none',
  width: '100%',
};
