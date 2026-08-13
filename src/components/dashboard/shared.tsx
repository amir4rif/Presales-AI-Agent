'use client';
/* Bits the three dashboard tiers share. JSX escapes text for us, so the
   esc() helper the old pages needed around every interpolation is gone. */
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ProposalStatus } from '@/lib/data';

export const BADGE: Record<ProposalStatus, string> = {
  'Approved': 'status-completed',
  'Pending Review': 'status-sent',
  'Reject & Revise': 'status-review',
  'Draft': 'status-draft',
  'Reject & Close': 'status-draft',
  'Superseded': 'status-draft',
};

export const DOT: Record<ProposalStatus, string> = {
  'Approved': 'green',
  'Pending Review': 'blue',
  'Reject & Revise': 'amber',
  'Draft': 'muted',
  'Reject & Close': 'red',
  'Superseded': 'muted',
};

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export function ActionStrip({
  icon,
  title,
  sub,
  cta,
  href,
}: {
  icon: string;
  title: string;
  sub: ReactNode;
  cta: string;
  href: string;
}) {
  return (
    <div id="action-required">
      <div className="action-strip">
        <span className="as-ico">{icon}</span>
        <div>
          <div className="as-t">{title}</div>
          <div className="as-s">{sub}</div>
        </div>
        <Link className="btn-primary as-btn" href={href}>
          {cta}
        </Link>
      </div>
    </div>
  );
}

export function KpiRow({ items }: { items: { l: string; v: ReactNode; sub: string; c?: string }[] }) {
  return (
    <div className="kpi-row">
      {items.map((k) => (
        <div className="kpi-card" key={k.l}>
          <div className="kpi-label">{k.l}</div>
          <div className={`kpi-value ${k.c || ''}`}>{k.v}</div>
          <div className="kpi-sub">{k.sub}</div>
        </div>
      ))}
    </div>
  );
}

export function Card({
  title,
  link,
  linkHref,
  note,
  children,
}: {
  title: string;
  link?: string;
  linkHref?: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <span className="card-title">{title}</span>
          {note && (
            <div style={{ fontSize: '11.5px', color: 'var(--gray-500)', marginTop: 2 }}>{note}</div>
          )}
        </div>
        {link && linkHref && (
          <Link className="card-link" href={linkHref}>
            {link}
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty-hint">{children}</div>;
}

/** Win rate per rep, ranked best first — used by L2 and L3. */
export function rankReps(closed: { rep: string; outcome: 'Won' | 'Lost' }[]) {
  const reps: Record<string, { w: number; l: number }> = {};
  closed.forEach((d) => {
    const r = reps[d.rep] || (reps[d.rep] = { w: 0, l: 0 });
    if (d.outcome === 'Won') r.w++;
    else r.l++;
  });
  return Object.entries(reps)
    .map(([rep, r]) => ({
      rep,
      rate: r.w + r.l ? Math.round((r.w / (r.w + r.l)) * 100) : 0,
      w: r.w,
      l: r.l,
    }))
    .sort((a, b) => b.rate - a.rate || b.w + b.l - (a.w + a.l));
}

export function RepBars({ ranked }: { ranked: ReturnType<typeof rankReps> }) {
  if (!ranked.length) {
    return (
      <Empty>
        No closed deals yet — win rates appear once deals are marked won or lost in{' '}
        <strong>Pipeline</strong>.
      </Empty>
    );
  }
  return (
    <>
      {ranked.map((r) => (
        <div className="hbar-row" key={r.rep}>
          <div className="hbar-name" title={r.rep}>
            {r.rep.split(' ')[0]}
          </div>
          <div className="hbar-track">
            <div className="hbar-fill" style={{ width: `${r.rate}%` }} />
          </div>
          <div className="hbar-val">
            {r.rate}% · {r.w}W/{r.l}L
          </div>
        </div>
      ))}
    </>
  );
}
