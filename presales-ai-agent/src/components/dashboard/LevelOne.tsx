'use client';
/* Level 1 · Data Entry — scoped to the signed-in rep's own work. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { STAGES, fmtRM, type Stats } from '@/lib/data';
import { greeting } from '@/lib/useStats';
import { ActionStrip, Arrow, BADGE, Card, DOT, Empty } from './shared';

const QUICK = [
  { n: '01', title: 'Research a Prospect', desc: 'Let the AI Sales Agent profile a company, its pain points and buying potential.', cta: 'Open Prospects', href: '/prospects' },
  { n: '02', title: 'Draft a Proposal',    desc: 'Generate a first draft from an opportunity, then submit it for review.',        cta: 'New Proposal',  href: '/proposals' },
  { n: '03', title: 'Complete an RFP',     desc: 'Upload a compliance form and let AI fill it from the knowledge base.',          cta: 'Upload RFP',    href: '/compliance' },
  { n: '04', title: 'Update My Deals',     desc: 'Keep your assigned opportunities and stages current.',                          cta: 'My Pipeline',   href: '/pipeline' },
];

export default function LevelOne({ s }: { s: Stats }) {
  const router = useRouter();

  // Rejected work is the rep's highest priority (Doc §3.8 — rejected first)
  const rejected = s.mine.filter((p) => p.status === 'Reject & Revise');
  const mine = s.mine
    .slice()
    .sort((a, b) => (b.generatedDate || '').localeCompare(a.generatedDate || ''))
    .slice(0, 5);

  return (
    <>
      <section className="hero">
        <div>
          <span className="hero-eyebrow">
            <span className="pulse-dot" />
            Level 1 · Data Entry
          </span>
          <h1 className="hero-title greeting">{greeting(s.user)}</h1>
          <p className="hero-sub">
            Capture prospects, draft AI proposals and keep your own deals moving. Everything here is
            scoped to the work assigned to you.
          </p>
          <div className="hero-actions">
            <Link className="btn-primary" href="/prospects">
              Add a Prospect
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <Link className="btn-secondary" href="/proposals">
              My Proposals
            </Link>
          </div>
        </div>

        <div className="hero-panel">
          <div className="hero-panel-head">
            <span className="hero-panel-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" strokeWidth={2}>
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              My Work
            </span>
            <span className="hero-live">
              <span className="pulse-dot" />
              Live
            </span>
          </div>
          <div className="hero-stats">
            <div className="hero-stat"><div className="hs-num">{s.myDrafts}</div><div className="hs-lbl">Drafts in progress</div></div>
            <div className="hero-stat"><div className="hs-num">{s.myPending}</div><div className="hs-lbl">Awaiting review</div></div>
            <div className="hero-stat"><div className="hs-num gold">{s.myRevise}</div><div className="hs-lbl">Needs revision</div></div>
            <div className="hero-stat"><div className="hs-num">{s.myApproved}</div><div className="hs-lbl">Approved</div></div>
          </div>
        </div>
      </section>

      {rejected.length > 0 && (
        <ActionStrip
          icon="↩"
          title={`${rejected.length} proposal${rejected.length > 1 ? 's need' : ' needs'} your revision`}
          sub={rejected
            .map((p) => `${p.company} — ${p.rejectionReason || 'see reviewer notes'}`)
            .join(' · ')}
          cta="Fix now"
          href="/proposals"
        />
      )}

      <div className="section-head">
        <h3>
          What would you like to <span className="accent">do?</span>
        </h3>
        <p>Your day-to-day tools, powered by AI.</p>
      </div>

      <div className="quick-actions">
        {QUICK.map((q) => (
          <div className="qa-card" key={q.n} onClick={() => router.push(q.href)}>
            <span className="qa-number">{q.n}</span>
            <div className="qa-title">{q.title}</div>
            <div className="qa-desc">{q.desc}</div>
            <button className="qa-btn">
              {q.cta}
              <Arrow />
            </button>
          </div>
        ))}
      </div>

      <div className="home-grid">
        <Card title="My Recent Proposals" link="View all" linkHref="/proposals">
          <div className="row-list">
            {mine.length ? (
              mine.map((p) => (
                <div
                  className="activity-item"
                  style={{ cursor: 'pointer' }}
                  key={p.id}
                  onClick={() => router.push('/proposals')}
                >
                  <div className={`activity-dot ${DOT[p.status] || 'muted'}`} />
                  <div className="activity-info">
                    <div className="activity-name">{p.company}</div>
                    <div className="activity-desc">
                      {p.deal} · v{p.version || 1}
                    </div>
                  </div>
                  <div className="activity-right">
                    <div className={`status-badge ${BADGE[p.status] || 'status-draft'}`}>{p.status}</div>
                    <div className="activity-time">{p.lastUpdated || p.submittedDate || ''}</div>
                  </div>
                </div>
              ))
            ) : (
              <Empty>
                No proposals yet.
                <br />
                Start one from <strong>My Proposals → New Proposal</strong>.
              </Empty>
            )}
          </div>
        </Card>

        <Card title="My Assigned Deals" link="Open pipeline" linkHref="/pipeline">
          <div className="row-list">
            {s.myDeals.length ? (
              s.myDeals.slice(0, 5).map((d, i) => {
                const st = STAGES[d.stage - 1];
                const late = st && d.daysInStage > st.sla;
                return (
                  <div
                    className="activity-item"
                    style={{ cursor: 'pointer' }}
                    key={`${d.account}-${i}`}
                    onClick={() => router.push('/pipeline')}
                  >
                    <div className={`activity-dot ${late ? 'amber' : 'blue'}`} />
                    <div className="activity-info">
                      <div className="activity-name">{d.account}</div>
                      <div className="activity-desc">
                        {st?.name || `Stage ${d.stage}`} · {d.daysInStage}d in stage
                        {late ? ` · past ${st.sla}d SLA` : ''}
                      </div>
                    </div>
                    <div className="activity-right">
                      <div className="activity-time" style={{ fontWeight: 600, color: 'var(--brand-300)' }}>
                        {fmtRM(d.value)}
                      </div>
                      <div className="activity-time">{d.status}</div>
                    </div>
                  </div>
                );
              })
            ) : (
              <Empty>
                No deals assigned to you yet.
                <br />
                As a <strong>Level 1</strong> user you see only your own pipeline — add one from{' '}
                <strong>Pipeline → Add Deal</strong>.
              </Empty>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
