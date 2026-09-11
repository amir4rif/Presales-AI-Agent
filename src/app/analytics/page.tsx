'use client';
/* Analytics — the two-stage win-rate model (Doc §4) and the live
   proposal-revision queue. Level 2 and 3 only. */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import RequireLevel from '@/components/RequireLevel';
import {
  STAGES,
  ensureProposalStore,
  fmtRM,
  getClosedDeals,
  getDeals,
  getReps,
  pct,
  type ClosedDeal,
  type Deal,
  type Proposal,
} from '@/lib/data';
import {
  MIN_CLOSED_DEALS_FOR_RATE,
  MIN_COMPLETED_PROJECTS_FOR_ANALYTICS,
  analyticsReadiness,
  calculateMonthlyApprovalRates,
  calculateStageAgeAverages,
  closedDealRate,
} from '@/lib/analytics-metrics';
import { rejectionReasonStats } from '@/lib/proposal-lifecycle';
import { calculateTwoStageRates } from '@/lib/stage-rates';
import { useRemoteDataRefresh } from '@/lib/useRemoteDataRefresh';

const quarterOf = (dateStr: string) => `Q${Math.ceil(+dateStr.slice(5, 7) / 3)} '${dateStr.slice(2, 4)}`;
const qSort = (a: string, b: string) => (a.slice(-2) + a[1]).localeCompare(b.slice(-2) + b[1]);

function AnalyticsHeader() {
  return (
    <div className="page-header analytics-page-header">
      <div className="page-title">Analytics</div>
      <div className="an-note">
        Performance insights &amp; trend analysis · <span className="level-badge level-2">Level 2</span>{' '}
        <span className="level-badge level-3">Level 3</span> access
      </div>
    </div>
  );
}

function AnalyticsPage() {
  const [closed, setClosed] = useState<ClosedDeal[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [reps, setReps] = useState<string[]>([]);
  const [store, setStore] = useState<Proposal[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    setClosed(getClosedDeals());
    setDeals(getDeals());
    setReps(getReps());
    setStore(ensureProposalStore());
    setLoaded(true);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);
  useRemoteDataRefresh(reload);

  if (!loaded) {
    return (
      <>
        <AnalyticsHeader />
        <section className="analytics-readiness analytics-readiness-loading" aria-live="polite" aria-busy="true">
          <h2>Checking analytics readiness</h2>
          <p>Loading completed projects from the saved Pipeline records.</p>
        </section>
      </>
    );
  }

  const readiness = analyticsReadiness(closed.length);
  if (!readiness.ready) {
    const projectWord = readiness.remaining === 1 ? 'project' : 'projects';
    return (
      <>
        <AnalyticsHeader />
        <section className="analytics-readiness" aria-labelledby="analytics-readiness-title">
          <div className="analytics-readiness-copy">
            <h2 id="analytics-readiness-title">
              Analytics will appear after {MIN_COMPLETED_PROJECTS_FOR_ANALYTICS} completed projects
            </h2>
            <p>
              A completed project is a Pipeline deal saved with a final Won or Lost outcome. Once the third is
              recorded, every card and chart on this page is calculated from saved data only.
            </p>
          </div>

          <div className="analytics-readiness-status">
            <span>{readiness.completed} of {readiness.required} completed</span>
            <span>{readiness.remaining} more {projectWord} needed</span>
          </div>
          <div
            className="analytics-readiness-track"
            role="progressbar"
            aria-label="Completed projects required for analytics"
            aria-valuemin={0}
            aria-valuemax={readiness.required}
            aria-valuenow={readiness.completed}
          >
            <div className="analytics-readiness-bar" style={{ width: `${readiness.progress}%` }} />
          </div>

          <div className="analytics-readiness-action">
            <p>In Pipeline, select Add Deal and set its outcome to Won or Lost.</p>
            <Link className="btn-primary" href="/pipeline">Open Pipeline</Link>
          </div>
        </section>
      </>
    );
  }

  // One shared, case-level cohort feeds both stages. Stage 2 reads outcomes
  // only from approved proposals and excludes Pending outcomes.
  const stageRates = calculateTwoStageRates(store);
  const s1 = {
    approved: stageRates.approved,
    revise: stageRates.revise,
    closed: stageRates.killed,
    judged: stageRates.judged,
    rate: stageRates.approvalRate,
  };
  const s2 = {
    won: stageRates.won,
    lost: stageRates.lost,
    total: stageRates.decided,
    rate: stageRates.winRate,
  };

  const endToEnd = stageRates.endToEnd;
  const wonValue = closed.filter((d) => d.outcome === 'Won').reduce((a, d) => a + d.value, 0);
  const hasStageOne = s1.judged > 0;
  const hasStageTwo = s2.total > 0;
  const hasClosedDeals = closed.length > 0;

  const kpis = [
    {
      label: 'End-to-End Win Rate',
      value: hasStageOne && hasStageTwo ? `${endToEnd}%` : 'Not available',
      sub: !hasStageOne
        ? 'Needs an approval decision'
        : !hasStageTwo
          ? 'Needs an approved case marked won or lost'
          : 'Approval × Post-approval',
      cls: hasStageOne && hasStageTwo ? 'gold' : 'is-unavailable',
    },
    {
      label: 'Stage 1 · Approval Rate',
      value: hasStageOne ? `${s1.rate}%` : 'Not available',
      sub: hasStageOne ? `${s1.approved} approved / ${s1.judged} judged` : 'Needs an approved or revise decision',
      cls: hasStageOne ? 'kpi-up' : 'is-unavailable',
    },
    {
      label: 'Stage 2 · Post-Approval Win',
      value: hasStageTwo ? `${s2.rate}%` : 'Not available',
      sub: hasStageTwo ? `${s2.won} won / ${s2.total} decided` : 'Needs an approved case marked won or lost',
      cls: hasStageTwo ? 'kpi-up' : 'is-unavailable',
    },
    {
      label: 'Total Won Value',
      value: hasClosedDeals ? fmtRM(wonValue) : 'Not available',
      sub: hasClosedDeals ? 'Closed-won, all periods' : 'Needs a closed deal marked won or lost',
      cls: hasClosedDeals ? '' : 'is-unavailable',
    },
  ];

  /* ── QUARTERLY TREND ────────────────────────────────────── */
  const quarters: Record<string, { won: number; lost: number }> = {};
  closed.forEach((d) => {
    const k = quarterOf(d.closeDate);
    const q = quarters[k] || (quarters[k] = { won: 0, lost: 0 });
    if (d.outcome === 'Won') q.won++;
    else q.lost++;
  });
  const qKeys = Object.keys(quarters).sort(qSort);
  const maxTotal = Math.max(...qKeys.map((k) => quarters[k].won + quarters[k].lost), 1);

  /* ── BY SALESPERSON ─────────────────────────────────────── */
  const repRows = (() => {
    const repsByName: Record<string, { won: number; lost: number }> = {};
    closed.forEach((d) => {
      const r = repsByName[d.rep] || (repsByName[d.rep] = { won: 0, lost: 0 });
      if (d.outcome === 'Won') r.won++;
      else r.lost++;
    });
    return reps
      .map((rep) => {
        const r = repsByName[rep] || { won: 0, lost: 0 };
        return {
          rep,
          rate: closedDealRate(r.won, r.won + r.lost),
          w: r.won,
          l: r.lost,
        };
      })
      .sort((a, b) =>
        Number(b.rate !== null) - Number(a.rate !== null)
        || (b.rate ?? -1) - (a.rate ?? -1)
        || b.w + b.l - (a.w + a.l)
      );
  })();

  /* ── VELOCITY vs SLA ────────────────────────────────────── */
  const stageAverages = calculateStageAgeAverages(STAGES, deals);
  const maxDays = Math.max(...stageAverages.map((s) => Math.max(s.avgDays || 0, s.sla)), 1);
  const { reasons } = rejectionReasonStats(store);

  /* ── BLOCKER FREQUENCY ──────────────────────────────────── */
  const blockers = (() => {
    const counts: Record<string, number> = {};
    closed
      .filter((d) => d.outcome === 'Lost' && d.lossReason)
      .forEach((d) => (counts[d.lossReason] = (counts[d.lossReason] || 0) + 1));
    Object.entries(reasons).forEach(([reason, count]) => {
      counts[reason] = (counts[reason] || 0) + count;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  })();
  const maxBlocker = Math.max(...blockers.map((r) => r[1]), 1);

  /* ── CURRENT PROPOSAL-REVISION METRICS ──────────────────── */
  const topReasons = Object.entries(reasons).sort((a, b) => b[1] - a[1]);
  const totalReject = topReasons.reduce((a, r) => a + r[1], 0);
  const maxReason = Math.max(...topReasons.map((r) => r[1]), 1);

  const caseVersions: Record<string, number> = {};
  store.forEach((p) => {
    caseVersions[p.caseId] = Math.max(caseVersions[p.caseId] || 0, p.version || 1);
  });
  const caseCount = Object.keys(caseVersions).length;
  const avgVersions = caseCount
    ? Object.values(caseVersions).reduce((a, b) => a + b, 0) / caseCount
    : null;

  const tiles = [
    {
      val: topReasons[0]?.[0] || '—',
      lbl: 'Top Rejection Reason',
      sub: topReasons[0]
        ? `${topReasons[0][1]} of ${totalReject} waiting for revision`
        : 'Nothing waiting for revision.',
    },
    {
      val: s1.revise + s1.closed ? `${s1.revise} : ${s1.closed}` : '—',
      lbl: 'Revise vs Close Ratio',
      sub: s1.revise + s1.closed ? 'Open for revision vs closed' : 'Needs a revised or closed case',
    },
    {
      val: hasStageOne ? `${s1.rate}%` : '—',
      lbl: 'Approval Rate (current)',
      sub: hasStageOne ? `${s1.approved} approved / ${s1.judged} judged` : 'Needs an approved or revise decision',
    },
    {
      val: avgVersions === null ? '—' : avgVersions.toFixed(1),
      lbl: 'Revision Count per Case',
      sub: avgVersions === null ? 'Needs at least one proposal case' : 'Level-1 loops before approval — fewer is better',
    },
  ];

  const approvalSeries = calculateMonthlyApprovalRates(store);

  return (
    <>
      <AnalyticsHeader />

      <div className="kpi-row">
        {kpis.map((k) => (
          <div className="kpi-card" key={k.label}>
            <div className="kpi-label">{k.label}</div>
            <div className={`kpi-value ${k.cls}`}>{k.value}</div>
            <div className="kpi-sub">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="analytics-grid">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Win Rate Trend — Quarterly</span>
          </div>
          {qKeys.length ? (
            <>
              <div className="an-card-sub" style={{ margin: '-10px 0 10px' }}>
                Rates appear with at least {MIN_CLOSED_DEALS_FOR_RATE} closed deals per quarter.
              </div>
              <div className="qtrend">
                {qKeys.map((k) => {
                  const { won, lost } = quarters[k];
                  const total = won + lost;
                  const rate = closedDealRate(won, total);
                  const h = (total / maxTotal) * 150;
                  return (
                    <div className="qtrend-col" key={k} title={`${won} won, ${lost} lost`}>
                      <div className="qtrend-pct">{rate === null ? '—' : `${rate}%`}</div>
                      <div className="qtrend-stack" style={{ height: h }}>
                        <div className="qtrend-won" style={{ height: total ? (won / total) * h : 0 }} />
                        <div className="qtrend-lost" style={{ height: total ? (lost / total) * h : 0 }} />
                      </div>
                      <div className="qtrend-lbl">{k}</div>
                    </div>
                  );
                })}
              </div>
              <div className="an-legend">
                <span>
                  <span className="an-dot" style={{ background: 'linear-gradient(180deg,var(--teal),var(--brand-600))' }} />
                  Won
                </span>
                <span>
                  <span className="an-dot" style={{ background: 'var(--gray-200)' }} />
                  Lost
                </span>
                <span>
                  <span className="an-dot" style={{ background: 'var(--gold)' }} />
                  Win rate %
                </span>
              </div>
            </>
          ) : (
            <div className="empty-hint">Needs at least {MIN_CLOSED_DEALS_FOR_RATE} closed deals to show a trend.</div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Comparative Performance — by Salesperson</span>
          </div>
          <div className="an-card-sub" style={{ margin: '-10px 0 10px' }}>
            Rates appear after at least {MIN_CLOSED_DEALS_FOR_RATE} closed deals per salesperson.
          </div>
          {repRows.length ? (
            repRows.map((r) => {
              const parts = r.rep.split(' ');
              return (
                <div className="hbar-row" key={r.rep}>
                  <div className="hbar-name" title={r.rep}>
                    {parts[0]} {parts[1] ? `${parts[1][0]}.` : ''}
                  </div>
                  <div className="hbar-track">
                    <div className="hbar-fill" style={{ width: `${r.rate || 0}%` }} />
                  </div>
                  <div className={`hbar-val${r.rate === null ? ' is-unavailable' : ''}`}>
                    {r.rate === null ? `${r.w + r.l}/${MIN_CLOSED_DEALS_FOR_RATE} deals` : `${r.rate}% · ${r.w}W/${r.l}L`}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="empty-hint">Needs at least {MIN_CLOSED_DEALS_FOR_RATE} closed deals to compare salespeople.</div>
          )}
        </div>
      </div>

      <div className="analytics-grid">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Average Current Days in Stage vs SLA</span>
          </div>
          {stageAverages.map((s) => {
            const over = s.avgDays !== null && s.avgDays > s.sla;
            return (
              <div className="vel-row" key={s.id}>
                <div className="vel-stage">{s.name}</div>
                <div className="vel-track">
                  {s.avgDays !== null && (
                    <div
                      className={`vel-fill ${over ? 'over' : 'ok'}`}
                      style={{ width: `${(s.avgDays / maxDays) * 100}%` }}
                    />
                  )}
                  <div className="vel-sla" style={{ left: `${(s.sla / maxDays) * 100}%` }} />
                </div>
                <div className="vel-meta">
                  {s.avgDays === null ? 'No active deals' : `${s.avgDays}d / SLA ${s.sla}d${over ? ' ⚠' : ''}`}
                </div>
              </div>
            );
          })}
          <div className="an-legend">
            <span>
              <span className="an-dot" style={{ background: 'var(--gold)' }} />
              SLA target
            </span>
            <span>
              <span className="an-dot" style={{ background: 'var(--amber-600)' }} />
              Over SLA
            </span>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Blocker Frequency — by Category</span>
          </div>
          <div className="an-card-sub" style={{ margin: '-10px 0 10px' }}>
            Combines client loss reasons and internal rejection reasons.
          </div>
          {blockers.length ? (
            blockers.map(([name, n]) => (
              <div className="freq-row" key={name}>
                <div className="freq-name">{name}</div>
                <div className="freq-track">
                  <div className="freq-fill" style={{ width: `${(n / maxBlocker) * 100}%` }} />
                </div>
                <div className="freq-val">{n}</div>
              </div>
            ))
          ) : (
            <div className="an-note">Nothing waiting for revision.</div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <span className="card-title">What Needs Fixing Now</span>
            <div className="an-card-sub">
              A live view of proposals sent back to sales. Resolved cases drop off this list.
            </div>
          </div>
        </div>
        <div className="ll-grid">
          {tiles.map((t) => (
            <div className="ll-tile" key={t.lbl}>
              <div className="ll-val">{t.val}</div>
              <div className="ll-lbl">{t.lbl}</div>
              <div className="ll-sub">{t.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="analytics-grid">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Top 5 Rejection Reasons</span>
          </div>
          <div className="an-card-sub" style={{ margin: '-10px 0 10px' }}>
            Reasons on proposals currently open for revision.
          </div>
          {topReasons.length ? (
            topReasons.slice(0, 5).map(([name, n]) => (
              <div className="freq-row" key={name}>
                <div className="freq-name">{name}</div>
                <div className="freq-track">
                  <div className="freq-fill" style={{ width: `${(n / maxReason) * 100}%` }} />
                </div>
                <div className="freq-val">
                  {n} · {pct(n, totalReject)}%
                </div>
              </div>
            ))
          ) : (
            <div className="an-note">Nothing waiting for revision.</div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Approval Rate Trend — Monthly</span>
          </div>
          <div className="an-card-sub" style={{ margin: '-10px 0 10px' }}>
            Approved vs sent back for revision, grouped by review month.
          </div>
          {approvalSeries.length ? (
            <div className="qtrend" style={{ height: 180 }}>
              {approvalSeries.map((s) => {
                const h = (s.rate / 100) * 130;
                return (
                  <div
                    className="qtrend-col"
                    key={s.key}
                    title={`${s.approved} approved, ${s.revised} sent back for revision`}
                  >
                    <div className="qtrend-pct">{s.rate}%</div>
                    <div className="qtrend-stack" style={{ height: Math.max(h, s.rate ? 4 : 0) }}>
                      <div className="qtrend-won" style={{ height: Math.max(h, s.rate ? 4 : 0) }} />
                    </div>
                    <div className="qtrend-lbl">{s.label}</div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-hint">Needs reviewed proposals across at least one month.</div>
          )}
        </div>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <RequireLevel min={2}>
      <AnalyticsPage />
    </RequireLevel>
  );
}
