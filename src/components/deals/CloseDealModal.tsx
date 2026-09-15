'use client';

import { useEffect, useId, useState } from 'react';
import Modal from '@/components/Modal';
import { fmtRM, type ClosedDealOutcome, type Deal } from '@/lib/data';
import {
  DEAL_LOSS_REASONS,
  DISQUALIFICATION_REASONS,
  localDateKey,
} from '@/lib/deal-outcomes';
import { DEAL_SOURCES } from './AddDealModal';

export type CloseDealDraft = {
  outcome: ClosedDealOutcome;
  reason: string;
  source: string;
  closeDate: string;
};

function initialDraft(): CloseDealDraft {
  return {
    outcome: 'Won',
    reason: '',
    source: DEAL_SOURCES[0],
    closeDate: localDateKey(),
  };
}

export default function CloseDealModal({
  open,
  deal,
  level,
  onClose,
  onSubmit,
}: {
  open: boolean;
  deal: Deal | null;
  level: number;
  onClose: () => void;
  onSubmit: (draft: CloseDealDraft) => Promise<string | null>;
}) {
  const id = useId();
  const [draft, setDraft] = useState<CloseDealDraft>(initialDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setDraft(initialDraft());
    setError('');
  }, [open, deal?.id]);

  if (!deal) return null;

  const set = (key: keyof CloseDealDraft) => (event: { target: { value: string } }) => {
    const value = event.target.value;
    setError('');
    setDraft((current) => {
      if (key !== 'outcome') return { ...current, [key]: value };
      const outcome = value as ClosedDealOutcome;
      return {
        ...current,
        outcome,
        reason: outcome === 'Lost'
          ? DEAL_LOSS_REASONS[0]
          : outcome === 'Disqualified'
            ? DISQUALIFICATION_REASONS[0]
            : '',
      };
    });
  };

  function close() {
    if (saving) return;
    setError('');
    onClose();
  }

  async function submit() {
    if (!draft.closeDate) {
      setError('Choose the close date before continuing.');
      return;
    }
    if (draft.outcome === 'Lost' && !draft.reason) {
      setError('Choose a loss reason before continuing.');
      return;
    }
    if (draft.outcome === 'Disqualified' && !draft.reason) {
      setError('Choose a disqualification reason before continuing.');
      return;
    }

    setSaving(true);
    setError('');
    const message = await onSubmit(draft);
    setSaving(false);
    if (message) setError(message);
  }

  const isApprovalRequest = level === 1 && draft.outcome === 'Disqualified';

  return (
    <Modal
      open={open}
      onClose={close}
      title="Close deal"
      sub="Choose the outcome once. The open record and closed history are updated together."
      style={{ width: 480 }}
      actions={
        <>
          <button type="button" className="btn-secondary" disabled={saving} onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
            {saving ? 'Saving…' : isApprovalRequest ? 'Request disqualification' : 'Close deal'}
          </button>
        </>
      }
    >
      <div className="deal-close-summary" aria-label="Deal being closed">
        <div>
          <span>Account</span>
          <strong>{deal.account}</strong>
        </div>
        <div>
          <span>Owner</span>
          <strong>{deal.rep}</strong>
        </div>
        <div>
          <span>Value</span>
          <strong>{fmtRM(deal.value)}</strong>
        </div>
        {deal.caseId && (
          <div>
            <span>Proposal case</span>
            <strong>{deal.caseId}</strong>
          </div>
        )}
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor={`${id}-outcome`}>Outcome *</label>
        <select id={`${id}-outcome`} className="form-select" value={draft.outcome} onChange={set('outcome')} disabled={saving}>
          <option value="Won">Won</option>
          <option value="Lost">Lost</option>
          <option value="Disqualified">Disqualified</option>
        </select>
      </div>

      {draft.outcome === 'Lost' && (
        <div className="form-group">
          <label className="form-label" htmlFor={`${id}-reason`}>Loss Reason *</label>
          <select id={`${id}-reason`} className="form-select" value={draft.reason} onChange={set('reason')} disabled={saving}>
            {DEAL_LOSS_REASONS.map((reason) => <option key={reason}>{reason}</option>)}
          </select>
        </div>
      )}

      {draft.outcome === 'Disqualified' && (
        <div className="form-group">
          <label className="form-label" htmlFor={`${id}-reason`}>Disqualification Reason *</label>
          <select id={`${id}-reason`} className="form-select" value={draft.reason} onChange={set('reason')} disabled={saving}>
            {DISQUALIFICATION_REASONS.map((reason) => <option key={reason}>{reason}</option>)}
          </select>
        </div>
      )}

      <div className="form-row-2col">
        <div className="form-group">
          <label className="form-label" htmlFor={`${id}-source`}>Lead Source *</label>
          <select id={`${id}-source`} className="form-select" value={draft.source} onChange={set('source')} disabled={saving}>
            {DEAL_SOURCES.map((source) => <option key={source}>{source}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor={`${id}-date`}>Close Date *</label>
          <input id={`${id}-date`} className="form-input" type="date" value={draft.closeDate} onChange={set('closeDate')} disabled={saving} />
        </div>
      </div>

      {isApprovalRequest && (
        <div className="deal-approval-note">
          This will stay Open until a Level 2 reviewer approves the disqualification. Its pipeline value remains counted while pending.
        </div>
      )}

      {error && <div id={`${id}-error`} className="form-error" role="alert">{error}</div>}
    </Modal>
  );
}
