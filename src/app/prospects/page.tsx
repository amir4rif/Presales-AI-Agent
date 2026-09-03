'use client';
/* Prospects workspace (Doc §3.3) — grid, detail view and Add Deal.

   saveProspects/saveDeals are the shared data boundary. They stay local in
   seed mode and queue server-side Lark persistence in Lark mode. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import RequireLevel from '@/components/RequireLevel';
import { useToast } from '@/components/Toast';
import AddProspectModal, { type ProspectForm } from '@/components/prospects/AddProspectModal';
import ProspectDetail from '@/components/prospects/ProspectDetail';
import {
  currentUser,
  currentUserId,
  getDeals,
  getProspects,
  getReps,
  profileIdForName,
  saveDeals,
  saveProspects,
  type AIResearch,
  type Deal,
  type Prospect,
} from '@/lib/data';
import { useRemoteDataRefresh } from '@/lib/useRemoteDataRefresh';

const STAGE_OPTIONS = [
  '1 – Prospecting',
  '2 – Qualifying Leads',
  '3 – Initial Meeting',
  '4 – Define Prospect Needs',
  '5 – Make An Offer',
  '6 – Negotiation / Finalize',
  '7 – Closing The Deal',
  '8 – Deliver The Product',
];

function ProspectsPage() {
  const toast = useToast();
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [industry, setIndustry] = useState('all');
  const [openId, setOpenId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);
  const [reps, setReps] = useState<string[]>([]);

  const reload = useCallback(() => setProspects(getProspects()), []);

  useEffect(() => {
    reload();
    // Keep the Add Deal salesperson list in sync with the shared rep list.
    const me = currentUser();
    const list = getReps();
    const names = list.includes(me) ? list : [me, ...list];
    setReps(names);
  }, [reload]);
  useRemoteDataRefresh(reload);

  const industries = useMemo(
    () => [...new Set(prospects.map((p) => p.type))].sort(),
    [prospects]
  );
  const shown = industry === 'all' ? prospects : prospects.filter((p) => p.type === industry);
  const open = openId != null ? prospects.find((p) => p.id === openId) || null : null;

  function handleAdd(p: Prospect, _form: ProspectForm, research: AIResearch | null) {
    const next = [...prospects, p];
    saveProspects(next);
    setProspects(next);
    setAddOpen(false);
    toast(`✅ Prospect added${research ? ' with AI research attached' : ''}`);

  }

  function addDeal(deal: Deal) {
    const next: Deal[] = [
      ...getDeals(),
      deal,
    ];
    saveDeals(next); // keep Pipeline + dashboards in sync
    toast('✅ Deal added to the pipeline');
  }

  if (open) {
    return (
      <>
        <ProspectDetail
          prospect={open}
          all={prospects}
          onBack={() => setOpenId(null)}
          onChange={setProspects}
          onNewDeal={() => setDealOpen(true)}
        />
        <AddDealModal
          key={open.id}
          open={dealOpen}
          onClose={() => setDealOpen(false)}
          reps={reps}
          prospect={open}
          onSubmit={addDeal}
        />
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
                <span className="prospect-tag">Active</span>
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

type DealForm = { rep: string; account: string; stage: string; value: string; days: string; notes: string };

function emptyDealForm(): DealForm {
  return { rep: currentUser(), account: '', stage: '1', value: '', days: '', notes: '' };
}

function AddDealModal({
  open,
  onClose,
  reps,
  prospect,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  reps: string[];
  prospect: Prospect;
  onSubmit: (deal: Deal) => void;
}) {
  const [deal, setDeal] = useState<DealForm>(emptyDealForm);

  useEffect(() => {
    if (open) setDeal(emptyDealForm());
  }, [open, prospect.id]);

  const set = (k: keyof DealForm) => (e: { target: { value: string } }) =>
    setDeal((d) => ({ ...d, [k]: e.target.value }));

  function close() {
    setDeal(emptyDealForm());
    onClose();
  }

  function submit() {
    if (!deal.account.trim()) {
      alert('Please enter an account name.');
      return;
    }
    const repId = deal.rep === currentUser()
      ? currentUserId() || profileIdForName(deal.rep)
      : profileIdForName(deal.rep);
    onSubmit({
      ownerId: repId,
      prospectId: prospect.id,
      rep: deal.rep,
      account: deal.account.trim(),
      stage: Number(deal.stage),
      daysInStage: Number(deal.days) || 1,
      daysToClose: 90,
      value: Number(deal.value) || 0,
      movement: 'Advanced',
      status: 'On Track',
      notes: deal.notes.trim(),
    });
    close();
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add New Deal"
      sub="Add an active deal to the pipeline."
      actions={
        <>
          <button className="btn-secondary" onClick={close}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit}>
            Add Deal
          </button>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label">Salesperson *</label>
        <select className="form-select" value={deal.rep} onChange={set('rep')}>
          {reps.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Account / Client *</label>
        <input className="form-input" value={deal.account} onChange={set('account')} placeholder="Company name" />
      </div>
      <div className="form-group">
        <label className="form-label">Stage *</label>
        <select className="form-select" value={deal.stage} onChange={set('stage')}>
          {STAGE_OPTIONS.map((s, i) => (
            <option value={String(i + 1)} key={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="form-group">
          <label className="form-label">Deal Value (RM) *</label>
          <input className="form-input" type="number" value={deal.value} onChange={set('value')} placeholder="3000000" />
        </div>
        <div className="form-group">
          <label className="form-label">Days in Stage *</label>
          <input className="form-input" type="number" value={deal.days} onChange={set('days')} placeholder="5" />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Notes</label>
        <input className="form-input" value={deal.notes} onChange={set('notes')} placeholder="Optional notes..." />
      </div>
    </Modal>
  );
}

export default function Page() {
  return (
    <RequireLevel min={1}>
      <ProspectsPage />
    </RequireLevel>
  );
}
