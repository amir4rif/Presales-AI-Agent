'use client';
/* Pipeline Dashboard + Win Rate view (Doc §4.12 / §4.13).

   Level 1 sees only its own assigned pipeline; Levels 2/3 see
   team-wide (Doc §2). */
import { useCallback, useEffect, useMemo, useState } from 'react';
import RequireLevel from '@/components/RequireLevel';
import { useToast } from '@/components/Toast';
import AddDealModal, {
  DEAL_SOURCES as SOURCES,
  emptyDealDraft,
  type DealDraft,
} from '@/components/deals/AddDealModal';
import {
  STAGES as BASE_STAGES,
  currentLevel,
  currentUser,
  currentUserId,
  fmtRM,
  getClosedDeals,
  getDeals,
  getReps,
  profileIdForName,
  saveClosedDeals,
  saveDeals,
  type ClosedDeal,
  type Deal,
} from '@/lib/data';
import {
  MIN_CLOSED_DEALS_FOR_RATE,
  closedDealRate,
} from '@/lib/analytics-metrics';
import { useRemoteDataRefresh } from '@/lib/useRemoteDataRefresh';

const MOVEMENT_CLASS: Record<string, string> = { Advanced: 'movement-up', Held: 'movement-held', Regressed: 'movement-down' };
const MOVEMENT_ICON: Record<string, string> = { Advanced: '▲', Held: '—', Regressed: '▼' };

const statusClass = (s: string) => (s === 'On Track' ? 'comply-yes' : s === 'At Risk' ? 'comply-wip' : 'comply-no');
const stageClass = (n: number) => (n >= 6 ? 'stage-negotiation' : n >= 4 ? 'stage-proposal' : 'stage-qualification');
const quarterOf = (dateStr: string) => `Q${Math.ceil(+dateStr.slice(5, 7) / 3)} '${dateStr.slice(2, 4)}`;
/* Chronological sort for "Q3 '25" style labels → year then quarter. */
const qSort = (a: string, b: string) => (a.slice(-2) + a[1]).localeCompare(b.slice(-2) + b[1]);

function PipelinePage() {
  const toast = useToast();
  const [level, setLevel] = useState(1);
  const [me, setMe] = useState('');
  const [reps, setReps] = useState<string[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [closed, setClosed] = useState<ClosedDeal[]>([]);
  const [stages, setStages] = useState(BASE_STAGES);

  const [tab, setTab] = useState<'pipeline' | 'winrate'>('pipeline');
  const [repFilter, setRepFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [dealSearch, setDealSearch] = useState('');
  const [wrSearch, setWrSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<DealDraft>(() => emptyDealDraft(''));
  const meId = currentUserId();

  const reload = useCallback(() => {
    setDeals(getDeals());
    setClosed(getClosedDeals());
    const name = currentUser();
    const list = getReps();
    setReps(currentLevel() === 1 && !list.includes(name) ? [name, ...list] : list);
  }, []);

  useEffect(() => {
    const lvl = currentLevel();
    const name = currentUser();
    setLevel(lvl);
    setMe(name);
    reload();
    setForm((f) => ({ ...f, rep: name }));
    /* Stages come from the shared store, with any custom SLA thresholds
       saved by an administrator in Settings → Pipeline & SLA applied. */
    try {
      const saved = JSON.parse(localStorage.getItem('ramssolStageSLA') || '{}');
      setStages(BASE_STAGES.map((s) => ({ ...s, sla: saved[s.id] || s.sla })));
    } catch {
      setStages(BASE_STAGES);
    }
  }, [reload]);
  useRemoteDataRefresh(reload);

  const stageOf = useCallback((d: Deal) => stages[d.stage - 1], [stages]);

  /* Level-scoped view of closed deals. */
  const visibleClosed = useMemo(
    () =>
      level === 1
        ? closed.filter((d) => (meId && d.ownerId ? d.ownerId === meId : d.rep === me))
        : closed,
    [closed, level, me, meId]
  );

  const filtered = useMemo(() => {
    // Level 1 → own pipeline only
    let out = level === 1
      ? deals.filter((d) => (meId && d.ownerId ? d.ownerId === meId : d.rep === me))
      : repFilter !== 'all'
        ? deals.filter((d) => d.rep === repFilter)
        : deals;
    if (statusFilter !== 'all') out = out.filter((d) => d.status === statusFilter);
    return out;
  }, [deals, level, me, meId, repFilter, statusFilter]);

  const tableDeals = useMemo(() => {
    const q = dealSearch.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter(
      (d) => d.account.toLowerCase().includes(q) || d.rep.toLowerCase().includes(q)
    );
  }, [filtered, dealSearch]);

  /* ── KPIs ─────────────────────────────────────────────── */
  const total = filtered.reduce((a, d) => a + d.value, 0);
  const weighted = filtered.reduce((a, d) => a + d.value * (stageOf(d)?.prob || 0), 0);
  const stalled = filtered.filter((d) => d.daysInStage > (stageOf(d)?.sla ?? Infinity)).length;
  const closeSoon = filtered.filter((d) => d.daysToClose <= 30).length;

  const kpis = [
    { label: 'Active Deals', value: filtered.length, sub: '', color: '' },
    { label: 'Total Pipeline', value: fmtRM(total), sub: 'Gross value', color: '' },
    { label: 'Weighted', value: fmtRM(weighted), sub: 'Probability-adjusted', color: 'kpi-up' },
    { label: 'Stalled Deals', value: stalled, sub: 'Past SLA', color: stalled > 0 ? 'kpi-danger' : '' },
    { label: 'Close ≤30 Days', value: closeSoon, sub: 'Immediate attention', color: closeSoon > 0 ? 'kpi-warn' : '' },
    { label: 'Coverage', value: 'Not available', sub: 'Needs a configured pipeline target', color: 'is-unavailable' },
  ];

  /* ── Funnel ───────────────────────────────────────────── */
  const stageGroups: Record<number, { count: number; value: number }> = {};
  filtered.forEach((d) => {
    const g = stageGroups[d.stage] || (stageGroups[d.stage] = { count: 0, value: 0 });
    g.count++;
    g.value += d.value;
  });
  const maxVal = Math.max(...Object.values(stageGroups).map((g) => g.value), 1);

  /* ── Rep chart ────────────────────────────────────────── */
  const repData = reps
    .map((r) => {
      const rd = filtered.filter((d) => d.rep === r);
      return {
        name: r.split(' ')[0],
        gross: rd.reduce((a, d) => a + d.value, 0),
        wt: rd.reduce((a, d) => a + d.value * (stageOf(d)?.prob || 0), 0),
      };
    })
    .filter((r) => r.gross > 0);
  const maxGross = Math.max(...repData.map((r) => r.gross), 1);

  /* ── Win-rate aggregates ──────────────────────────────── */
  const won = visibleClosed.filter((d) => d.outcome === 'Won');
  const lost = visibleClosed.filter((d) => d.outcome === 'Lost');
  const wonValue = won.reduce((a, d) => a + d.value, 0);
  const lostValue = lost.reduce((a, d) => a + d.value, 0);
  const overallRate = closedDealRate(won.length, visibleClosed.length);

  const quarters: Record<string, { won: number; lost: number }> = {};
  visibleClosed.forEach((d) => {
    const k = quarterOf(d.closeDate);
    const q = quarters[k] || (quarters[k] = { won: 0, lost: 0 });
    if (d.outcome === 'Won') q.won++;
    else q.lost++;
  });
  const qKeys = Object.keys(quarters).sort(qSort);
  const maxTotal = Math.max(...qKeys.map((k) => quarters[k].won + quarters[k].lost), 1);

  const repRates = (() => {
    const acc: Record<string, { w: number; l: number }> = {};
    visibleClosed.forEach((d) => {
      const r = acc[d.rep] || (acc[d.rep] = { w: 0, l: 0 });
      if (d.outcome === 'Won') r.w++;
      else r.l++;
    });
    return reps
      .map((rep) => {
        const r = acc[rep] || { w: 0, l: 0 };
        return { rep, rate: closedDealRate(r.w, r.w + r.l), w: r.w, l: r.l };
      })
      .sort((a, b) =>
        Number(b.rate !== null) - Number(a.rate !== null)
        || (b.rate ?? -1) - (a.rate ?? -1)
        || b.w + b.l - (a.w + a.l)
      );
  })();

  const tiers = [
    { name: '< RM 2M', cls: 'tier-hi', test: (v: number) => v < 2000000 },
    { name: 'RM 2M – 3.5M', cls: 'tier-mid', test: (v: number) => v >= 2000000 && v <= 3500000 },
    { name: '> RM 3.5M', cls: 'tier-lo', test: (v: number) => v > 3500000 },
  ];

  const sourceRates = (() => {
    const acc: Record<string, { w: number; l: number }> = {};
    visibleClosed.forEach((d) => {
      const s = acc[d.source] || (acc[d.source] = { w: 0, l: 0 });
      if (d.outcome === 'Won') s.w++;
      else s.l++;
    });
    return SOURCES.filter((s) => acc[s]).map((s) => ({
      source: s,
      rate: closedDealRate(acc[s].w, acc[s].w + acc[s].l),
      ...acc[s],
    }));
  })();

  const closedHistory = useMemo(() => {
    const q = wrSearch.trim().toLowerCase();
    return visibleClosed
      .filter((d) => !q || d.account.toLowerCase().includes(q) || d.rep.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => (b.closeDate || '').localeCompare(a.closeDate || ''));
  }, [visibleClosed, wrSearch]);

  async function addDeal(draft: DealDraft) {
    const value = Number(draft.value) || 0;

    if (draft.outcome === 'Won' || draft.outcome === 'Lost') {
      // Manual closed-deal entry → feeds the Win Rate view (Doc §4.13).
      const next: ClosedDeal[] = [
        ...closed,
        {
          ownerId: draft.rep === me ? meId || profileIdForName(draft.rep) : profileIdForName(draft.rep),
          rep: draft.rep,
          account: draft.account.trim(),
          value,
          closeDate: draft.close || new Date().toISOString().slice(0, 10),
          source: draft.source,
          outcome: draft.outcome,
          lossReason: draft.outcome === 'Lost' ? draft.loss : '',
        },
      ];
      const saved = await saveClosedDeals(next);
      if (!saved) return false;
      setClosed(next);
      setAddOpen(false);
      setForm(emptyDealDraft(me));
      setTab('winrate');
      toast('✅ Closed deal added');
      return true;
    }

    const next: Deal[] = [
      ...deals,
      {
        ownerId: draft.rep === me ? meId || profileIdForName(draft.rep) : profileIdForName(draft.rep),
        rep: draft.rep,
        account: draft.account.trim(),
        stage: Number(draft.stage),
        daysInStage: Number(draft.days) || 1,
        daysToClose: 90,
        value,
        movement: 'Advanced',
        status: 'On Track',
        notes: draft.notes.trim(),
      },
    ];
    const saved = await saveDeals(next);
    if (!saved) return false;
    setDeals(next);
    setAddOpen(false);
    setForm(emptyDealDraft(me));
    toast('✅ Deal added to the pipeline');
    return true;
  }

  return (
    <>
      <div className="page-header pipeline-page-header">
        {/* Level 1 owns a single, personal pipeline view (Doc §2). */}
        <div className="page-title">{level === 1 ? 'My Pipeline' : 'Pipeline Dashboard'}</div>
        <div className="toolbar">
          {level > 1 && (
            <select className="owner-select" value={repFilter} onChange={(e) => setRepFilter(e.target.value)}>
              <option value="all">All Owners</option>
              {reps.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          )}
          <select className="owner-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All Statuses</option>
            <option>On Track</option>
            <option>At Risk</option>
            <option>Stalled</option>
          </select>
          <button className="btn-primary" onClick={() => setAddOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Deal
          </button>
        </div>
      </div>

      <div className="subtab-row">
        <button className={`subtab${tab === 'pipeline' ? ' active' : ''}`} onClick={() => setTab('pipeline')}>
          Pipeline
        </button>
        <button className={`subtab${tab === 'winrate' ? ' active' : ''}`} onClick={() => setTab('winrate')}>
          Win Rate
        </button>
      </div>

      {tab === 'pipeline' ? (
        <div>
          <div className="winrate-hero">
            <div className="wh-num">{overallRate === null ? '—' : `${overallRate}%`}</div>
            <div className="wh-body">
              <div className="wh-label">Overall Win Rate</div>
              <div className="wh-sub">
                {overallRate === null
                  ? `Needs at least ${MIN_CLOSED_DEALS_FOR_RATE} closed deals · ${visibleClosed.length} recorded`
                  : `${won.length} won of ${visibleClosed.length} closed deals · no-decision counts as a loss (Doc §4.7)`}
              </div>
            </div>
            <div className="wh-spark">
              {qKeys.map((k) => {
                const r = closedDealRate(quarters[k].won, quarters[k].won + quarters[k].lost);
                if (r === null) return null;
                return (
                  <div className="bar" key={k} style={{ height: Math.max(r * 0.42, 4) }} title={`${k}: ${r}%`} />
                );
              })}
            </div>
          </div>

          <div className="kpi-row">
            {kpis.map((k) => (
              <div className="kpi-card" key={k.label}>
                <div className="kpi-label">{k.label}</div>
                <div className={`kpi-value ${k.color}`}>{k.value}</div>
                <div className="kpi-sub">{k.sub}</div>
              </div>
            ))}
          </div>

          <div className="pipeline-grid">
            <div className="card">
              <div className="card-header">
                <span className="card-title">Pipeline Funnel</span>
              </div>
              <div className="card-pad">
                {stages.map((s) => {
                  const g = stageGroups[s.id] || { count: 0, value: 0 };
                  return (
                    <div className="funnel-row" key={s.id}>
                      <div className="funnel-stage">{s.name}</div>
                      <div className="funnel-bar">
                        <div className="funnel-bar-fill" style={{ width: `${((g.value / maxVal) * 100).toFixed(0)}%` }} />
                      </div>
                      <div className="funnel-val">{g.value ? fmtRM(g.value) : '—'}</div>
                      <div className="funnel-count">{g.count || ''}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Pipeline by Salesperson</span>
              </div>
              <div className="card-pad">
                <div style={{ display: 'flex', gap: 12, marginBottom: 10, fontSize: 11, color: 'var(--gray-500)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 3, background: 'var(--brand-200)', borderRadius: 2, display: 'inline-block' }} />
                    Gross
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 3, background: 'var(--brand-500)', borderRadius: 2, display: 'inline-block' }} />
                    Weighted
                  </span>
                </div>
                {repData.map((r) => (
                  <div className="rep-bar-row" style={{ marginBottom: 8 }} key={r.name}>
                    <div className="rep-name">{r.name}</div>
                    <div className="rep-bar-wrap">
                      <div className="rep-bar gross" style={{ width: `${((r.gross / maxGross) * 100).toFixed(0)}%` }} />
                      <div className="rep-bar weighted" style={{ width: `${((r.wt / maxGross) * 100).toFixed(0)}%` }} />
                    </div>
                    <div className="rep-bar-val">{fmtRM(r.gross)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="deals-table-wrap">
            <div className="deals-toolbar">
              <span className="deals-toolbar-title">Active Deals</span>
              <input
                className="deals-search"
                placeholder="Search deals..."
                value={dealSearch}
                onChange={(e) => setDealSearch(e.target.value)}
              />
            </div>
            <table className="deals-table">
              <thead>
                <tr>
                  <th>Rep</th><th>Account</th><th>Stage</th><th>Days in Stage</th>
                  <th>Deal Value</th><th>Close Date</th><th>Movement</th><th>Status</th><th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {tableDeals.length ? (
                  tableDeals.map((d, i) => {
                    const s = stageOf(d);
                    const isStalled = s && d.daysInStage > s.sla;
                    return (
                      <tr className={isStalled ? 'stalled' : ''} key={`${d.account}-${i}`}>
                        <td>{d.rep}</td>
                        <td style={{ fontWeight: 500 }}>{d.account}</td>
                        <td>
                          <span className={`stage-badge ${stageClass(d.stage)}`}>{s?.name}</span>
                        </td>
                        <td
                          style={{
                            fontFamily: 'var(--mono)',
                            ...(isStalled ? { color: 'var(--red-700)', fontWeight: 500 } : {}),
                          }}
                        >
                          {d.daysInStage}d {isStalled ? '⚠️' : ''}
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>{fmtRM(d.value)}</td>
                        <td
                          style={
                            d.daysToClose <= 14
                              ? { color: 'var(--red-700)', fontWeight: 500 }
                              : d.daysToClose <= 30
                                ? { color: 'var(--amber-600)' }
                                : undefined
                          }
                        >
                          {new Date(Date.now() + d.daysToClose * 86400000).toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short',
                          })}
                        </td>
                        <td className={MOVEMENT_CLASS[d.movement] || ''}>
                          {MOVEMENT_ICON[d.movement] || ''} {d.movement}
                        </td>
                        <td>
                          <span className={`comply-badge ${statusClass(d.status)}`}>{d.status}</span>
                        </td>
                        <td style={{ color: 'var(--gray-500)', maxWidth: 140, fontSize: 12 }}>{d.notes || '—'}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: 24, color: 'var(--gray-400)' }}>
                      No deals found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div>
          <div className="kpi-row">
            {[
              {
                label: 'Overall Win Rate',
                value: overallRate === null ? 'Not available' : `${overallRate}%`,
                sub: overallRate === null
                  ? `Needs at least ${MIN_CLOSED_DEALS_FOR_RATE} closed deals`
                  : `${won.length}W / ${lost.length}L`,
                cls: overallRate === null ? 'is-unavailable' : 'kpi-up',
              },
              { label: 'Total Won Value', value: fmtRM(wonValue), sub: 'Closed-won', cls: 'kpi-up' },
              { label: 'Total Lost Value', value: fmtRM(lostValue), sub: 'Closed-lost', cls: 'kpi-danger' },
              {
                label: 'Avg Won Deal Size',
                value: won.length ? fmtRM(Math.round(wonValue / won.length)) : 'Not available',
                sub: won.length ? 'Mean closed-won' : 'Needs at least one won deal',
                cls: won.length ? '' : 'is-unavailable',
              },
            ].map((k) => (
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
                <span className="card-title">Win Rate by Salesperson</span>
              </div>
              <div className="an-card-sub" style={{ margin: '-10px 0 10px' }}>
                Rates appear after at least {MIN_CLOSED_DEALS_FOR_RATE} closed deals per salesperson.
              </div>
              {repRates.length ? (
                repRates.map((r) => (
                  <div className="hbar-row" key={r.rep}>
                    <div className="hbar-name" title={r.rep}>{r.rep.split(' ')[0]}</div>
                    <div className="hbar-track">
                      <div className="hbar-fill" style={{ width: `${r.rate || 0}%` }} />
                    </div>
                    <div className={`hbar-val${r.rate === null ? ' is-unavailable' : ''}`}>
                      {r.rate === null ? `${r.w + r.l}/${MIN_CLOSED_DEALS_FOR_RATE} deals` : `${r.rate}% · ${r.w}W/${r.l}L`}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-hint">Needs at least {MIN_CLOSED_DEALS_FOR_RATE} closed deals to compare salespeople.</div>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Quarterly Trend</span>
              </div>
              {qKeys.length ? (
                <>
                  <div className="an-card-sub" style={{ margin: '-10px 0 10px' }}>
                    Rates appear with at least {MIN_CLOSED_DEALS_FOR_RATE} closed deals per quarter.
                  </div>
                  <div className="qtrend">
                    {qKeys.map((k) => {
                      const { won: w, lost: l } = quarters[k];
                      const t = w + l;
                      const rate = closedDealRate(w, t);
                      const h = (t / maxTotal) * 150;
                      return (
                        <div className="qtrend-col" key={k} title={`${w} won, ${l} lost`}>
                          <div className="qtrend-pct">{rate === null ? '—' : `${rate}%`}</div>
                          <div className="qtrend-stack" style={{ height: h }}>
                            <div className="qtrend-won" style={{ height: t ? (w / t) * h : 0 }} />
                            <div className="qtrend-lost" style={{ height: t ? (l / t) * h : 0 }} />
                          </div>
                          <div className="qtrend-lbl">{k}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--gray-500)', marginTop: 12 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: 'linear-gradient(180deg,var(--teal),var(--brand-600))' }} />
                      Won
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--gray-200)' }} />
                      Lost
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--gold)' }} />
                      Win rate %
                    </span>
                  </div>
                </>
              ) : (
                <div className="empty-hint">Needs at least {MIN_CLOSED_DEALS_FOR_RATE} closed deals to show a trend.</div>
              )}
            </div>
          </div>

          <div className="analytics-grid">
            <div className="card">
              <div className="card-header">
                <span className="card-title">Win Rate by Deal Size</span>
              </div>
              <div className="tier-grid">
                {tiers.map((t) => {
                  const g = visibleClosed.filter((d) => t.test(d.value));
                  const w = g.filter((d) => d.outcome === 'Won').length;
                  const rate = closedDealRate(w, g.length);
                  return (
                    <div className={`tier-card ${t.cls}`} key={t.name}>
                      <div className="t-name">{t.name}</div>
                      <div className={`t-rate${rate === null ? ' is-unavailable' : ''}`}>
                        {rate === null ? '—' : `${rate}%`}
                      </div>
                      <div className="t-sub">
                        {rate === null
                          ? `Needs ${MIN_CLOSED_DEALS_FOR_RATE} closed deals · ${g.length} recorded`
                          : `${w}W / ${g.length - w}L`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <span className="card-title">Win Rate by Lead Source</span>
              </div>
              <div className="an-card-sub" style={{ margin: '-10px 0 10px' }}>
                Rates appear after at least {MIN_CLOSED_DEALS_FOR_RATE} closed deals per source.
              </div>
              {sourceRates.length ? (
                sourceRates.map((s) => (
                  <div className="hbar-row" key={s.source}>
                    <div className="hbar-name">{s.source}</div>
                    <div className="hbar-track">
                      <div className="hbar-fill" style={{ width: `${s.rate || 0}%` }} />
                    </div>
                    <div className={`hbar-val${s.rate === null ? ' is-unavailable' : ''}`}>
                      {s.rate === null ? `${s.w + s.l}/${MIN_CLOSED_DEALS_FOR_RATE} deals` : `${s.rate}% · ${s.w}W/${s.l}L`}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-hint">Needs at least {MIN_CLOSED_DEALS_FOR_RATE} closed deals to compare lead sources.</div>
              )}
            </div>
          </div>

          <div className="deals-table-wrap">
            <div className="deals-toolbar">
              <span className="deals-toolbar-title">Closed Deals History</span>
              <input
                className="deals-search"
                placeholder="Search closed deals..."
                value={wrSearch}
                onChange={(e) => setWrSearch(e.target.value)}
              />
            </div>
            <table className="deals-table">
              <thead>
                <tr>
                  <th>Rep</th><th>Account</th><th>Value (RM)</th><th>Close Date</th>
                  <th>Source</th><th>Outcome</th><th>Loss Reason</th>
                </tr>
              </thead>
              <tbody>
                {closedHistory.length ? (
                  closedHistory.map((d, i) => (
                    <tr key={`${d.account}-${i}`}>
                      <td>{d.rep}</td>
                      <td style={{ fontWeight: 500 }}>{d.account}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>{fmtRM(d.value)}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{d.closeDate}</td>
                      <td>{d.source}</td>
                      <td className={d.outcome === 'Won' ? 'outcome-won' : 'outcome-lost'}>{d.outcome}</td>
                      <td style={{ color: 'var(--gray-500)', fontSize: 12 }}>{d.lossReason || '—'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--gray-400)' }}>
                      No closed deals found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AddDealModal
        open={addOpen}
        draft={form}
        reps={reps}
        repLocked={level === 1}
        showOutcomeFields
        onDraftChange={setForm}
        onClose={() => setAddOpen(false)}
        onClear={() => setForm(emptyDealDraft(me || currentUser()))}
        onSubmit={addDeal}
      />
    </>
  );
}

export default function Page() {
  return (
    <RequireLevel min={1}>
      <PipelinePage />
    </RequireLevel>
  );
}
