'use client';
/* Proposal Approvals (Doc §4.3 / §4.9).

   This page used to keep its own copy of the proposal seed and read
   localStorage directly, which is why it could disagree with the
   dashboards. It now goes through lib/data.ts like everything else. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import RequireLevel from '@/components/RequireLevel';
import { useToast } from '@/components/Toast';
import {
  currentUser,
  ensureProposalStore,
  fmtRM,
  saveProposals,
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

/* Reject & Close is limited to the agreed unfixable reasons (Doc §4.3 guardrail). */
const CLOSE_ALLOWED_REASONS = ['Compliance issue', 'Out of scope', 'Wrong product fit'];

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

const todayStr = () =>
  new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function ApprovalsPage() {
  const toast = useToast();
  const [store, setStore] = useState<Proposal[]>([]);
  const [tab, setTab] = useState('Pending Review');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const [closeError, setCloseError] = useState(false);

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

  const kpis = [
    { label: 'Pending Review', value: pending.length, sub: 'Awaiting your review', color: pending.length ? 'kpi-warn' : '' },
    { label: 'Value Pending', value: fmtRM(pendingValue), sub: 'Across pending proposals', color: '' },
    { label: 'Approved', value: approved.length, sub: 'All time', color: 'kpi-up' },
    { label: 'Reject & Revise', value: revise.length, sub: 'Sent back to sales', color: revise.length ? 'kpi-warn' : '' },
    { label: 'Reject & Close', value: closed.length, sub: 'Case ended as loss', color: closed.length ? 'kpi-danger' : '' },
  ];

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
    setReasonError(false);
    setCloseError(false);
  }

  function applyDecision(id: string, decision: ProposalStatus, why: string, reviewNote: string) {
    const who = currentUser(); // reviewer captured automatically (Doc §4.9)
    const today = todayStr();
    const next = store.map((p) =>
      p.id === id
        ? {
            ...p,
            status: decision,
            reviewNote,
            rejectionReason: isRejected(decision) ? why : '',
            reviewer: who,
            reviewedDate: today, // decision date
            lastUpdated: today,
          }
        : p
    );
    saveProposals(next);
    setStore(next);
    return next.find((p) => p.id === id)!;
  }

  function actOnProposal(decision: ProposalStatus) {
    if (!reviewing) return;
    setReasonError(false);
    setCloseError(false);

    // Rejections require a reason
    if (isRejected(decision) && !reason) {
      setReasonError(true);
      return;
    }
    // Guardrail: Reject & Close only for the agreed unfixable reasons (Doc §4.3)
    if (decision === 'Reject & Close' && !CLOSE_ALLOWED_REASONS.includes(reason)) {
      setCloseError(true);
      return;
    }

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
    setReviewingId(null);
  }

  function quickApprove(id: string) {
    const target = store.find((p) => p.id === id);
    if (!target) return;
    if (!confirm(`Approve "${target.deal}"?`)) return;
    const p = applyDecision(id, 'Approved', '', target.reviewNote);
    toast(`✅ ${p.deal} approved`);
    notify('approve', 'Proposal approved', `${p.company} — ready for client pitch`);
  }

  /* If this is a resubmit (v2+), surface the PREVIOUS version's rejection
     reason so the reviewer sees what was asked for last time (Doc §4.9). */
  const prevRejection = (() => {
    if (!reviewing || (reviewing.version || 1) <= 1) return null;
    const prev = store
      .filter((x) => x.caseId && x.caseId === reviewing.caseId && x.version < (reviewing.version || 1))
      .sort((a, b) => b.version - a.version)[0];
    if (!prev?.rejectionReason) return null;
    return `v${prev.version}: ${prev.rejectionReason}${prev.reviewNote ? ` — ${prev.reviewNote}` : ''}`;
  })();

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
                    </div>
                  </td>
                  <td>{p.submittedBy}</td>
                  <td className="td-mono">{p.submittedDate}</td>
                  <td className="td-value">{fmtRM(p.value)}</td>
                  <td>
                    <span className={`status-pill ${pillClass(p.status)}`}>{p.status}</span>
                    {p.rejectionReason && isRejected(p.status) && (
                      <div className="appr-reason">Reason: {p.rejectionReason}</div>
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
        onClose={() => setReviewingId(null)}
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
          isPending ? (
            <>
              <button className="btn-secondary" onClick={() => setReviewingId(null)}>
                Close
              </button>
              <div className="reject-actions">
                <button
                  className="row-btn revise-btn lg"
                  title="Fixable — goes back to sales rep for revision"
                  onClick={() => actOnProposal('Reject & Revise')}
                >
                  ↩ Reject &amp; Revise
                </button>
                <button
                  className="row-btn reject lg"
                  title="Unfixable — case ends, counted as loss"
                  onClick={() => actOnProposal('Reject & Close')}
                >
                  ✕ Reject &amp; Close
                </button>
              </div>
              <button className="btn-primary" onClick={() => actOnProposal('Approved')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Approve
              </button>
            </>
          ) : (
            <button className="btn-secondary" onClick={() => setReviewingId(null)}>
              Close
            </button>
          )
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

            {prevRejection && (
              <div className="review-section">
                <div className="rs-title">Previous Rejection (this case)</div>
                <div className="past-note">{prevRejection}</div>
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

            {isPending && (
              <>
                <div className="rejection-reason-wrap">
                  <label>
                    Rejection Reason <span className="req">(required on reject)</span>
                  </label>
                  <select value={reason} onChange={(e) => setReason(e.target.value)}>
                    <option value="">— Select a reason —</option>
                    {REJECTION_REASONS.map((r) => (
                      <option value={r} key={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  {reasonError && (
                    <div className="reason-error" style={{ display: 'block' }}>
                      Please select a rejection reason.
                    </div>
                  )}
                  {closeError && (
                    <div className="reason-error" style={{ display: 'block' }}>
                      Reject &amp; Close is limited to Compliance issue, Out of scope, or Wrong
                      product fit. Use Reject &amp; Revise for fixable issues.
                    </div>
                  )}
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
