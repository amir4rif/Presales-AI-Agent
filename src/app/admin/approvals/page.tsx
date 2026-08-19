'use client';
/* Proposal Approvals (Doc §4.3 / §4.9), including a confirm step before
   any decision is committed and post-approval outcome tracking.

   Three deliberate differences from admin-approvals.html — each one is
   needed for this page to work against the shared store, which is the
   gap the doc asked us to close:

   1. Status stays 'Pending Review'. v10 renamed it to 'Pending Approval'
      in this file only; app-data.js, proposals, the dashboards and
      analytics all still write 'Pending Review', so v10's queue never
      sees a proposal a rep actually submitted.
   2. Case/Opportunity IDs are generated only when missing, never
      regenerated. v10 mints new ones on every approval, which would
      detach v2 of a case from v1 and break both Version History and the
      per-case Stage-1 approval rate.
   3. The reviewer is still captured on the decision (Doc §4.9). v10
      dropped it, but the proposals page displays it.

   Reject & Close remains limited to genuinely unfixable reasons. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import RequireLevel from '@/components/RequireLevel';
import { useToast } from '@/components/Toast';
import {
  currentUser,
  ensureProposalStore,
  fmtRM,
  saveProposals,
  type DealOutcome,
  type Proposal,
  type ProposalStatus,
} from '@/lib/data';
import { notify } from '@/lib/notify';

const SECTION_LABELS: Record<string, string> = {
  executive: 'Executive Summary',
  challenges: 'Challenges',
  solution: 'Our Solution',
  benefits: 'Benefits',
  implementation: 'Implementation',
  commercials: 'Commercials',
  casestudies: 'Case Studies',
  nextsteps: 'Next Steps',
};
const SECTION_ORDER = Object.keys(SECTION_LABELS);

const REJECTION_REASONS = [
  'Pricing too high',
  'Scope mismatch',
  'Wrong product fit',
  'Missing information',
  'Compliance issue',
  'Formatting/quality',
  'Out of scope',
  'Other',
];
const CLOSE_REASONS = new Set([
  'Compliance issue',
  'Out of scope',
  'Wrong product fit',
]);

const isRejected = (status: string) =>
  status === 'Reject & Revise' || status === 'Reject & Close';

function pillClass(status: string) {
  if (status === 'Approved') return 'pill-approved';
  if (status === 'Reject & Revise') return 'pill-revise';
  if (status === 'Reject & Close') return 'pill-closed';
  if (status === 'Draft') return 'pill-draft';
  if (status === 'Superseded') return 'pill-superseded';
  return 'pill-pending';
}

function outcomePillClass(outcome: string) {
  if (outcome === 'Won') return 'pill-won';
  if (outcome === 'Lost') return 'pill-lost';
  return 'pill-outcome-pending';
}

const todayStr = () =>
  new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const rnd3 = () => String(Math.floor(Math.random() * 900) + 100);
const generateCaseId = () => `CASE-${new Date().getFullYear()}-${rnd3()}`;
const generateOppId = () => `OPP-${new Date().getFullYear()}-${rnd3()}`;

function ApprovalsPage() {
  const toast = useToast();
  const [store, setStore] = useState<Proposal[]>([]);
  const [tab, setTab] = useState('Pending Review');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [pendingDecision, setPendingDecision] = useState<ProposalStatus | null>(null);
  const [outcomeSaved, setOutcomeSaved] = useState(false);

  const reload = useCallback(() => setStore(ensureProposalStore()), []);
  useEffect(() => {
    reload();
  }, [reload]);

  /* Superseded versions are audit-only, and Drafts have not been submitted
     yet. The approvals list shows the current submitted version of each case
     (Doc §3.8: "1 row = 1 case"). */
  const list = useMemo(
    () => store.filter((p) => p.status !== 'Superseded' && p.status !== 'Draft'),
    [store]
  );

  const pending = list.filter((p) => p.status === 'Pending Review');
  const approved = list.filter((p) => p.status === 'Approved');
  const revise = list.filter((p) => p.status === 'Reject & Revise');
  const closed = list.filter((p) => p.status === 'Reject & Close');
  const pendingValue = pending.reduce((s, p) => s + (p.value || 0), 0);

  /* v10: outcome stats for approved proposals. */
  const won = approved.filter((p) => p.outcome === 'Won').length;
  const lost = approved.filter((p) => p.outcome === 'Lost').length;
  const outcomeSub = approved.length
    ? `${won} Won · ${lost} Lost · ${approved.length - won - lost} Pending`
    : 'All time';

  const kpis = [
    { label: 'Pending Review', value: pending.length, sub: 'Awaiting your review', color: pending.length ? 'kpi-warn' : '' },
    { label: 'Value Pending', value: fmtRM(pendingValue), sub: 'Across pending proposals', color: '' },
    { label: 'Approved', value: approved.length, sub: outcomeSub, color: 'kpi-up' },
    { label: 'Reject & Revise', value: revise.length, sub: 'Sent back to sales', color: revise.length ? 'kpi-warn' : '' },
  ];

  const sortedRejectionReasons = useMemo(() => {
    const counts = new Map<string, number>();
    store.forEach((proposal) => {
      if (proposal.rejectionReason) {
        counts.set(proposal.rejectionReason, (counts.get(proposal.rejectionReason) || 0) + 1);
      }
    });
    return REJECTION_REASONS
      .map((value, index) => ({ value, index, count: counts.get(value) || 0 }))
      .sort((a, b) => b.count - a.count || a.index - b.index)
      .map((item) => item.value);
  }, [store]);

  const tabs = [
    { key: 'Pending Review', label: 'Pending', count: pending.length },
    { key: 'Approved', label: 'Approved', count: approved.length },
    { key: 'Reject & Revise', label: 'Reject & Revise', count: revise.length },
    { key: 'Reject & Close', label: 'Reject & Close', count: closed.length },
    { key: 'All', label: 'All', count: list.length },
  ];

  const shown = tab === 'All' ? list : list.filter((p) => p.status === tab);
  const reviewing = reviewingId ? store.find((p) => p.id === reviewingId) || null : null;

  function openReview(id: string) {
    setReviewingId(id);
    setReason('');
    setNote('');
    setReasonError('');
    setPendingDecision(null);
    setOutcomeSaved(false);
  }

  function closeReview() {
    setReviewingId(null);
    setPendingDecision(null);
  }

  function applyDecision(id: string, decision: ProposalStatus, why: string, reviewNote: string) {
    const who = currentUser(); // reviewer captured automatically (Doc §4.9)
    const today = todayStr();
    const next = store.map((p) => {
      if (p.id !== id) return p;
      const updated: Proposal = {
        ...p,
        status: decision,
        reviewNote,
        rejectionReason: isRejected(decision) ? why : '',
        reviewer: who,
        reviewedDate: today, // decision date
        lastUpdated: today,
      };
      if (decision === 'Approved') {
        // v10: an approved proposal starts outcome tracking. IDs are filled
        // in only when absent — an existing Case ID ties versions together.
        updated.outcome = updated.outcome || 'Pending';
        updated.caseId = updated.caseId || generateCaseId();
        updated.opportunityId = updated.opportunityId || generateOppId();
      }
      return updated;
    });
    saveProposals(next);
    setStore(next);
    return next.find((p) => p.id === id)!;
  }

  /* v10: nothing commits until the reviewer confirms. */
  function requestConfirm(decision: ProposalStatus) {
    if (!reviewing) return;
    if (isRejected(decision) && !reason) {
      setReasonError('Please select a rejection reason.');
      return;
    }
    if (decision === 'Reject & Close' && !CLOSE_REASONS.has(reason)) {
      setReasonError('This reason is fixable. Use Reject & Revise instead.');
      return;
    }
    setReasonError('');
    setPendingDecision(decision);
  }

  function executeConfirmed() {
    if (!pendingDecision || !reviewing) return;
    if (pendingDecision === 'Reject & Close' && !CLOSE_REASONS.has(reason)) {
      setPendingDecision(null);
      setReasonError('This reason is fixable. Use Reject & Revise instead.');
      return;
    }
    const decision = pendingDecision;
    const p = applyDecision(reviewing.id, decision, reason, note.trim());

    const icon = decision === 'Approved' ? '✅' : decision === 'Reject & Revise' ? '↩' : '✕';
    const label =
      decision === 'Approved'
        ? 'approved'
        : decision === 'Reject & Revise'
          ? 'sent back for revision'
          : 'closed';
    toast(`${icon} ${p.deal} ${label}`, decision !== 'Approved');

    if (decision === 'Approved') {
      notify('approve', 'Proposal approved', `${p.company} — ready for client pitch`);
    } else {
      notify(
        'reject',
        `Proposal ${decision === 'Reject & Revise' ? 'sent back for revision' : 'rejected & closed'}`,
        `${p.company} — Reason: ${p.rejectionReason || '—'}`
      );
    }
    closeReview();
  }

  function quickApprove(id: string) {
    const target = store.find((p) => p.id === id);
    if (!target) return;
    if (!confirm(`Approve "${target.deal}"?`)) return;
    const p = applyDecision(id, 'Approved', '', target.reviewNote);
    toast(`✅ ${p.deal} approved`);
    notify('approve', 'Proposal approved', `${p.company} — ready for client pitch`);
  }

  /* v10 — FEATURE 3: outcome tracking on an approved proposal. */
  function saveOutcome(outcome: DealOutcome) {
    if (!reviewing) return;
    const next = store.map((p) => (p.id === reviewing.id ? { ...p, outcome } : p));
    saveProposals(next);
    setStore(next);
    setOutcomeSaved(true);
    setTimeout(() => setOutcomeSaved(false), 1500);
  }

  const pastNote = (() => {
    if (!reviewing || reviewing.status === 'Pending Review') return null;
    if (!reviewing.reviewNote && !reviewing.rejectionReason) return null;
    let text = '';
    if (reviewing.reviewer) text += `Reviewer: ${reviewing.reviewer}\n`;
    if (reviewing.rejectionReason) text += `Reason: ${reviewing.rejectionReason}\n`;
    if (reviewing.reviewNote) text += reviewing.reviewNote;
    if (reviewing.reviewedDate) text += ` (${reviewing.reviewedDate})`;
    return text;
  })();

  const isPending = reviewing?.status === 'Pending Review';

  /* Confirm-strip copy, per decision. */
  const confirmCopy = (() => {
    if (!pendingDecision || !reviewing) return null;
    if (pendingDecision === 'Approved') {
      return { msg: `Approve "${reviewing.deal}"?`, warn: null, cta: '✓ Confirm Approval', bg: '' };
    }
    if (pendingDecision === 'Reject & Revise') {
      return {
        msg: `Send "${reviewing.deal}" back to sales for revision?`,
        warn: null,
        cta: '↩ Confirm Reject & Revise',
        bg: '#FB923C',
      };
    }
    return {
      msg: `Reject and close this case for reason: ${reason}?`,
      warn: 'This will end the case permanently and count as a loss. It cannot be undone.',
      cta: '✕ Confirm Reject & Close',
      bg: 'var(--red-700)',
    };
  })();

  return (
    <>
      <div className="page-header">
        <div className="page-title">Proposal Approvals</div>
        <div className="page-sub">
          Completed proposals from the sales team land here for admin sign-off.
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

      <div className="appr-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`appr-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label} <span className="cnt">{t.count}</span>
          </button>
        ))}
      </div>

      <div className="appr-table-wrap">
        <table className="appr-table">
          <thead>
            <tr>
              <th>Proposal</th>
              <th>Submitted By</th>
              <th>Date Submitted</th>
              <th>Value (RM)</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">Nothing here right now.</div>
                </td>
              </tr>
            ) : (
              shown.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="appr-deal">{p.deal}</div>
                    <div className="appr-company">
                      {p.company}
                      {p.version > 1 ? ` · v${p.version}` : ''}
                      {p.caseId ? ` · ${p.caseId}` : ''}
                    </div>
                  </td>
                  <td>{p.submittedBy}</td>
                  <td className="td-mono">{p.submittedDate}</td>
                  <td className="td-value">{fmtRM(p.value)}</td>
                  <td>
                    <span className={`status-pill ${pillClass(p.status)}`}>{p.status}</span>
                    {/* v10: outcome pill on approved rows, reason on rejected ones */}
                    {p.status === 'Approved' && p.outcome ? (
                      <div style={{ marginTop: 3 }}>
                        <span
                          className={`status-pill ${outcomePillClass(p.outcome)}`}
                          style={{ fontSize: 10, padding: '1px 7px' }}
                        >
                          {p.outcome}
                        </span>
                      </div>
                    ) : (
                      p.rejectionReason &&
                      isRejected(p.status) && (
                        <div className="appr-reason">Reason: {p.rejectionReason}</div>
                      )
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="row-btn" onClick={() => openReview(p.id)}>
                        Review
                      </button>
                      {p.status === 'Pending Review' && (
                        <button className="row-btn approve" onClick={() => quickApprove(p.id)}>
                          Approve
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* REVIEW MODAL */}
      <Modal
        open={!!reviewing}
        onClose={closeReview}
        style={{ maxWidth: 640, maxHeight: '86vh', overflowY: 'auto' }}
        title={
          reviewing ? reviewing.deal + (reviewing.version > 1 ? ` (v${reviewing.version})` : '') : ''
        }
        sub={
          reviewing ? (
            <>
              Version {reviewing.version || 1} · Case <strong>{reviewing.caseId || '—'}</strong> ·
              Opportunity {reviewing.opportunityId || '—'}
            </>
          ) : null
        }
        actions={
          /* v10: the action row is replaced by the confirm strip mid-decision. */
          isPending && !pendingDecision ? (
            <>
              <button className="btn-secondary" onClick={closeReview}>
                Close
              </button>
              <div className="reject-actions">
                <button
                  className="row-btn revise-btn lg"
                  title="Fixable — goes back to sales rep for revision"
                  onClick={() => requestConfirm('Reject & Revise')}
                >
                  ↩ Reject &amp; Revise
                </button>
                <button
                  className="row-btn reject lg"
                  disabled={!CLOSE_REASONS.has(reason)}
                  title={CLOSE_REASONS.has(reason)
                    ? 'Unfixable — case ends, counted as loss'
                    : 'Available only for compliance, out-of-scope, or wrong-product-fit reasons'}
                  onClick={() => requestConfirm('Reject & Close')}
                >
                  ✕ Reject &amp; Close
                </button>
              </div>
              <button className="btn-primary" onClick={() => requestConfirm('Approved')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Approve
              </button>
            </>
          ) : !isPending ? (
            <button className="btn-secondary" onClick={closeReview}>
              Close
            </button>
          ) : null
        }
      >
        {reviewing && (
          <>
            <div className="review-meta-grid">
              <div className="review-meta-item">
                <div className="lbl">Company</div>
                <div className="val">{reviewing.company}</div>
              </div>
              <div className="review-meta-item">
                <div className="lbl">Deal Value</div>
                <div className="val">{fmtRM(reviewing.value)}</div>
              </div>
              <div className="review-meta-item">
                <div className="lbl">Submitted By</div>
                <div className="val">{reviewing.submittedBy}</div>
              </div>
              <div className="review-meta-item">
                <div className="lbl">Date Submitted</div>
                <div className="val">{reviewing.submittedDate || '—'}</div>
              </div>
            </div>

            {SECTION_ORDER.filter((k) => (reviewing.sections as Record<string, string>)[k]).length ? (
              SECTION_ORDER.filter((k) => (reviewing.sections as Record<string, string>)[k]).map((k) => (
                <div className="review-section" key={k}>
                  <div className="rs-title">{SECTION_LABELS[k]}</div>
                  <div className="rs-body">{(reviewing.sections as Record<string, string>)[k]}</div>
                </div>
              ))
            ) : (
              <div className="review-section">
                <div className="rs-body">No proposal content was attached.</div>
              </div>
            )}

            {pastNote && (
              <div className="review-section">
                <div className="rs-title">Review Decision</div>
                <div className="past-note" style={{ whiteSpace: 'pre-wrap' }}>
                  {pastNote}
                </div>
              </div>
            )}

            {/* v10 — FEATURE 3: outcome tracking, approved proposals only */}
            {reviewing.status === 'Approved' && (
              <div className="outcome-section">
                <div className="os-title">Deal Outcome</div>
                <div className="outcome-meta-grid">
                  <div>
                    <div className="lbl">Case ID</div>
                    <div className="val">{reviewing.caseId || '—'}</div>
                  </div>
                  <div>
                    <div className="lbl">Opportunity ID</div>
                    <div className="val">{reviewing.opportunityId || '—'}</div>
                  </div>
                </div>
                <div className="outcome-select-row">
                  <label style={{ fontSize: 11, fontWeight: 500, color: 'var(--gray-700)' }}>
                    Outcome:
                  </label>
                  <select
                    value={reviewing.outcome || 'Pending'}
                    onChange={(e) => saveOutcome(e.target.value as DealOutcome)}
                  >
                    <option value="Pending">Pending</option>
                    <option value="Won">Won</option>
                    <option value="Lost">Lost</option>
                  </select>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--brand-500)',
                      opacity: outcomeSaved ? 1 : 0,
                      transition: 'opacity .3s',
                    }}
                  >
                    ✓ Saved
                  </span>
                </div>
              </div>
            )}

            {isPending && (
              <>
                <div className="rejection-reason-wrap">
                  <label>
                    Rejection Reason <span className="req">(required on reject)</span>
                  </label>
                  <select
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                      setReasonError('');
                    }}
                  >
                    <option value="">— Select a reason —</option>
                    {sortedRejectionReasons.map((r) => (
                      <option value={r} key={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  {reasonError && (
                    <div className="reason-error" style={{ display: 'block' }}>
                      {reasonError}
                    </div>
                  )}
                  <div className="an-note" style={{ marginTop: 6 }}>
                    Reject &amp; Close is available only for Compliance issue, Out of scope,
                    or Wrong product fit. All other reasons must use Reject &amp; Revise.
                  </div>
                </div>

                <div className="review-note-box">
                  <label className="fl" style={{ marginBottom: 6 }}>
                    Note to sales team (optional)
                  </label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. Pricing looks strong, approved as-is. — or — Please revise commercials before resubmitting."
                  />
                </div>
              </>
            )}

            {/* v10 — FEATURE 2: confirm before finalizing */}
            {confirmCopy && (
              <div className="confirm-strip">
                <div className="cs-msg">{confirmCopy.msg}</div>
                {confirmCopy.warn && <div className="cs-warn">{confirmCopy.warn}</div>}
                <div className="cs-actions">
                  <button className="btn-secondary" onClick={() => setPendingDecision(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn-primary"
                    style={
                      confirmCopy.bg
                        ? { background: confirmCopy.bg, borderColor: confirmCopy.bg }
                        : undefined
                    }
                    onClick={executeConfirmed}
                  >
                    {confirmCopy.cta}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

export default function Page() {
  return (
    <RequireLevel min={2}>
      <ApprovalsPage />
    </RequireLevel>
  );
}
