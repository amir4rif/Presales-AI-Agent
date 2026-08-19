'use client';
/* Level 3 · Administrator — org-wide oversight, the AI learning loop
   and platform configuration. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fmtRM, getTeam, pct, type Stats } from '@/lib/data';
import { greeting } from '@/lib/useStats';
import { useIntegrations } from '@/lib/useIntegrations';
import { BADGE, Card, DOT, Empty, KpiRow, RepBars, plural, rankReps, Arrow } from './shared';

const ADMIN_TOOLS = [
  { n: '01', title: 'User Management', desc: 'Invite members, assign roles and set access levels.', cta: 'Manage Team' },
  { n: '02', title: 'Pipeline & SLA',  desc: 'Define stage thresholds that drive stalled-deal alerts.', cta: 'Configure' },
  { n: '03', title: 'Integrations',    desc: 'Gemini and Supabase connection readiness.', cta: 'Connect' },
  { n: '04', title: 'Data Export',     desc: 'Export the Proposal Store, team access levels and SLAs.', cta: 'Export' },
];

export default function LevelThree({ s }: { s: Stats }) {
  const router = useRouter();
  const { ai, supabase, loading } = useIntegrations();

  const team = getTeam();
  const caseCount = new Set(s.store.map((p) => p.caseId)).size;
  const killRate = pct(s.killed, s.approved + s.revise + s.killed);

  const versions: Record<string, number> = {};
  s.store.forEach((p) => {
    versions[p.caseId] = Math.max(versions[p.caseId] || 0, p.version || 1);
  });
  const avgVer = caseCount
    ? Object.values(versions).reduce((a, b) => a + b, 0) / caseCount
    : 1;
  const totalRej = Object.values(s.reasons).reduce((a, b) => a + b, 0);

  const sla = typeof window !== 'undefined' ? localStorage.getItem('ramssolStageSLA') : null;

  /* `text: true` renders the value as a phrase — the 22px mono numeric
     treatment made a reason like "Pricing too high" look like broken data. */
  const loop = [
    {
      v: s.topReason ? s.topReason[0] : 'None yet',
      text: true,
      l: 'Top Rejection Reason',
      sub: s.topReason
        ? `${s.topReason[1]} of ${plural(totalRej, 'rejection', 'rejections')}`
        : 'Nothing sent back yet',
    },
    { v: `${s.revise} : ${s.killed}`, l: 'Revise vs Close Ratio', sub: 'Fixable vs dead-end' },
    { v: `${s.approvalRate}%`, l: 'Approval Rate', sub: plural(s.approved + s.revise, 'quality-judged case', 'quality-judged cases') },
    { v: avgVer.toFixed(1), l: 'Versions per Case', sub: 'Fewer loops is better' },
  ];

  const cfg = [
    {
      ok: !!ai?.configured,
      name: 'AI API Key',
      sub: loading
        ? 'Checking…'
        : ai?.configured
          ? `Held on the server — ${ai.model}`
          : 'GEMINI_API_KEY not set in .env.local — AI features disabled',
    },
    {
      ok: !!supabase?.ready,
      name: 'Supabase Database & Auth',
      sub: loading
        ? 'Checking…'
        : supabase?.dataSource === 'seed'
          ? 'Integration prepared — offline seed data remains active'
          : supabase?.ready
            ? 'Public configuration present — Auth and RLS active'
            : `Missing: ${supabase?.missing?.join(', ') || 'Supabase public values'}`,
    },
    {
      ok: !!sla,
      name: 'Pipeline SLA Thresholds',
      sub: sla ? 'Custom thresholds saved' : 'Using default stage SLAs',
    },
    {
      ok: team.length > 0,
      name: 'User Directory',
      sub: team.length ? `${team.length} members across 3 access levels` : 'No members yet',
    },
  ];

  const activity = s.cur
    .slice()
    .sort((a, b) => (b.generatedDate || '').localeCompare(a.generatedDate || ''))
    .slice(0, 6);

  return (
    <>
      <section className="hero">
        <div>
          <span className="hero-eyebrow">
            <span className="pulse-dot" />
            Level 3 · Administrator
          </span>
          <h1 className="hero-title greeting">{greeting(s.user)}</h1>
          <p className="hero-sub">
            Full system oversight — org-wide performance, the AI learning loop, user access and
            platform configuration.
          </p>
          <div className="hero-actions">
            <Link className="btn-primary" href="/admin/settings">
              System Configuration
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <Link className="btn-secondary" href="/analytics">
              Full Analytics
            </Link>
          </div>
        </div>

        <div className="hero-panel">
          <div className="hero-panel-head">
            <span className="hero-panel-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" strokeWidth={2}>
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
              </svg>
              System Health
            </span>
            <span className="hero-live">
              <span className="pulse-dot" />
              Live
            </span>
          </div>
          <div className="hero-stats">
            <div className="hero-stat"><div className="hs-num gold">{s.endToEnd}%</div><div className="hs-lbl">End-to-end win rate</div></div>
            <div className="hero-stat"><div className="hs-num">{s.approvalRate}%</div><div className="hs-lbl">AI approval rate</div></div>
            <div className="hero-stat"><div className="hs-num">{team.length || '—'}</div><div className="hs-lbl">Active users</div></div>
            <div className="hero-stat"><div className="hs-num">{caseCount}</div><div className="hs-lbl">Total cases</div></div>
          </div>
        </div>
      </section>

      <KpiRow
        items={[
          { l: 'End-to-End Win Rate', v: `${s.endToEnd}%`, sub: 'Approval × post-approval', c: 'kpi-up' },
          { l: 'Stage 1 · Approval', v: `${s.approvalRate}%`, sub: `${s.approved} of ${s.approved + s.revise} judged`, c: 'kpi-up' },
          { l: 'Stage 2 · Post-Appr.', v: `${s.winRate}%`, sub: `${s.won} won / ${s.won + s.lost} pitched`, c: 'kpi-up' },
          { l: 'Kill Rate', v: `${killRate}%`, sub: `${s.killed} Reject & Close`, c: s.killed ? 'kpi-danger' : '' },
          { l: 'Total Pipeline', v: fmtRM(s.pipelineValue), sub: `${s.deals.length} open deals` },
          { l: 'Total Won', v: fmtRM(s.wonValue), sub: 'Closed-won, all periods', c: 'kpi-up' },
        ]}
      />

      <div className="analytics-grid">
        <Card
          title="AI Learning Loop"
          note="Rejection patterns feeding back into the AI (Doc §4.10)."
        >
          <div className="ll-grid">
            {loop.map((t) => (
              <div className="ll-tile" key={t.l}>
                <div className={`ll-val${t.text ? ' ll-text' : ''}`}>{t.v}</div>
                <div className="ll-lbl">{t.l}</div>
                <div className="ll-sub">{t.sub}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="System Configuration" link="Manage" linkHref="/admin/settings">
          {cfg.map((c) => (
            <div className="cfg-row" key={c.name}>
              <span className={`cfg-dot ${c.ok ? 'cfg-ok' : 'cfg-warn'}`} />
              <div className="cfg-info">
                <div className="cfg-name">{c.name}</div>
                <div className="cfg-sub">{c.sub}</div>
              </div>
              <Link className="cfg-act" href="/admin/settings">
                Configure
              </Link>
            </div>
          ))}
        </Card>
      </div>

      <div className="analytics-grid">
        <Card title="Organisation Performance" link="Full analytics" linkHref="/analytics">
          <RepBars ranked={rankReps(s.closed)} />
        </Card>

        <Card title="Recent System Activity" link="All approvals" linkHref="/admin/approvals">
          {activity.length ? (
            activity.map((p) => (
              <div
                className="activity-item"
                style={{ cursor: 'pointer' }}
                key={p.id}
                onClick={() => router.push('/admin/approvals')}
              >
                <div className={`activity-dot ${DOT[p.status] || 'muted'}`} />
                <div className="activity-info">
                  <div className="activity-name">{p.company}</div>
                  <div className="activity-desc">
                    {p.submittedBy} · {p.caseId || ''} · v{p.version || 1}
                  </div>
                </div>
                <div className="activity-right">
                  <div className={`status-badge ${BADGE[p.status] || 'status-draft'}`}>{p.status}</div>
                  <div className="activity-time">{p.lastUpdated || p.submittedDate || ''}</div>
                </div>
              </div>
            ))
          ) : (
            <Empty>No proposal activity yet.</Empty>
          )}
        </Card>
      </div>

      <div className="section-head">
        <h3>
          Administration <span className="accent">Tools</span>
        </h3>
        <p>Configuration that affects every user in the system.</p>
      </div>

      <div className="quick-actions">
        {ADMIN_TOOLS.map((t) => (
          <div className="qa-card" key={t.n} onClick={() => router.push('/admin/settings')}>
            <span className="qa-number">{t.n}</span>
            <div className="qa-title">{t.title}</div>
            <div className="qa-desc">{t.desc}</div>
            <button className="qa-btn">
              {t.cta}
              <Arrow />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
