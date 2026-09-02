'use client';
/* My Proposals — list view + editor (Doc §3.8 / §4.9).
   The AI call now goes through lib/ai.ts → /api/generate; there is no
   API-key modal on this page any more because there is no key in the
   browser to enter. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Modal from '@/components/Modal';
import RequireLevel from '@/components/RequireLevel';
import { useToast } from '@/components/Toast';
import { callClaude } from '@/lib/ai';
import {
  OPPORTUNITIES,
  currentUser,
  ensureProposalStore,
  fmtRM,
  saveProposals,
  type Proposal,
  type ProposalStatus,
} from '@/lib/data';
import { notify } from '@/lib/notify';
import { isRemoteDataSource } from '@/lib/data-sync';
import { useRemoteDataRefresh } from '@/lib/useRemoteDataRefresh';

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
const SECTION_KEYS = Object.keys(SECTION_LABELS);

const PILL_CLASS: Record<string, string> = {
  'Approved': 'pill-approved',
  'Reject & Revise': 'pill-revise',
  'Reject & Close': 'pill-closed',
  'Pending Review': 'pill-pending',
  'Superseded': 'pill-superseded',
};
const pillClass = (status: string) => PILL_CLASS[status] || 'pill-draft';

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  'Draft': { bg: 'var(--gray-100)', color: 'var(--gray-500)' },
  'Pending Review': { bg: 'var(--blue-50)', color: 'var(--blue-600)' },
  'Approved': { bg: '#073b2c', color: '#34D399' },
  'Reject & Revise': { bg: '#452412', color: '#FB923C' },
  'Reject & Close': { bg: 'var(--red-50)', color: 'var(--red-700)' },
  'Superseded': { bg: 'var(--gray-50)', color: 'var(--gray-400)' },
};

/* Submit-button state per status. Anything not listed uses the default. */
const SUBMIT_STATE: Record<string, { disabled: boolean; label: string }> = {
  'Reject & Revise': { disabled: false, label: 'Resubmit for Approval' },
  'Reject & Close': { disabled: true, label: 'Closed — Cannot Resubmit' },
  'Pending Review': { disabled: true, label: 'Awaiting Review' },
  'Approved': { disabled: true, label: 'Already Approved' },
  'Superseded': { disabled: true, label: 'Superseded Version' },
};
const SUBMIT_DEFAULT = { disabled: false, label: 'Submit for Approval' };

const EDITABLE_STATUSES = new Set<ProposalStatus>(['Draft', 'Reject & Revise']);
const canEditProposal = (status: ProposalStatus) => EDITABLE_STATUSES.has(status);

/* Sort order for the "Rejected first" rule. */
const STATUS_SORT: Record<string, number> = {
  'Reject & Revise': 0,
  'Draft': 1,
  'Pending Review': 2,
  'Approved': 3,
};

const DEFAULT_SECTIONS: Record<string, string> = {
  executive:
    'Tzu Chi Foundation requires a comprehensive volunteer management solution to streamline recruitment, deployment, communication, and reporting across its global operations.\n\nOur proposed solution will help Tzu Chi improve volunteer coordination, increase operational efficiency, and enhance impact measurement while supporting multiple languages and regions.',
  challenges:
    'Tzu Chi faces several operational challenges:\n\n1. Managing 10,000+ volunteers across 60+ countries with diverse languages\n2. Manual volunteer coordination leading to delays in disaster response\n3. Limited visibility into volunteer availability and skills inventory\n4. Fragmented donor tracking and fund utilization reporting',
  solution:
    'Ramssol proposes a cloud-based Volunteer Management System (VMS) that provides:\n\n• Centralized volunteer registry with multilingual support (20+ languages)\n• AI-powered matching of volunteers to deployment needs\n• Real-time coordination and communication platform\n• Integrated donor management with fund tracking dashboards',
  benefits:
    'Key benefits for Tzu Chi:\n\n• 60% reduction in volunteer coordination time\n• Real-time visibility across all regional operations\n• Automated compliance reporting for donors and regulators\n• Mobile-first design for field volunteers',
  implementation:
    'Phase 1 (Weeks 1-4): System setup, data migration, admin training\nPhase 2 (Weeks 5-8): Pilot with Taiwan and Malaysia chapters\nPhase 3 (Weeks 9-12): Global rollout and optimization\nPhase 4 (Month 4+): Ongoing support and enhancement',
  commercials:
    'System License: RM 180,000/year (up to 15,000 active users)\nImplementation: RM 85,000 (one-time)\nTraining: RM 25,000\nSupport: RM 36,000/year (8x5 SLA)\n\nTotal Year 1: RM 326,000',
  casestudies:
    'Red Cross Malaysia — Implemented volunteer management for 5,000 volunteers. Result: 45% faster disaster response deployment.\n\nWelfare Department Malaysia — Donor tracking system for 200,000 donors. Result: 98% fund utilization transparency.',
  nextsteps:
    '1. Schedule a technical demo (30 mins) with your IT team\n2. Conduct a 2-week proof-of-concept pilot\n3. Finalize commercial terms and SLA\n4. Sign MOU and kick off implementation',
};

const genId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const todayUK = () =>
  new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dealTitle = (p: Proposal) => p.deal + (p.version > 1 ? ` (v${p.version})` : '');

function ProposalsPage() {
  const toast = useToast();
  const [store, setStore] = useState<Proposal[]>([]);
  const [me, setMe] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [sections, setSections] = useState<Record<string, string>>({});
  const [section, setSection] = useState('executive');

  const [newOpen, setNewOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyCase, setHistoryCase] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const reload = useCallback(() => setStore(ensureProposalStore()), []);

  useEffect(() => {
    setMe(currentUser());
    reload();
  }, [reload]);
  useRemoteDataRefresh(reload);

  const editing = editingId ? store.find((p) => p.id === editingId) || null : null;

  /* ── LIST ──────────────────────────────────────────────── */
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    // My Proposals shows OWN proposals only, current version per case:
    // Superseded and Reject & Close drop out (Doc §3.8).
    let out = store.filter(
      (p) =>
        (p.owner || p.submittedBy) === me &&
        p.status !== 'Superseded' &&
        p.status !== 'Reject & Close'
    );
    if (statusFilter !== 'all') out = out.filter((p) => p.status === statusFilter);
    if (q) {
      out = out.filter((p) =>
        [p.company, p.deal, p.caseId, p.reviewer, p.opportunityId].some((v) =>
          (v || '').toLowerCase().includes(q)
        )
      );
    }
    // Default sort: Rejected first, then most recently updated.
    return out.sort((a, b) => {
      const sa = STATUS_SORT[a.status] ?? 9;
      const sb = STATUS_SORT[b.status] ?? 9;
      if (sa !== sb) return sa - sb;
      return (b.generatedDate || '').localeCompare(a.generatedDate || '');
    });
  }, [store, me, query, statusFilter]);

  const caseVersionCount = (caseId: string) => store.filter((p) => p.caseId === caseId).length;

  /* Delete allowed only while Draft (Doc §3.8). */
  function deleteProposal(id: string) {
    const p = store.find((x) => x.id === id);
    if (!p) return;
    if (p.status !== 'Draft') {
      toast('⚠️ Only drafts can be deleted', true);
      return;
    }
    if (isRemoteDataSource()) {
      toast('Proposal versions are permanent in Supabase, including drafts.', true);
      return;
    }
    if (!confirm(`Delete draft proposal for "${p.company}"? This cannot be undone.`)) return;
    const next = store.filter((x) => x.id !== id);
    saveProposals(next);
    setStore(next);
    toast('🗑️ Draft deleted');
  }

  /* ── EDITOR ────────────────────────────────────────────── */
  function openEditor(id: string) {
    const p = store.find((x) => x.id === id);
    if (!p) return;
    setEditingId(id);
    setSections({ ...DEFAULT_SECTIONS, ...(p.sections || {}) });
    setSection('executive');
    setSuggestion(null);
  }

  const persist = useCallback(
    (nextSections: Record<string, string>) => {
      if (!editingId) return;
      const target = store.find((proposal) => proposal.id === editingId);
      if (!target || !canEditProposal(target.status)) return;
      const next = store.map((p) =>
        p.id === editingId ? { ...p, sections: { ...p.sections, ...nextSections } } : p
      );
      saveProposals(next);
      setStore(next);
    },
    [editingId, store]
  );

  function backToList() {
    if (editingId) persist(sections);
    setEditingId(null);
    setSuggestion(null);
    reload();
  }

  function switchSection(next: string) {
    setSection(next);
    setSuggestion(null);
  }

  function createFromOpportunity(oppId: string) {
    const o = OPPORTUNITIES.find((x) => x.oppId === oppId);
    if (!o) return;
    const id = genId('PROP');
    const created: Proposal = {
      id,
      // Supabase assigns collision-free case numbers. Seed mode remains fully offline.
      caseId: isRemoteDataSource() ? '' : genId('CASE'),
      opportunityId: o.oppId,
      version: 1,
      company: o.account,
      deal: o.deal,
      value: o.value,
      submittedBy: me,
      owner: me,
      generatedDate: new Date().toISOString().slice(0, 10),
      submittedDate: '',
      status: 'Draft', // Draft is the first state after AI generates
      reviewer: '',
      reviewedDate: '',
      reviewNote: '',
      rejectionReason: '',
      lastUpdated: todayUK(),
      sections: {
        executive: `${o.account} is evaluating a solution for their ${o.industry} operations. This proposal outlines how Ramssol can address their priorities and deliver measurable value.`,
        solution: `Ramssol proposes a tailored solution for ${o.account}. Use "Generate with AI" on each section to expand the draft.`,
        commercials: `Indicative investment: ${fmtRM(o.value)} (Year 1). Final commercials to be confirmed after scoping.`,
      },
    };
    const next = [...store, created];
    saveProposals(next);
    setStore(next);
    setNewOpen(false);
    toast('✨ AI drafted a new proposal — review and submit when ready');
    setEditingId(id);
    setSections({ ...DEFAULT_SECTIONS, ...created.sections });
    setSection('executive');
  }

  /* ── SUBMIT / RESUBMIT ─────────────────────────────────── */
  function submitForApproval() {
    if (!editing || !canEditProposal(editing.status)) return;
    const today = todayUK();
    const merged = { ...sections };

    if (editing.status === 'Reject & Revise') {
      /* Resubmit: the rejected version becomes Superseded (kept for the audit
         trail) and a NEW version of the same case goes back for review
         (Doc §4.9). */
      const newVersion: Proposal = {
        ...editing,
        id: genId('PROP'),
        version: (editing.version || 1) + 1,
        status: 'Pending Review',
        generatedDate: new Date().toISOString().slice(0, 10),
        submittedDate: today,
        lastUpdated: today,
        reviewer: '',
        reviewedDate: '',
        reviewNote: '',
        rejectionReason: '',
        sections: merged as Proposal['sections'],
      };
      const next = store.map((p) =>
        p.id === editing.id ? { ...p, status: 'Superseded' as ProposalStatus, lastUpdated: today } : p
      );
      next.push(newVersion);
      saveProposals(next);
      setStore(next);
      setEditingId(newVersion.id);
      toast(`📤 Resubmitted (v${newVersion.version}) for review`);
      notify(
        'pending',
        'Proposal resubmitted for review',
        `${newVersion.company} — v${newVersion.version} (${newVersion.caseId})`
      );
      return;
    }

    // First submit of a Draft: Draft → Pending Review.
    const next = store.map((p) =>
      p.id === editing.id
        ? {
            ...p,
            status: 'Pending Review' as ProposalStatus,
            submittedDate: today,
            lastUpdated: today,
            sections: merged as Proposal['sections'],
          }
        : p
    );
    saveProposals(next);
    setStore(next);
    toast('📤 Sent to Admin for review');
    notify(
      'pending',
      'Proposal submitted for review',
      `${editing.company} — ${fmtRM(editing.value)} (${editing.caseId || ''})`
    );
  }

  async function generateAIContent() {
    if (!editing || !canEditProposal(editing.status)) return;
    setGenerating(true);
    setSuggestion('Generating…');
    const label = SECTION_LABELS[section] || section;
    const system =
      'You are a professional proposal writer for Ramssol Group, a Malaysian technology solutions company. Write compelling, specific proposal content. Be concise and professional.';
    const msg = `Write the "${label}" section of a proposal for: ${dealTitle(editing)}. Keep it under 150 words, professional and persuasive.`;
    const text = await callClaude([{ role: 'user', content: msg }], system);
    setSuggestion(text);
    setGenerating(false);
  }

  function exportProposal() {
    const content = sections[section] || '';
    const label = SECTION_LABELS[section] || section;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
    a.download = `proposal_${label.toLowerCase().replace(/ /g, '_')}.txt`;
    a.click();
  }

  const submitState = editing ? SUBMIT_STATE[editing.status] || SUBMIT_DEFAULT : SUBMIT_DEFAULT;
  const wordCount = (sections[section] || '').trim()
    ? (sections[section] || '').trim().split(/\s+/).length
    : 0;

  const historyVersions = historyCase
    ? store.filter((p) => p.caseId === historyCase).sort((a, b) => (a.version || 1) - (b.version || 1))
    : [];

  const takenOpps = new Set(store.map((p) => p.opportunityId));
  const openOpps = OPPORTUNITIES.filter((o) => !takenOpps.has(o.oppId));
  const oppPool = openOpps.length ? openOpps : OPPORTUNITIES;

  /* ── RENDER ────────────────────────────────────────────── */
  if (editing) {
    const canEdit = canEditProposal(editing.status);
    const badge = STATUS_BADGE[editing.status] || STATUS_BADGE.Draft;
    const meta = [
      editing.caseId ? `Case ${editing.caseId}` : '',
      editing.opportunityId ? `Opp ${editing.opportunityId}` : '',
      editing.reviewer ? `Reviewer: ${editing.reviewer}` : '',
      editing.submittedDate ? `Submitted: ${editing.submittedDate}` : '',
    ]
      .filter(Boolean)
      .join('  ·  ');

    let banner: { cls: string; text: string } | null = null;
    const rejectText = (prefix: string) => {
      let text = prefix;
      if (editing.rejectionReason) text += ` Reason: ${editing.rejectionReason}.`;
      if (editing.reviewNote) text += `\nAdmin note: ${editing.reviewNote}`;
      if (editing.reviewedDate) text += ` — ${editing.reviewedDate}`;
      return text;
    };
    if (editing.status === 'Reject & Revise') {
      banner = { cls: 'revise', text: rejectText('↩ Sent back for revision.') };
    } else if (editing.status === 'Reject & Close') {
      banner = {
        cls: 'closed',
        text: rejectText('✕ Case closed — this proposal cannot be resubmitted.'),
      };
    } else if (editing.status === 'Approved' && editing.reviewNote) {
      banner = {
        cls: 'approved',
        text:
          '✅ Approved.' +
          (editing.reviewNote ? ` Admin note: ${editing.reviewNote}` : '') +
          (editing.reviewedDate ? ` — ${editing.reviewedDate}` : ''),
      };
    }

    return (
      <>
        <button className="back-btn" onClick={backToList}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to My Proposals
        </button>

        <div className="page-header">
          <div className="page-title">Proposal Generator</div>
          <div className="editor-actions">
            <button className="btn-secondary" onClick={() => setPreviewOpen(true)}>
              Preview
            </button>
            <button
              className="btn-secondary"
              disabled={submitState.disabled}
              style={{
                opacity: submitState.disabled ? 0.4 : 1,
                cursor: submitState.disabled ? 'not-allowed' : 'pointer',
              }}
              onClick={submitForApproval}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M22 2L11 13" />
                <path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
              <span>{submitState.label}</span>
            </button>
            <button className="btn-primary" onClick={exportProposal}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export
            </button>
          </div>
        </div>

        <div className="editor-meta">
          <span className="editor-meta-deal">{dealTitle(editing)}</span>
          <span
            className="editor-meta-badge"
            style={{ background: badge.bg, color: badge.color }}
          >
            {editing.status}
          </span>
          <span className="editor-meta-updated">{meta}</span>
        </div>

        {banner && (
          <div className={`rejection-banner ${banner.cls}`} style={{ whiteSpace: 'pre-wrap' }}>
            {banner.text}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 20 }}>
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--brand-400)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <span style={{ fontWeight: 500, color: 'var(--brand-500)' }}>Outline</span>
          <div style={{ width: 40, height: 1, background: 'var(--gray-200)' }} />
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--brand-700)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 11, fontWeight: 600 }}>2</div>
          <span style={{ fontWeight: 500, color: 'var(--gray-900)' }}>Content</span>
          <div style={{ width: 40, height: 1, background: 'var(--gray-200)' }} />
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray-500)', fontSize: 11 }}>3</div>
          <span style={{ color: 'var(--gray-500)' }}>Review</span>
          <div style={{ width: 40, height: 1, background: 'var(--gray-200)' }} />
          <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gray-500)', fontSize: 11 }}>4</div>
          <span style={{ color: 'var(--gray-500)' }}>Finalize</span>
        </div>

        <div className="proposal-grid">
          <div>
            <div className="proposal-nav">
              <div className="proposal-nav-header">Proposal Sections</div>
              {SECTION_KEYS.map((key, i) => (
                <button
                  key={key}
                  className={`proposal-step${section === key ? ' active' : ''}`}
                  onClick={() => switchSection(key)}
                >
                  {i === 0 ? (
                    <span className="step-num done-num">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5}>
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </span>
                  ) : (
                    <span className="step-num">{i + 1}</span>
                  )}
                  {SECTION_LABELS[key]}
                </button>
              ))}
            </div>

            <div className="proposal-ai-card" style={{ marginTop: 14, background: 'var(--brand-50)', border: '1px solid var(--brand-100)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--brand-500)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4l3 3" />
                </svg>
                AI Suggestions{' '}
                <span style={{ fontSize: 10, background: 'var(--brand-400)', color: 'white', padding: '1px 6px', borderRadius: 10 }}>
                  NEW
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--gray-600)', lineHeight: 1.5, marginBottom: 10 }}>
                AI has generated content suggestions based on your inputs.
              </div>
              <button
                className="btn-primary"
                style={{ width: '100%', justifyContent: 'center', fontSize: 12, padding: 8 }}
                disabled={generating || !canEdit}
                onClick={generateAIContent}
              >
                ✨ View Suggestions
              </button>
            </div>
          </div>

          <div>
            <div className="proposal-editor">
              <div className="editor-toolbar">
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--gray-900)', marginRight: 8 }}>
                  {SECTION_LABELS[section]}
                </span>
                <button className="tool-btn" style={{ fontWeight: 600 }} disabled={!canEdit}>B</button>
                <button className="tool-btn" style={{ fontStyle: 'italic' }} disabled={!canEdit}>I</button>
                <button className="tool-btn" style={{ textDecoration: 'underline' }} disabled={!canEdit}>U</button>
                <button className="tool-btn" disabled={!canEdit}>H2</button>
                <button className="tool-btn" disabled={!canEdit}>≡</button>
                <button className="tool-btn" disabled={!canEdit}>🔗</button>
                <div style={{ flex: 1 }} />
                <button
                  className="btn-secondary"
                  style={{ fontSize: 12, padding: '5px 12px' }}
                  disabled={generating || !canEdit}
                  onClick={generateAIContent}
                >
                  ✨ Generate with AI
                </button>
              </div>

              <div className="editor-body">
                {!canEdit && (
                  <p className="editor-lock-notice" id="proposal-editor-lock">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                      <rect x="5" y="11" width="14" height="10" rx="2" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                    This version is locked because it has been submitted.
                  </p>
                )}
                <textarea
                  className="editor-textarea"
                  rows={14}
                  value={sections[section] || ''}
                  readOnly={!canEdit}
                  aria-readonly={!canEdit}
                  aria-describedby={!canEdit ? 'proposal-editor-lock' : undefined}
                  onChange={(e) => setSections((s) => ({ ...s, [section]: e.target.value }))}
                  onBlur={canEdit ? () => persist(sections) : undefined}
                />
                {canEdit && suggestion !== null && (
                  <div className="ai-suggestion-box">
                    <div className="ai-suggestion-label">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 8v4l3 3" />
                      </svg>
                      AI Suggestion
                    </div>
                    <div className="ai-suggestion-text">{suggestion}</div>
                    <div className="ai-suggestion-actions">
                      <button
                        className="use-btn"
                        disabled={generating || !canEdit}
                        onClick={() => {
                          const next = { ...sections, [section]: suggestion };
                          setSections(next);
                          persist(next);
                          setSuggestion(null);
                        }}
                      >
                        Use This
                      </button>
                      <button className="discard-btn" onClick={() => setSuggestion(null)}>
                        Discard
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="word-count">
                Words: {wordCount} · {canEdit ? 'Saved ✓' : 'Read only'}
              </div>
            </div>
          </div>
        </div>

        {/* FULL-PROPOSAL PREVIEW */}
        <Modal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title={dealTitle(editing)}
          sub="Read-only view of every section as the reviewer will see it."
          style={{ maxWidth: 640, width: 640, maxHeight: '86vh', overflowY: 'auto' }}
          actions={
            <>
              <button className="btn-secondary" onClick={() => setPreviewOpen(false)}>
                Close
              </button>
              {!submitState.disabled && (
                <button
                  className="btn-primary"
                  onClick={() => {
                    setPreviewOpen(false);
                    submitForApproval();
                  }}
                >
                  Looks Good — Submit
                </button>
              )}
            </>
          }
        >
          {SECTION_KEYS.filter((k) => (sections[k] || '').trim()).length ? (
            SECTION_KEYS.filter((k) => (sections[k] || '').trim()).map((k) => (
              <div style={{ marginBottom: 14 }} key={k}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--brand-400)', marginBottom: 5 }}>
                  {SECTION_LABELS[k]}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--gray-700)', lineHeight: 1.6, whiteSpace: 'pre-wrap', background: 'var(--gray-50)', border: '1px solid var(--gray-100)', borderRadius: 8, padding: '10px 12px' }}>
                  {sections[k]}
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">No content yet — fill in a section first.</div>
          )}
        </Modal>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="page-title">My Proposals</div>
        <button className="btn-primary" onClick={() => setNewOpen(true)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New Proposal
        </button>
      </div>
      <div className="list-subtitle">
        Your own proposals only — one row per case, showing the current version. Rejected work is
        listed first.
      </div>

      <div className="proposals-toolbar">
        <input
          className="proposals-search"
          placeholder="Search account, Case ID, Reviewer, or Opportunity ID…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          className="proposals-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="Draft">Draft</option>
          <option value="Pending Review">Pending Review</option>
          <option value="Approved">Approved</option>
          <option value="Reject & Revise">Rejected (Revise)</option>
        </select>
      </div>

      <div className="proposals-list-wrap">
        <table className="proposals-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Version</th>
              <th>Status</th>
              <th>Rejection Reason</th>
              <th>Last Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state">
                    No proposals match. Click <strong>New Proposal</strong> to start one.
                  </div>
                </td>
              </tr>
            ) : (
              list.map((p) => {
                const rejected = p.status === 'Reject & Revise';
                return (
                  <tr key={p.id}>
                    <td>
                      <div className="prop-deal">{p.company}</div>
                      <div className="prop-company">
                        {p.deal} · {p.caseId || '—'}
                      </div>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)' }}>v{p.version || 1}</td>
                    <td>
                      <span className={`status-pill ${pillClass(p.status)}`}>{p.status}</span>
                    </td>
                    <td style={{ fontSize: 12, maxWidth: 220 }}>
                      {rejected ? (
                        <>
                          <div style={{ color: '#FB923C', fontWeight: 500 }}>
                            {p.rejectionReason || '—'}
                          </div>
                          {p.reviewNote && (
                            <div style={{ fontSize: 10.5, color: 'var(--gray-400)', marginTop: 2 }}>
                              {p.reviewNote}
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{ color: 'var(--gray-400)' }}>—</span>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                      {p.lastUpdated || p.submittedDate || '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          className={`row-btn${rejected ? ' resubmit' : ''}`}
                          onClick={() => openEditor(p.id)}
                        >
                          {rejected ? 'Edit & Resubmit' : p.status === 'Draft' ? 'Edit' : 'View'}
                        </button>
                        {caseVersionCount(p.caseId) > 1 && (
                          <button className="row-btn ghost" onClick={() => setHistoryCase(p.caseId)}>
                            History
                          </button>
                        )}
                        {p.status === 'Draft' && (
                          <button className="row-btn danger" onClick={() => deleteProposal(p.id)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* NEW PROPOSAL — pick an opportunity (Doc §3.8) */}
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New Proposal"
        sub="Pick an opportunity — the AI drafts a first version, saved as a Draft you submit manually."
        actions={
          <button className="btn-secondary" onClick={() => setNewOpen(false)}>
            Cancel
          </button>
        }
      >
        <div className="opp-pick">
          {oppPool.map((o) => (
            <button className="opp-item" key={o.oppId} onClick={() => createFromOpportunity(o.oppId)}>
              <div className="oi-deal">{o.deal}</div>
              <div className="oi-meta">
                {o.account} · {o.industry} · {fmtRM(o.value)} · {o.oppId}
              </div>
            </button>
          ))}
        </div>
      </Modal>

      {/* VERSION HISTORY (Doc §3.8 / §4.9) */}
      <Modal
        open={!!historyCase}
        onClose={() => setHistoryCase(null)}
        title={`Version History — ${historyVersions[0]?.company || historyCase || ''}`}
        sub={`${historyCase || ''} · every version is kept for the audit trail.`}
        actions={
          <button className="btn-secondary" onClick={() => setHistoryCase(null)}>
            Close
          </button>
        }
      >
        {historyVersions.map((v) => (
          <div className="vh-row" key={v.id}>
            <div className="vh-ver">v{v.version || 1}</div>
            <div>
              <span className={`status-pill ${pillClass(v.status)}`}>{v.status}</span>
              {v.rejectionReason && (
                <div className="vh-reason">
                  Reason: {v.rejectionReason}
                  {v.reviewNote ? ` — ${v.reviewNote}` : ''}
                </div>
              )}
              {v.reviewer && <div className="vh-reason">Reviewer: {v.reviewer}</div>}
            </div>
            <div className="vh-date">
              {v.lastUpdated || v.submittedDate || v.generatedDate || '—'}
            </div>
          </div>
        ))}
      </Modal>
    </>
  );
}

export default function Page() {
  return (
    <RequireLevel min={1}>
      <ProposalsPage />
    </RequireLevel>
  );
}
