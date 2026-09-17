'use client';

import { useId, useState } from 'react';
import Modal from '@/components/Modal';
import { STAGES, type DealOutcome } from '@/lib/data';
import {
  DEAL_LOSS_REASONS,
  DISQUALIFICATION_REASONS,
  addCalendarDays,
  localDateKey,
} from '@/lib/deal-outcomes';

export const DEAL_SOURCES = ['Inbound', 'Outbound', 'Partner'] as const;
export { DEAL_LOSS_REASONS, DISQUALIFICATION_REASONS };

export type DealDraft = {
  rep: string;
  account: string;
  opportunityId: string;
  stage: string;
  value: string;
  days: string;
  source: string;
  close: string;
  outcome: DealOutcome;
  loss: string;
  disqualificationReason: string;
  notes: string;
};

export function emptyDealDraft(rep: string, account = ''): DealDraft {
  return {
    rep,
    account,
    opportunityId: '',
    stage: '1',
    value: '',
    days: '',
    source: DEAL_SOURCES[0],
    close: addCalendarDays(localDateKey(), 90),
    outcome: 'Open',
    loss: DEAL_LOSS_REASONS[0],
    disqualificationReason: DISQUALIFICATION_REASONS[0],
    notes: '',
  };
}

export default function AddDealModal({
  open,
  draft,
  reps,
  repLocked = false,
  opportunityLocked = false,
  showOutcomeFields = false,
  title = 'Add New Deal',
  subtitle = 'Add an active or historical deal. Closing this window keeps your draft.',
  submitLabel = 'Add Deal',
  onDraftChange,
  onClose,
  onClear,
  onSubmit,
}: {
  open: boolean;
  draft: DealDraft;
  reps: string[];
  repLocked?: boolean;
  opportunityLocked?: boolean;
  showOutcomeFields?: boolean;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  onDraftChange: (draft: DealDraft) => void;
  onClose: () => void;
  onClear: () => void;
  onSubmit: (draft: DealDraft) => Promise<boolean | string>;
}) {
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const repOptions = draft.rep && !reps.includes(draft.rep)
    ? [draft.rep, ...reps]
    : reps;
  const modalSubtitle = showOutcomeFields && draft.outcome !== 'Open'
    ? 'Record a closed deal. Stage and Days in Stage do not apply. Closing this window keeps your draft.'
    : subtitle;

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
    if (!draft.rep.trim()) {
      setError('Choose a salesperson before saving the deal.');
      return;
    }
    if (!draft.close) {
      setError(`Choose the ${draft.outcome === 'Open' ? 'target close date' : 'close date'} before saving.`);
      return;
    }
    if (draft.outcome !== 'Open' && draft.close > localDateKey()) {
      setError('Close date cannot be in the future when recording a closed deal.');
      return;
    }
    if (!draft.value.trim()) {
      setError('Enter a deal value before saving.');
      return;
    }
    const value = Number(draft.value);
    if (!Number.isFinite(value) || value < 0) {
      setError('Enter a valid deal value of zero or more.');
      return;
    }
    const daysInStage = Number(draft.days);
    if (draft.outcome === 'Open' && (
      !STAGES.some((stage) => String(stage.id) === draft.stage) ||
      !draft.days.trim() ||
      !Number.isFinite(daysInStage) ||
      daysInStage < 0
    )) {
      setError('Choose a stage and enter zero or more days in stage.');
      return;
    }
    if (draft.outcome !== 'Open' &&
        !DEAL_SOURCES.includes(draft.source as (typeof DEAL_SOURCES)[number])) {
      setError('Choose a lead source from the fixed list.');
      return;
    }
    if (draft.outcome === 'Lost' && !DEAL_LOSS_REASONS.includes(draft.loss as (typeof DEAL_LOSS_REASONS)[number])) {
      setError('Choose a loss reason from the fixed list.');
      return;
    }
    if (draft.outcome === 'Disqualified' &&
        !DISQUALIFICATION_REASONS.includes(draft.disqualificationReason as (typeof DISQUALIFICATION_REASONS)[number])) {
      setError('Choose a disqualification reason from the fixed list.');
      return;
    }

    setError('');
    setSaving(true);
    try {
      const saved = await onSubmit(draft);
      if (saved !== true) {
        setError(typeof saved === 'string'
          ? saved
          : 'The deal could not be saved. Your draft is still here; try again.');
      }
    } catch (submitError) {
      setError(submitError instanceof Error
        ? submitError.message
        : 'The deal could not be saved. Your draft is still here; try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      sub={modalSubtitle}
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
            {saving ? 'Saving…' : submitLabel}
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
          {!draft.rep && <option value="" disabled>Choose a salesperson</option>}
          {repOptions.map((rep) => (
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
        <label className="form-label" htmlFor={`${id}-opportunity`}>Opportunity ID</label>
        <input
          id={`${id}-opportunity`}
          className="form-input"
          value={draft.opportunityId}
          onChange={set('opportunityId')}
          placeholder="OPP-2026-0101"
          disabled={saving || opportunityLocked}
        />
      </div>

      {showOutcomeFields && (
        <div className="form-group">
          <label className="form-label" htmlFor={`${id}-outcome`}>Outcome *</label>
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
            <option value="Disqualified">Disqualified</option>
          </select>
        </div>
      )}

      {draft.outcome === 'Open' && (
        <>
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
                placeholder="0"
                disabled={saving}
              />
            </div>
          </div>
        </>
      )}

      {draft.outcome !== 'Open' && (
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
            <label className="form-label" htmlFor={`${id}-source`}>Lead Source *</label>
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
        </div>
      )}

      <div className="form-group">
        <label className="form-label" htmlFor={`${id}-close`}>
          {draft.outcome === 'Open' ? 'Target Close Date *' : 'Close Date *'}
        </label>
        <input
          id={`${id}-close`}
          className="form-input"
          type="date"
          value={draft.close}
          onChange={set('close')}
          disabled={saving}
        />
      </div>

      {draft.outcome === 'Lost' && (
        <div className="form-group">
          <label className="form-label" htmlFor={`${id}-loss`}>Loss Reason *</label>
          <select id={`${id}-loss`} className="form-select" value={draft.loss} onChange={set('loss')} disabled={saving}>
            {DEAL_LOSS_REASONS.map((reason) => <option key={reason}>{reason}</option>)}
          </select>
        </div>
      )}

      {draft.outcome === 'Disqualified' && (
        <div className="form-group">
          <label className="form-label" htmlFor={`${id}-disqualification`}>Disqualification Reason *</label>
          <select
            id={`${id}-disqualification`}
            className="form-select"
            value={draft.disqualificationReason}
            onChange={set('disqualificationReason')}
            disabled={saving}
          >
            {DISQUALIFICATION_REASONS.map((reason) => <option key={reason}>{reason}</option>)}
          </select>
        </div>
      )}

      {draft.outcome === 'Open' && (
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
      )}

      {error && (
        <div id={`${id}-error`} className="form-error" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
