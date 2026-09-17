'use client';

import { useEffect, useId, useState } from 'react';
import Modal from '@/components/Modal';
import { type DealOutcome, type Stage } from '@/lib/data';
import { localDateKey } from '@/lib/deal-outcomes';
import {
  dealValueNumber,
  formatDealValueInput,
  normalizeDealValueInput,
} from '@/lib/deal-inputs';

export type DealFormOptions = {
  stages: Stage[];
  sources: string[];
  lossReasons: string[];
  disqualificationReasons: string[];
};

export type DealDraft = {
  rep: string;
  account: string;
  opportunityId: string;
  stage: string;
  value: string;
  stageEnteredOn: string;
  source: string;
  close: string;
  outcome: DealOutcome;
  loss: string;
  disqualificationReason: string;
  notes: string;
};

export function emptyDealDraft(
  rep: string,
  account = '',
  options?: DealFormOptions
): DealDraft {
  return {
    rep,
    account,
    opportunityId: '',
    stage: options?.stages[0] ? String(options.stages[0].id) : '',
    value: '',
    stageEnteredOn: localDateKey(),
    source: options?.sources[0] || '',
    close: '',
    outcome: 'Open',
    loss: options?.lossReasons[0] || '',
    disqualificationReason: options?.disqualificationReasons[0] || '',
    notes: '',
  };
}

export default function AddDealModal({
  open,
  draft,
  reps,
  options,
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
  options: DealFormOptions;
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
    ? 'Record a closed deal. Pipeline stage details do not apply. Closing this window keeps your draft.'
    : subtitle;

  useEffect(() => {
    if (!open) return;
    const next = {
      ...draft,
      stage: draft.stage || (options.stages[0] ? String(options.stages[0].id) : ''),
      source: draft.source || options.sources[0] || '',
      loss: draft.loss || options.lossReasons[0] || '',
      disqualificationReason:
        draft.disqualificationReason || options.disqualificationReasons[0] || '',
    };
    if (JSON.stringify(next) !== JSON.stringify(draft)) onDraftChange(next);
  }, [open, draft, options, onDraftChange]);

  const set = (key: keyof DealDraft) => (event: { target: { value: string } }) => {
    setError('');
    onDraftChange({ ...draft, [key]: event.target.value });
  };

  const setDealValue = (event: { target: { value: string } }) => {
    setError('');
    onDraftChange({ ...draft, value: normalizeDealValueInput(event.target.value) });
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
      setError('Choose the close date before saving.');
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
    const value = dealValueNumber(draft.value);
    if (!Number.isFinite(value) || value < 0) {
      setError('Enter a valid deal value of zero or more.');
      return;
    }
    if (draft.outcome === 'Open' && (
      !options.stages.some((stage) => String(stage.id) === draft.stage) ||
      !draft.stageEnteredOn
    )) {
      setError('Choose a stage and a valid stage-entered date.');
      return;
    }
    if (draft.outcome === 'Open' && draft.stageEnteredOn > localDateKey()) {
      setError('Stage entered on cannot be in the future.');
      return;
    }
    if (draft.outcome !== 'Open' &&
        !options.sources.includes(draft.source)) {
      setError('Choose a lead source from the configured list.');
      return;
    }
    if (draft.outcome === 'Lost' && !options.lossReasons.includes(draft.loss)) {
      setError('Choose a loss reason from the configured list.');
      return;
    }
    if (draft.outcome === 'Disqualified' &&
        !options.disqualificationReasons.includes(draft.disqualificationReason)) {
      setError('Choose a disqualification reason from the configured list.');
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
          placeholder="Optional opportunity ID"
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
              {options.stages.map((stage) => (
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
                type="text"
                inputMode="numeric"
                pattern="[0-9,]*"
                value={formatDealValueInput(draft.value)}
                onChange={setDealValue}
                placeholder="Enter amount in RM"
                disabled={saving}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor={`${id}-stage-entered`}>Stage entered on *</label>
              <input
                id={`${id}-stage-entered`}
                className="form-input"
                type="date"
                value={draft.stageEnteredOn}
                max={localDateKey()}
                onChange={set('stageEnteredOn')}
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
              type="text"
              inputMode="numeric"
              pattern="[0-9,]*"
              value={formatDealValueInput(draft.value)}
              onChange={setDealValue}
              placeholder="Enter amount in RM"
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
              {options.sources.map((source) => (
                <option key={source}>{source}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="form-group">
        <label className="form-label" htmlFor={`${id}-close`}>Close Date *</label>
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
            {options.lossReasons.map((reason) => <option key={reason}>{reason}</option>)}
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
            {options.disqualificationReasons.map((reason) => <option key={reason}>{reason}</option>)}
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
