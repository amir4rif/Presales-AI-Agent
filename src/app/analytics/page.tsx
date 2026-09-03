'use client';
/* Analytics — the two-stage win-rate model (Doc §4) and the AI
   learning loop (Doc §4.10). Level 2 and 3 only. */
import { useCallback, useEffect, useState } from 'react';
import RequireLevel from '@/components/RequireLevel';
import {
  STAGES,
  ensureProposalStore,
  fmtRM,
  getClosedDeals,
  pct,
  type ClosedDeal,
  type Proposal,
} from '@/lib/data';
import { rejectionReasonStats } from '@/lib/proposal-lifecycle';
import { calculateTwoStageRates } from '@/lib/stage-rates';
import { useRemoteDataRefresh } from '@/lib/useRemoteDataRefresh';

const quarterOf = (dateStr: string) => `Q${Math.ceil(+dateStr.slice(5, 7) / 3)} '${dateStr.slice(2, 4)}`;
const qSort = (a: string, b: string) => (a.slice(-2) + a[1]).localeCompare(b.slice(-2) + b[1]);

function AnalyticsPage() {
  const [closed, setClosed] = useState<ClosedDeal[]>([]);
  const [store, setStore] = useState<Proposal[]>([]);

  const reload = useCallback(() => {
    setClosed(getClosedDeals());
    setStore(ensureProposalStore());
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);
  useRemoteDataRefresh(reload);

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

  const kpis = [
    { label: 'End-to-End Win Rate', value: `${endToEnd}%`, sub: 'Approval × Post-approval', cls: 'gold' },
    { label: 'Stage 1 · Approval Rate', value: `${s1.rate}%`, sub: `${s1.approved} approved / ${s1.judged} judged`, cls: 'kpi-up' },
    { label: 'Stage 2 · Post-Approval Win', value: `${s2.rate}%`, sub: `${s2.won} won / ${s2.total} decided`, cls: 'kpi-up' },
    { label: 'Total Won Value', value: fmtRM(wonValue), sub: 'Closed-won, all periods', cls: '' },
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
    const reps: Record<string, { won: number; lost: number }> = {};
    closed.forEach((d) => {
      const r = reps[d.rep] || (reps[d.rep] = { won: 0, lost: 0 });
      if (d.outcome === 'Won') r.won++;
      else r.lost++;
    });
    return Object.entries(reps)
      .map(([rep, r]) => ({ rep, rate: pct(r.won, r.won + r.lost), w: r.won, l: r.lost }))
      .sort((a, b) => b.rate - a.rate);
  })();

  /* ── VELOCITY vs SLA ────────────────────────────────────── */
  const maxDays = Math.max(...STAGES.map((s) => Math.max(s.avgDays, s.sla)));
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

  /* ── AI LEARNING LOOP METRICS (Doc §4.10) ───────────────── */
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
    : 1;

  const tiles = [
    { val: topReasons[0]?.[0] || '—', lbl: 'Top Rejection Reason', sub: topReasons[0] ? `${topReasons[0][1]} of ${totalReject} rejections` : '' },
    { val: `${s1.revise} : ${s1.closed}`, lbl: 'Revise vs Close Ratio', sub: 'Fixable vs dead-end rejections' },
    { val: `${s1.rate}%`, lbl: 'Approval Rate (current)', sub: 'Trending up with context injection' },
    { val: avgVersions.toFixed(1), lbl: 'Revision Count per Case', sub: 'Level-1 loops before approval — fewer is better' },
  ];

  /* Approval-rate monthly trend (illustrative, Doc §4.10). */
  const approvalSeries = [
    { m: 'Feb', v: 65 }, { m: 'Mar', v: 68 }, { m: 'Apr', v: 74 },
    { m: 'May', v: 79 }, { m: 'Jun', v: 82 }, { m: 'Jul', v: s1.rate },
  ];

  return (
    <>
      <div className="page-header">
        <div className="page-title">Analytics</div>
        <div className="an-note">
          Performance insights &amp; trend analysis · <span className="level-badge level-2">Level 2</span>{' '}
          <span className="level-badge level-3">Level 3</span> access
        </div>
      </div>

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
          <div className="qtrend">
            {qKeys.map((k) => {
              const { won, lost } = quarters[k];
              const total = won + lost;
              const h = (total / maxTotal) * 150;
              return (
                <div className="qtrend-col" key={k}>
                  <div className="qtrend-pct">{pct(won, total)}%</div>
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
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Comparative Performance — by Salesperson</span>
          </div>
          {repRows.map((r) => {
            const parts = r.rep.split(' ');
            return (
              <div className="hbar-row" key={r.rep}>
                <div className="hbar-name">
                  {parts[0]} {parts[1] ? `${parts[1][0]}.` : ''}
                </div>
                <div className="hbar-track">
                  <div className="hbar-fill" style={{ width: `${r.rate}%` }} />
                </div>
                <div className="hbar-val">
                  {r.rate}% · {r.w}W/{r.l}L
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="analytics-grid">
        <div className="card">
          <div className="card-header">
            <span className="card-title">Velocity Analysis — Avg Days per Stage vs SLA</span>
          </div>
          {STAGES.map((s) => {
            const over = s.avgDays > s.sla;
            return (
              <div className="vel-row" key={s.id}>
                <div className="vel-stage">{s.name}</div>
                <div className="vel-track">
                  <div
                    className={`vel-fill ${over ? 'over' : 'ok'}`}
                    style={{ width: `${(s.avgDays / maxDays) * 100}%` }}
                  />
                  <div className="vel-sla" style={{ left: `${(s.sla / maxDays) * 100}%` }} />
                </div>
                <div className="vel-meta">
                  {s.avgDays}d / SLA {s.sla}d{over ? ' ⚠' : ''}
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
          {blockers.map(([name, n]) => (
            <div className="freq-row" key={name}>
              <div className="freq-name">{name}</div>
              <div className="freq-track">
                <div className="freq-fill" style={{ width: `${(n / maxBlocker) * 100}%` }} />
              </div>
              <div className="freq-val">{n}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div>
            <span className="card-title">AI Learning Loop</span>
            <div className="an-card-sub">
              Rejection patterns feed back into the AI to improve first drafts (Doc §4.10).
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
            Where the AI is failing most often.
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
            <div className="an-note">No rejections recorded yet.</div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Approval Rate Trend — Monthly</span>
          </div>
          <div className="an-card-sub" style={{ margin: '-10px 0 10px' }}>
            Whether Level-2 context injection is working.
          </div>
          <div className="qtrend" style={{ height: 180 }}>
            {approvalSeries.map((s) => {
              const h = (s.v / 100) * 130;
              return (
                <div className="qtrend-col" key={s.m}>
                  <div className="qtrend-pct">{s.v}%</div>
                  <div className="qtrend-stack" style={{ height: h }}>
                    <div className="qtrend-won" style={{ height: h }} />
                  </div>
                  <div className="qtrend-lbl">{s.m}</div>
                </div>
              );
            })}
          </div>
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
