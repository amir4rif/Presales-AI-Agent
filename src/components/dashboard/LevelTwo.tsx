'use client';
/* Level 2 · Reviewer — team-wide visibility, review queue first. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { STAGES, fmtRM, type Stats } from '@/lib/data';
import { dealNeedsOutcome, dealOutcomeEscalated, dealOutcomeOverdueDays } from '@/lib/deal-outcomes';
import { greeting } from '@/lib/useStats';
import { ActionStrip, Card, Empty, KpiRow, RepBars, plural, rankReps } from './shared';

/* Only call out a leader or a laggard once there are enough closed deals
   for the gap to mean anything. */
const CONFIDENT = 3;

export default function LevelTwo({ s }: { s: Stats }) {
  const router = useRouter();
  const queue = s.cur.filter((p) => p.status === 'Pending Review');
  const disqualificationQueue = s.deals.filter((deal) => deal.pendingDisqualificationReason);
  const ranked = rankReps(s.closed);
  const eligible = ranked.filter((r) => r.w + r.l >= CONFIDENT);
  const best = eligible[0];
  const worst = eligible.length > 1 ? eligible[eligible.length - 1] : null;

  return (
    <>
      <section className="hero">
        <div>
          <span className="hero-eyebrow">
            <span className="pulse-dot" />
            Level 2 · Reviewer
          </span>
          <h1 className="hero-title greeting">{greeting(s.user)}</h1>
          <p className="hero-sub">
            Review and validate what your team submits, then keep the whole pipeline healthy. You
            have full team-wide visibility.
          </p>
          <div className="hero-actions">
            <Link className="btn-primary" href="/admin/approvals">
              Open Review Queue
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
            </Link>
            <Link className="btn-secondary" href="/analytics">
              Team Analytics
            </Link>
          </div>
        </div>

        <div className="hero-panel">
          <div className="hero-panel-head">
            <span className="hero-panel-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand-400)" strokeWidth={2}>
                <path d="M3 3v18h18" />
                <path d="M18 9l-5 5-3-3-4 4" />
              </svg>
              Team Snapshot
            </span>
            <span className="hero-live">
              <span className="pulse-dot" />
              Live
            </span>
          </div>
          <div className="hero-stats">
            <div className="hero-stat"><div className="hs-num gold">{s.pending}</div><div className="hs-lbl">Awaiting review</div></div>
            <div className="hero-stat"><div className="hs-num">{s.approvalRate}%</div><div className="hs-lbl">Approval rate</div></div>
            <div className="hero-stat"><div className="hs-num">{s.winRate}%</div><div className="hs-lbl">Post-approval win</div></div>
            <div className="hero-stat"><div className="hs-num">{s.attentionDeals.length}</div><div className="hs-lbl">Deals needing attention</div></div>
          </div>
        </div>
      </section>

      {queue.length > 0 && (
        <ActionStrip
          icon="📥"
          title={`${queue.length} proposal${queue.length > 1 ? 's are' : ' is'} waiting for your review`}
          sub={`${fmtRM(queue.reduce((a, p) => a + (p.value || 0), 0))} of deal value is blocked until you decide.`}
          cta="Review now"
          href="/admin/approvals"
        />
      )}

      {disqualificationQueue.length > 0 && (
        <ActionStrip
          icon="!"
          title={`${disqualificationQueue.length} disqualification request${disqualificationQueue.length === 1 ? '' : 's'} need a decision`}
          sub="Commission-impacting outcomes stay Open until you approve or decline them."
          cta="Review requests"
          href="/pipeline"
        />
      )}

      {s.escalatedOutcomeDeals.length > 0 && (
        <ActionStrip
          icon="!"
          title={`${s.escalatedOutcomeDeals.length} overdue deal${s.escalatedOutcomeDeals.length === 1 ? ' has' : 's have'} escalated to you`}
          sub="These deals are still Open and scored in pipeline value, but their target close dates passed at least 14 days ago."
          cta="Resolve outcomes"
          href="/pipeline"
        />
      )}

      <KpiRow
        items={[
          { l: 'Pending Review', v: s.pending, sub: 'Awaiting a decision', c: s.pending ? 'kpi-warn' : '' },
          { l: 'Approval Rate', v: `${s.approvalRate}%`, sub: 'Stage 1 · quality-judged', c: 'kpi-up' },
          { l: 'Post-Approval Win', v: `${s.winRate}%`, sub: `${s.won}W / ${s.won + s.lost} decided`, c: 'kpi-up' },
          { l: 'Team Pipeline', v: fmtRM(s.pipelineValue), sub: `${s.deals.length} open deals` },
          { l: 'Weighted', v: fmtRM(s.weighted), sub: 'Probability-adjusted' },
          { l: 'Needs Outcome', v: s.needsOutcome.length, sub: `${s.escalatedOutcomeDeals.length} escalated at 14+ days`, c: s.needsOutcome.length ? 'kpi-danger' : '' },
        ]}
      />

      <div className="analytics-grid">
        <Card title="Review Queue" link="Open approvals" linkHref="/admin/approvals">
          {queue.length ? (
            queue.slice(0, 6).map((p) => (
              <div className="queue-row" key={p.id}>
                <div className="qr-info">
                  <div className="qr-name">{p.company}</div>
                  <div className="qr-sub">
                    {p.submittedBy} · v{p.version || 1} · {p.caseId || ''}
                  </div>
                </div>
                <div className="qr-val">{fmtRM(p.value)}</div>
                <Link className="btn-secondary qr-btn" href="/admin/approvals">
                  Review
                </Link>
              </div>
            ))
          ) : (
            <Empty>Nothing waiting — the queue is clear 🎉</Empty>
          )}
        </Card>

        <Card title="Team Performance" link="Full analytics" linkHref="/analytics">
          <RepBars ranked={ranked} />
        </Card>
      </div>

      <div className="analytics-grid">
        <Card title="Deals Needing Attention" link="Open pipeline" linkHref="/pipeline">
          {s.attentionDeals.length ? (
            s.attentionDeals.slice(0, 6).map((d, i) => {
              const st = STAGES[d.stage - 1];
              const needsOutcome = dealNeedsOutcome(d);
              return (
                <div
                  className="activity-item"
                  style={{ cursor: 'pointer' }}
                  key={`${d.account}-${i}`}
                  onClick={() => router.push('/pipeline')}
                >
                  <div
                    className={`activity-dot ${
                      needsOutcome || d.status === 'Stalled' || d.status === 'At Risk' ? 'red' : 'amber'
                    }`}
                  />
                  <div className="activity-info">
                    <div className="activity-name">{d.account}</div>
                    <div className="activity-desc">
                      {d.rep} · {needsOutcome
                        ? `Needs Outcome · ${dealOutcomeOverdueDays(d)}d overdue${dealOutcomeEscalated(d) ? ' · escalated' : ''}`
                        : `${st?.name || `Stage ${d.stage}`} · ${d.daysInStage}d of ${st?.sla}d SLA`}
                    </div>
                  </div>
                  <div className="activity-right">
                    <div className="activity-time" style={{ fontWeight: 600, color: 'var(--gold-soft)' }}>
                      {fmtRM(d.value)}
                    </div>
                    <div className="activity-time">{d.status}</div>
                  </div>
                </div>
              );
            })
          ) : (
            <Empty>No stage-SLA or overdue-outcome issues.</Empty>
          )}
        </Card>

        <Card title="Coaching Signals">
          <div className="insights-list">
            <div className="insight-item">
              <div className="insight-dot green" />
              <div className="insight-text">
                {best ? (
                  <>
                    <strong>
                      {best.rep} leads at {best.rate}%
                    </strong>{' '}
                    across {plural(best.w + best.l, 'closed deal', 'closed deals')} — worth
                    replicating their approach across the team.
                  </>
                ) : (
                  <>
                    <strong>Not enough closed deals to rank the team yet</strong> — at least{' '}
                    {CONFIDENT} per rep are needed.
                  </>
                )}
              </div>
            </div>

            <div className="insight-item">
              <div className="insight-dot red" />
              <div className="insight-text">
                {worst && worst !== best ? (
                  <>
                    <strong>
                      {worst.rep} is converting at {worst.rate}%
                    </strong>{' '}
                    over {plural(worst.w + worst.l, 'closed deal', 'closed deals')} — a good
                    candidate for deal coaching.
                  </>
                ) : (
                  <>
                    <strong>No coaching outlier</strong> — win rates are within a normal spread.
                  </>
                )}
              </div>
            </div>

            <div className="insight-item">
              <div className="insight-dot gold" />
              <div className="insight-text">
                {s.topReason ? (
                  <>
                    <strong>“{s.topReason[0]}” is the top rejection reason</strong> (
                    {plural(s.topReason[1], 'case', 'cases')}) — brief the team before the next
                    submission.
                  </>
                ) : (
                  <>
                    <strong>No rejection pattern yet</strong> — nothing has been sent back for
                    revision.
                  </>
                )}
              </div>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Outcome Hygiene by Rep" note="Open deals past their target close date; escalation begins at 14 days overdue.">
        {s.outcomeHygiene.length ? (
          <div className="hygiene-table" role="table" aria-label="Outcome hygiene counts by salesperson">
            <div className="hygiene-row hygiene-head" role="row">
              <span role="columnheader">Salesperson</span>
              <span role="columnheader">Needs Outcome</span>
              <span role="columnheader">Escalated</span>
            </div>
            {s.outcomeHygiene.map((row) => (
              <div className="hygiene-row" role="row" key={row.rep}>
                <strong role="cell">{row.rep}</strong>
                <span role="cell">{row.needsOutcome}</span>
                <span role="cell" className={row.escalated ? 'hygiene-escalated' : ''}>{row.escalated}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty>No open deal is past its target close date.</Empty>
        )}
      </Card>
    </>
  );
}
