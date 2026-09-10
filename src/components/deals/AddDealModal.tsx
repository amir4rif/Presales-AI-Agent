'use client';

import { useId, useState } from 'react';
import Modal from '@/components/Modal';
import { STAGES } from '@/lib/data';

export const DEAL_SOURCES = ['Inbound', 'Outbound', 'Partner'] as const;
export const DEAL_LOSS_REASONS = [
  'Chose competitor',
  'Budget cut',
  'No decision',
  'Pricing too high',
  'Timing',
  'Other',
] as const;

export type DealDraft = {
  rep: string;
  account: string;
  stage: string;
  value: string;
  days: string;
  source: string;
  close: string;
  outcome: 'Open' | 'Won' | 'Lost';
  loss: string;
  notes: string;
};

export function emptyDealDraft(rep: string, account = ''): DealDraft {
  return {
    rep,
    account,
    stage: '1',
    value: '',
    days: '',
    source: DEAL_SOURCES[0],
    close: '',
    outcome: 'Open',
    loss: DEAL_LOSS_REASONS[0],
    notes: '',
  };
}

export default function AddDealModal({
  open,
  draft,
  reps,
  repLocked = false,
  showOutcomeFields = false,
  onDraftChange,
  onClose,
  onClear,
  onSubmit,
}: {
  open: boolean;
  draft: DealDraft;
  reps: string[];
  repLocked?: boolean;
  showOutcomeFields?: boolean;
  onDraftChange: (draft: DealDraft) => void;
  onClose: () => void;
  onClear: () => void;
  onSubmit: (draft: DealDraft) => Promise<boolean>;
}) {
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (key: keyof DealDraft) => (event: { target: { value: string } }) => {
    setError('');
    onDraftChange({ ...draft, [key]: event.target.value });
  };

  function close() {
    setError('');
    onClose();
  }

  function clear() {
    setError('');
    onClear();
  }

  async function submit() {
    if (!draft.account.trim()) {
      setError('Enter an account or client name before adding the deal.');
      return;
    }

    setError('');
    setSaving(true);
    const saved = await onSubmit(draft);
    if (!saved) {
      setError('The deal could not be saved. Your draft is still here; try again.');
    }
    setSaving(false);
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add New Deal"
      sub="Add an active deal to the pipeline. Closing this window keeps your draft."
      actions={
        <>
          <button
            type="button"
            className="btn-secondary modal-clear-action"
            disabled={saving}
            onClick={clear}
          >
            Clear form
          </button>
          <button type="button" className="btn-secondary" disabled={saving} onClick={close}>
            Close
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={submit}>
            {saving ? 'Saving…' : 'Add Deal'}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label" htmlFor={`${id}-rep`}>Salesperson *</label>
        <select
          id={`${id}-rep`}
          className="form-select"
          value={draft.rep}
          onChange={set('rep')}
          disabled={saving || repLocked}
        >
          {reps.map((rep) => (
            <option key={rep}>{rep}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor={`${id}-account`}>Account / Client *</label>
        <input
          id={`${id}-account`}
          className="form-input"
          value={draft.account}
          onChange={set('account')}
          placeholder="Company name"
          disabled={saving}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
      </div>

      <div className="form-group">
        <label className="form-label" htmlFor={`${id}-stage`}>Stage *</label>
        <select
          id={`${id}-stage`}
          className="form-select"
          value={draft.stage}
          onChange={set('stage')}
          disabled={saving}
        >
          {STAGES.map((stage) => (
            <option value={String(stage.id)} key={stage.id}>
              {stage.id} – {stage.name}
            </option>
          ))}
        </select>
      </div>

      <div className="form-row-2col">
        <div className="form-group">
          <label className="form-label" htmlFor={`${id}-value`}>Deal Value (RM) *</label>
          <input
            id={`${id}-value`}
            className="form-input"
            type="number"
            min="0"
            value={draft.value}
            onChange={set('value')}
            placeholder="3000000"
            disabled={saving}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor={`${id}-days`}>Days in Stage *</label>
          <input
            id={`${id}-days`}
            className="form-input"
            type="number"
            min="0"
            value={draft.days}
            onChange={set('days')}
            placeholder="5"
            disabled={saving}
          />
        </div>
      </div>

      {showOutcomeFields && (
        <>
          <div className="form-row-2col">
            <div className="form-group">
              <label className="form-label" htmlFor={`${id}-source`}>Lead Source</label>
              <select
                id={`${id}-source`}
                className="form-select"
                value={draft.source}
                onChange={set('source')}
                disabled={saving}
              >
                {DEAL_SOURCES.map((source) => (
                  <option key={source}>{source}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor={`${id}-close`}>Close Date</label>
              <input
                id={`${id}-close`}
                className="form-input"
                type="date"
                value={draft.close}
                onChange={set('close')}
                disabled={saving}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor={`${id}-outcome`}>Outcome</label>
            <select
              id={`${id}-outcome`}
              className="form-select"
              value={draft.outcome}
              onChange={set('outcome')}
              disabled={saving}
            >
              <option value="Open">Open (still in pipeline)</option>
              <option value="Won">Won</option>
              <option value="Lost">Lost</option>
            </select>
          </div>

          {draft.outcome === 'Lost' && (
            <div className="form-group">
              <label className="form-label" htmlFor={`${id}-loss`}>Loss Reason</label>
              <select
                id={`${id}-loss`}
                className="form-select"
                value={draft.loss}
                onChange={set('loss')}
                disabled={saving}
              >
                {DEAL_LOSS_REASONS.map((reason) => (
                  <option key={reason}>{reason}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      <div className="form-group">
        <label className="form-label" htmlFor={`${id}-notes`}>Notes</label>
        <input
          id={`${id}-notes`}
          className="form-input"
          value={draft.notes}
          onChange={set('notes')}
          placeholder="Optional notes..."
          disabled={saving}
        />
      </div>

      {error && (
        <div id={`${id}-error`} className="form-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
