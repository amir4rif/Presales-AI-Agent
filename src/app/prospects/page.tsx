'use client';
/* Prospects workspace (Doc §3.3) — grid, detail view and Add Deal.

   saveProspects/saveDeals are the shared data boundary. They stay local in
   seed mode and queue server-side Lark persistence in Lark mode. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import RequireLevel from '@/components/RequireLevel';
import { useToast } from '@/components/Toast';
import AddDealModal, { emptyDealDraft, type DealDraft } from '@/components/deals/AddDealModal';
import AddProspectModal, { type ProspectForm } from '@/components/prospects/AddProspectModal';
import ProspectDetail from '@/components/prospects/ProspectDetail';
import {
  currentLevel,
  currentUser,
  currentUserId,
  getClosedDeals,
  getDeals,
  getProposals,
  getProspects,
  getReps,
  profileIdForName,
  saveDeals,
  saveProspects,
  type AIResearch,
  type Deal,
  type Prospect,
} from '@/lib/data';
import {
  canManageProspect,
  hasProspectDependencies,
  prospectDependencies,
  type ProspectDependencies,
} from '@/lib/prospect-lifecycle';
import { useRemoteDataRefresh } from '@/lib/useRemoteDataRefresh';

type ProspectAction = {
  prospectId: number;
  mode: 'delete' | 'archive';
  dependencies: ProspectDependencies;
};

function prospectStatus(prospect: Prospect) {
  return prospect.status === 'Inactive' ? 'Inactive' : 'Active';
}

function dependencySummary(dependencies: ProspectDependencies) {
  const labels = [
    dependencies.opportunities
      ? `${dependencies.opportunities} opportunit${dependencies.opportunities === 1 ? 'y' : 'ies'}`
      : '',
    dependencies.deals ? `${dependencies.deals} deal${dependencies.deals === 1 ? '' : 's'}` : '',
    dependencies.proposals
      ? `${dependencies.proposals} proposal${dependencies.proposals === 1 ? '' : 's'}`
      : '',
  ].filter(Boolean);
  return labels.join(' · ');
}

function ProspectsPage() {
  const toast = useToast();
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [industry, setIndustry] = useState('all');
  const [openId, setOpenId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);
  const [reps, setReps] = useState<string[]>([]);
  const [level, setLevel] = useState(1);
  const [viewerId, setViewerId] = useState<string | undefined>();
  const [dealDrafts, setDealDrafts] = useState<Record<number, DealDraft>>({});
  const [prospectAction, setProspectAction] = useState<ProspectAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const reload = useCallback(() => {
    setProspects(getProspects());
    const me = currentUser();
    const list = getReps();
    setReps(currentLevel() === 1 && !list.includes(me) ? [me, ...list] : list);
  }, []);

  useEffect(() => {
    reload();
    setLevel(currentLevel());
    setViewerId(currentUserId());
  }, [reload]);
  useRemoteDataRefresh(reload);

  const industries = useMemo(
    () => [...new Set(prospects.map((p) => p.type))].sort(),
    [prospects]
  );
  const shown = industry === 'all' ? prospects : prospects.filter((p) => p.type === industry);
  const open = openId != null ? prospects.find((p) => p.id === openId) || null : null;

  function handleAdd(p: Prospect, _form: ProspectForm, research: AIResearch | null) {
    const prospect: Prospect = {
      ...p,
      ownerId: p.ownerId || currentUserId(),
      status: 'Active',
    };
    const next = [...prospects, prospect];
    void saveProspects(next);
    setProspects(next);
    setAddOpen(false);
    toast(`✅ Prospect added${research ? ' with AI research attached' : ''}`);
  }

  async function addDeal(draft: DealDraft, prospect: Prospect) {
    const repId = draft.rep === currentUser()
      ? currentUserId() || profileIdForName(draft.rep)
      : profileIdForName(draft.rep);
    const deal: Deal = {
      ownerId: repId,
      prospectId: prospect.id,
      rep: draft.rep,
      account: draft.account.trim(),
      stage: Number(draft.stage),
      daysInStage: Number(draft.days) || 1,
      daysToClose: 90,
      value: Number(draft.value) || 0,
      movement: 'Advanced',
      status: 'On Track',
      notes: draft.notes.trim(),
    };
    const next: Deal[] = [
      ...getDeals(),
      deal,
    ];
    const saved = await saveDeals(next);
    if (!saved) return false;
    setDealDrafts((drafts) => ({
      ...drafts,
      [prospect.id]: emptyDealDraft(currentUser(), prospect.name),
    }));
    setDealOpen(false);
    toast('✅ Deal added to the pipeline');
    return true;
  }

  function getDependencies(prospect: Prospect) {
    return prospectDependencies(prospect, getDeals(), getProposals(), getClosedDeals());
  }

  function requestProspectAction(prospect: Prospect) {
    const dependencies = getDependencies(prospect);
    setActionError('');
    setProspectAction({
      prospectId: prospect.id,
      mode: hasProspectDependencies(dependencies) ? 'archive' : 'delete',
      dependencies,
    });
  }

  async function confirmProspectAction() {
    if (!prospectAction || actionBusy) return;
    const target = getProspects().find((prospect) => prospect.id === prospectAction.prospectId);
    if (!target) {
      setActionError('This prospect no longer exists. Close this dialog and refresh the list.');
      return;
    }

    const dependencies = getDependencies(target);
    if (prospectAction.mode === 'delete' && hasProspectDependencies(dependencies)) {
      setProspectAction({ prospectId: target.id, mode: 'archive', dependencies });
      setActionError('Linked work was added. Review the archive action before continuing.');
      return;
    }

    setActionBusy(true);
    setActionError('');
    const deleting = prospectAction.mode === 'delete';
    const next = deleting
      ? getProspects().filter((prospect) => prospect.id !== target.id)
      : getProspects().map((prospect) =>
          prospect.id === target.id ? { ...prospect, status: 'Inactive' as const } : prospect
        );
    const saved = await saveProspects(
      next,
      deleting ? { deletedIds: [target.id], suppressSyncError: true } : { suppressSyncError: true }
    );
    setActionBusy(false);

    if (!saved) {
      setActionError(
        deleting
          ? 'The prospect could not be deleted. Check that it has no linked work, then try again.'
          : 'The prospect could not be archived. Your data is unchanged; try again.'
      );
      return;
    }

    setProspects(next);
    setProspectAction(null);
    if (deleting) {
      setDealDrafts((drafts) => {
        const nextDrafts = { ...drafts };
        delete nextDrafts[target.id];
        return nextDrafts;
      });
      setOpenId(null);
      toast(`🗑️ ${target.name} deleted`);
    } else {
      toast(`${target.name} archived as Inactive`);
    }
  }

  const actionTarget = prospectAction
    ? prospects.find((prospect) => prospect.id === prospectAction.prospectId) || null
    : null;

  if (open) {
    const dependencies = getDependencies(open);
    const removalMode = prospectStatus(open) === 'Inactive' && hasProspectDependencies(dependencies)
      ? null
      : hasProspectDependencies(dependencies)
        ? 'archive'
        : 'delete';
    const draft = dealDrafts[open.id] || emptyDealDraft(currentUser(), open.name);

    return (
      <>
        <ProspectDetail
          prospect={open}
          all={prospects}
          onBack={() => setOpenId(null)}
          onChange={setProspects}
          onNewDeal={() => setDealOpen(true)}
          canManage={canManageProspect(open, level, viewerId)}
          removalMode={removalMode}
          onRemove={() => requestProspectAction(open)}
        />
        <AddDealModal
          open={dealOpen}
          draft={draft}
          onClose={() => setDealOpen(false)}
          reps={reps}
          repLocked={level === 1}
          onDraftChange={(nextDraft) =>
            setDealDrafts((drafts) => ({ ...drafts, [open.id]: nextDraft }))
          }
          onClear={() =>
            setDealDrafts((drafts) => ({
              ...drafts,
              [open.id]: emptyDealDraft(currentUser(), open.name),
            }))
          }
          onSubmit={(nextDraft) => addDeal(nextDraft, open)}
        />
        {prospectAction && actionTarget && (
          <Modal
            open
            onClose={() => {
              if (actionBusy) return;
              setProspectAction(null);
              setActionError('');
            }}
            title={`${prospectAction.mode === 'delete' ? 'Delete' : 'Archive'} ${actionTarget.name}?`}
            sub={
              prospectAction.mode === 'delete'
                ? 'This permanently removes the prospect and cannot be undone.'
                : 'This keeps linked history intact and marks the prospect Inactive.'
            }
            actions={
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={actionBusy}
                  onClick={() => {
                    setProspectAction(null);
                    setActionError('');
                  }}
                >
                  Close
                </button>
                <button
                  type="button"
                  className={prospectAction.mode === 'delete' ? 'btn-danger' : 'btn-primary'}
                  disabled={actionBusy}
                  onClick={confirmProspectAction}
                >
                  {actionBusy
                    ? prospectAction.mode === 'delete' ? 'Deleting…' : 'Archiving…'
                    : prospectAction.mode === 'delete' ? 'Delete Prospect' : 'Archive Prospect'}
                </button>
              </>
            }
          >
            <div className="confirm-strip">
              <div className="cs-msg">
                {prospectAction.mode === 'delete'
                  ? 'No opportunities, deals, or proposals are linked to this prospect.'
                  : 'This prospect cannot be deleted because linked work depends on it.'}
              </div>
              {prospectAction.mode === 'archive' && (
                <div className="cs-warn">
                  Linked records: {dependencySummary(prospectAction.dependencies)}
                </div>
              )}
              {actionError && <div className="form-error" role="alert">{actionError}</div>}
            </div>
          </Modal>
        )}
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title">Prospects</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <select
            className="fs"
            style={{ width: 'auto', padding: '8px 30px 8px 12px', fontSize: 13 }}
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          >
            <option value="all">All Industries</option>
            {industries.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <button className="btn-primary" onClick={() => setAddOpen(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Prospect
          </button>
        </div>
      </div>

      <div className="prospects-grid">
        {shown.length ? (
          shown.map((p) => (
            <div className="prospect-card" key={p.id} onClick={() => setOpenId(p.id)}>
              <div className="prospect-header">
                <div>
                  <div className="prospect-name">
                    {p.watched ? '★ ' : ''}
                    {p.name}
                  </div>
                  <div className="prospect-type">{p.type}</div>
                </div>
                <span className={`prospect-tag${prospectStatus(p) === 'Inactive' ? ' inactive' : ''}`}>
                  {prospectStatus(p)}
                </span>
              </div>
              <div className="prospect-meta">
                <span>🌐 {p.country}</span>
                <span>👥 {p.employees}</span>
              </div>
              <div className="prospect-tags">
                {(p.tags || []).slice(0, 3).map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
              <div className="prospect-footer">
                <span className="prospect-opp">
                  <strong>{p.opportunities}</strong> opportunities
                </span>
                <span style={{ fontSize: 12, fontFamily: 'var(--mono)', fontWeight: 500, color: 'var(--brand-500)' }}>
                  RM {(p.totalValue || 0).toFixed(1)}M
                </span>
              </div>
            </div>
          ))
        ) : (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: 'var(--gray-400)', fontSize: 13 }}>
            No prospects in this industry yet.
          </div>
        )}
      </div>

      <AddProspectModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAdd} />
    </>
  );
}

export default function Page() {
  return (
    <RequireLevel min={1}>
      <ProspectsPage />
    </RequireLevel>
  );
}
