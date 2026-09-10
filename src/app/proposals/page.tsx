'use client';
/* My Proposals — list view + editor (Doc §3.8 / §4.9).
   The AI call now goes through lib/ai.ts → /api/generate; there is no
   API-key modal on this page any more because there is no key in the
   browser to enter. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Modal from '@/components/Modal';
import RequireLevel from '@/components/RequireLevel';
import { useToast } from '@/components/Toast';
import { callClaude } from '@/lib/ai';
import {
  OPPORTUNITIES,
  currentUser,
  currentUserId,
  ensureProposalStore,
  fmtRM,
  profileIdForName,
  saveProposals,
  type Proposal,
  type ProposalStatus,
} from '@/lib/data';
import {
  confirmedCollectionSnapshot,
  initializeDataLayer,
  isRemoteDataSource,
  runProposalDataTransaction,
} from '@/lib/data-sync';
import { visibleProposalVersionsForOwner } from '@/lib/proposal-lifecycle';
import {
  conflictingProposalSectionKeys,
  mergeEditedProposalSections,
  rebaseProposalEditorSections,
  remainingProposalSectionEditRevisions,
} from '@/lib/proposal-sections';
import {
  clearProposalRevisionWorkingCopy,
  loadProposalRevisionWorkingCopy,
  saveProposalRevisionWorkingCopy,
} from '@/lib/proposal-working-copy';
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
const SECTION_KEY_SET = new Set(SECTION_KEYS);

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
  'Reject & Close': 1,
  'Draft': 2,
  'Pending Review': 3,
  'Approved': 4,
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
  const editorSectionsRef = useRef<Record<string, string>>({});
  const editedSectionRevisions = useRef<Map<string, number>>(new Map());
  const nextSectionEditRevision = useRef(0);
  const editorProposalIdRef = useRef<string | null>(null);
  const editorCanonicalSectionsRef = useRef<Record<string, string>>({});
  const editorCanonicalUpdatedAtRef = useRef<string | undefined>(undefined);
  const pendingDraftAcknowledgementRef = useRef<{
    proposalId: string;
    sections: Record<string, string>;
  } | null>(null);
  const sectionConflictKeysRef = useRef<Set<string>>(new Set());
  const [sectionConflictKeys, setSectionConflictKeys] = useState<string[]>([]);
  const workingCopyWriterIdRef = useRef('');
  const [section, setSection] = useState('executive');

  const [newOpen, setNewOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [historyCase, setHistoryCase] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const suggestionRequestRef = useRef(0);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [leavingEditor, setLeavingEditor] = useState(false);
  const leavingEditorRef = useRef(false);
  const [listSaving, setListSaving] = useState(false);
  const listSavingRef = useRef(false);
  const draftPersistRef = useRef<Promise<boolean> | null>(null);

  const markSectionEdited = useCallback((key: string, value: string) => {
    const matchesCanonical = (editorCanonicalSectionsRef.current[key] || '') === value;
    const pendingWrite = pendingDraftAcknowledgementRef.current;
    const pendingWriteForSection =
      pendingWrite?.proposalId === editorProposalIdRef.current &&
      Object.prototype.hasOwnProperty.call(pendingWrite.sections, key);
    const undoesPendingWrite = pendingWriteForSection &&
      (pendingWrite.sections[key] || '') !== value;

    if (matchesCanonical && sectionConflictKeysRef.current.delete(key)) {
      setSectionConflictKeys([...sectionConflictKeysRef.current]);
    }
    if (matchesCanonical && !undoesPendingWrite) {
      editedSectionRevisions.current.delete(key);
      return;
    }
    editedSectionRevisions.current.set(key, ++nextSectionEditRevision.current);
  }, []);

  const clearSectionEdits = useCallback(() => {
    editedSectionRevisions.current.clear();
  }, []);

  const clearSectionConflicts = useCallback(() => {
    sectionConflictKeysRef.current.clear();
    setSectionConflictKeys([]);
  }, []);

  const clearPersistedSectionEdits = useCallback((persisted: ReadonlyMap<string, number>) => {
    editedSectionRevisions.current = remainingProposalSectionEditRevisions(
      editedSectionRevisions.current,
      persisted
    );
    sectionConflictKeysRef.current = new Set(
      [...sectionConflictKeysRef.current].filter((key) =>
        editedSectionRevisions.current.has(key)
      )
    );
    setSectionConflictKeys([...sectionConflictKeysRef.current]);
  }, []);

  const workingCopyWriterId = useCallback(() => {
    if (!workingCopyWriterIdRef.current) {
      workingCopyWriterIdRef.current = crypto.randomUUID();
    }
    return workingCopyWriterIdRef.current;
  }, []);

  const confirmSectionConflictOverwrite = useCallback(() => {
    const conflicts = [...sectionConflictKeysRef.current];
    if (!conflicts.length) return true;
    const labels = conflicts.map((key) => SECTION_LABELS[key] || key).join(', ');
    const confirmed = confirm(
      `This draft changed elsewhere in: ${labels}. Choose OK to keep and save your version over those newer section changes, or Cancel to keep editing without saving.`
    );
    if (confirmed) clearSectionConflicts();
    return confirmed;
  }, [clearSectionConflicts]);

  const registerCanonicalSectionConflicts = useCallback((proposal: Proposal) => {
    const sameProposal = editorProposalIdRef.current === proposal.id;
    const dirtyKeys = [...editedSectionRevisions.current.keys()];
    const canonicalSections = { ...(proposal.sections || {}) } as Record<string, string>;
    let nextConflicts = sameProposal
      ? new Set(
          [...sectionConflictKeysRef.current].filter((key) =>
            dirtyKeys.includes(key) &&
            (canonicalSections[key] || '') !== (editorSectionsRef.current[key] || '')
          )
        )
      : new Set<string>();
    if (
      sameProposal && canEditProposal(proposal.status) &&
      editorCanonicalUpdatedAtRef.current && proposal.updatedAt &&
      editorCanonicalUpdatedAtRef.current !== proposal.updatedAt
    ) {
      const acknowledgement = pendingDraftAcknowledgementRef.current;
      const acknowledgedSections = acknowledgement?.proposalId === proposal.id
        ? acknowledgement.sections
        : undefined;
      const conflicts = conflictingProposalSectionKeys(
        editorCanonicalSectionsRef.current,
        canonicalSections,
        dirtyKeys,
        acknowledgedSections,
        editorSectionsRef.current
      );
      if (conflicts.length) {
        nextConflicts = new Set([...nextConflicts, ...conflicts]);
      }
    }
    sectionConflictKeysRef.current = nextConflicts;
    setSectionConflictKeys([...nextConflicts]);
    editorCanonicalSectionsRef.current = canonicalSections;
    editorCanonicalUpdatedAtRef.current = proposal.updatedAt;
  }, []);

  const reload = useCallback(() => setStore(ensureProposalStore()), []);
  const reconcileWithRemote = useCallback(async () => {
    if (isRemoteDataSource()) {
      await initializeDataLayer({ force: true }).catch(() => undefined);
    }
    reload();
  }, [reload]);

  useEffect(() => {
    setMe(currentUser());
    reload();
  }, [reload]);
  useRemoteDataRefresh(reload);

  const editing = editingId ? store.find((p) => p.id === editingId) || null : null;
  const confirmedEditing = editing && isRemoteDataSource()
    ? confirmedCollectionSnapshot<Proposal>('proposals')?.find((p) => p.id === editing.id) || null
    : null;
  const canonicalEditing = confirmedEditing || editing;
  const canonicalEditingId = canonicalEditing?.id || null;
  const canonicalEditingSections = canonicalEditing?.sections;
  const canonicalEditingStatus = canonicalEditing?.status;
  const canonicalEditingUpdatedAt = canonicalEditing?.updatedAt;

  useEffect(() => {
    editorSectionsRef.current = sections;
  }, [sections]);

  useEffect(() => {
    if (!canonicalEditingId || !canonicalEditingStatus) {
      editorProposalIdRef.current = null;
      editorCanonicalSectionsRef.current = {};
      editorCanonicalUpdatedAtRef.current = undefined;
      clearSectionConflicts();
      return;
    }

    const sameProposal = editorProposalIdRef.current === canonicalEditingId;
    const editable = canEditProposal(canonicalEditingStatus);
    const canonicalSections = { ...(canonicalEditingSections || {}) };
    registerCanonicalSectionConflicts(canonicalEditing);
    const rebased = rebaseProposalEditorSections(
      canonicalSections,
      editorSectionsRef.current,
      editedSectionRevisions.current.keys(),
      { sameProposal, editable }
    );
    editorProposalIdRef.current = canonicalEditingId;
    editorSectionsRef.current = rebased.sections;
    if (!rebased.editedKeys.length) {
      clearSectionEdits();
      clearSectionConflicts();
    }
    setSections(rebased.sections);
    if (!editable) {
      suggestionRequestRef.current += 1;
      setGenerating(false);
      setSuggestion(null);
    }
  }, [
    canonicalEditingId,
    canonicalEditingSections,
    canonicalEditingStatus,
    canonicalEditingUpdatedAt,
    clearSectionConflicts,
    clearSectionEdits,
    canonicalEditing,
    registerCanonicalSectionConflicts,
  ]);

  useEffect(() => {
    if (!canonicalEditingStatus || !canEditProposal(canonicalEditingStatus)) return;
    const confirmRevisionDiscard = (event: BeforeUnloadEvent) => {
      if (!editedSectionRevisions.current.size) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', confirmRevisionDiscard);
    return () => window.removeEventListener('beforeunload', confirmRevisionDiscard);
  }, [canonicalEditingId, canonicalEditingStatus]);

  /* ── LIST ──────────────────────────────────────────────── */
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    // My Proposals shows every owned live version. Only Superseded is audit-only.
    let out = visibleProposalVersionsForOwner(store, me, currentUserId());
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
  async function deleteProposal(id: string) {
    if (listSavingRef.current) return;
    const p = store.find((x) => x.id === id);
    if (!p) return;
    if (p.status !== 'Draft') {
      toast('⚠️ Only drafts can be deleted', true);
      return;
    }
    if (!confirm(`Delete draft proposal for "${p.company}"? This cannot be undone.`)) return;
    listSavingRef.current = true;
    setListSaving(true);
    try {
      await runProposalDataTransaction(async () => {
        const current = ensureProposalStore().find((proposal) => proposal.id === id);
        if (!current || current.status !== 'Draft') {
          await reconcileWithRemote();
          toast('⚠️ This draft changed elsewhere. The latest version is now shown.', true);
          return;
        }
        const next = ensureProposalStore().filter((x) => x.id !== id);
        const persisted = await saveProposals(next, { deletedIds: [id] });
        if (!persisted) {
          await reconcileWithRemote();
          return;
        }
        reload();
        toast('🗑️ Draft deleted');
      });
    } finally {
      listSavingRef.current = false;
      setListSaving(false);
    }
  }

  /* ── EDITOR ────────────────────────────────────────────── */
  async function openEditor(id: string) {
    if (listSavingRef.current) return;
    listSavingRef.current = true;
    setListSaving(true);
    try {
      // Never open against another component's optimistic proposal cache.
      // Its complete proposal transaction must first confirm or roll back.
      await runProposalDataTransaction(() => {
        const latestStore = ensureProposalStore();
        const p = latestStore.find((x) => x.id === id);
        setStore(latestStore);
        if (!p) return;
        const confirmed = isRemoteDataSource()
          ? confirmedCollectionSnapshot<Proposal>('proposals')?.find((x) => x.id === id) || p
          : p;
        editorProposalIdRef.current = id;
        const canonicalSections = { ...(confirmed.sections || {}) } as Record<string, string>;
        editorCanonicalSectionsRef.current = canonicalSections;
        editorCanonicalUpdatedAtRef.current = confirmed.updatedAt;
        clearSectionEdits();
        clearSectionConflicts();
        const restored = canEditProposal(p.status)
          ? loadProposalRevisionWorkingCopy(
              window.sessionStorage,
              currentUserId() || currentUser(),
              p.id,
              confirmed.updatedAt,
              canonicalSections,
              SECTION_KEY_SET
            )
          : null;
        const editorSections = { ...canonicalSections, ...(restored?.sections || {}) };
        for (const key of restored?.editedKeys || []) {
          editedSectionRevisions.current.set(key, ++nextSectionEditRevision.current);
        }
        sectionConflictKeysRef.current = new Set(restored?.conflictKeys || []);
        setSectionConflictKeys([...sectionConflictKeysRef.current]);
        editorSectionsRef.current = editorSections;
        if (restored) {
          saveProposalRevisionWorkingCopy(
            window.sessionStorage,
            currentUserId() || currentUser(),
            p.id,
            workingCopyWriterId(),
            restored.canonicalUpdatedAt,
            restored.canonicalSections,
            editorSections,
            editedSectionRevisions.current.keys(),
            sectionConflictKeysRef.current
          );
        }
        setSections(editorSections);
        setEditingId(id);
        setSection('executive');
        suggestionRequestRef.current += 1;
        setSuggestion(null);
      });
    } finally {
      listSavingRef.current = false;
      setListSaving(false);
    }
  }

  const retainRevisionWorkingCopyFor = useCallback((
    canonical: Proposal,
    nextSections: Record<string, string>,
    requireOwnership = false
  ) => {
    if (!canEditProposal(canonical.status)) return;
    const sameEditor = editorProposalIdRef.current === canonical.id;
    // The working copy must remember the snapshot the user actually saw.
    // localStorage can already contain a newer realtime payload before React's
    // rebase effect has registered it as a conflict.
    const baselineSections = sameEditor
      ? editorCanonicalSectionsRef.current
      : ({ ...(canonical.sections || {}) } as Record<string, string>);
    const baselineUpdatedAt = sameEditor
      ? editorCanonicalUpdatedAtRef.current
      : canonical.updatedAt;
    const writerId = workingCopyWriterId();
    saveProposalRevisionWorkingCopy(
      window.sessionStorage,
      currentUserId() || currentUser(),
      canonical.id,
      writerId,
      baselineUpdatedAt,
      baselineSections,
      nextSections,
      editedSectionRevisions.current.keys(),
      sectionConflictKeysRef.current,
      requireOwnership ? { expectedWriterId: writerId } : undefined
    );
  }, [workingCopyWriterId]);

  const retainRevisionWorkingCopy = useCallback((nextSections: Record<string, string>) => {
    if (!editingId) return;
    const cached = ensureProposalStore().find((proposal) => proposal.id === editingId);
    const canonical = isRemoteDataSource()
      ? confirmedCollectionSnapshot<Proposal>('proposals')?.find(
          (proposal) => proposal.id === editingId
        ) || cached
      : cached;
    if (!canonical) return;
    retainRevisionWorkingCopyFor(canonical, nextSections);
  }, [editingId, retainRevisionWorkingCopyFor]);

  const persist = useCallback(
    (): Promise<boolean> => {
      if (!editingId) return Promise.resolve(true);
      const editorId = editingId;
      const cachedTarget = ensureProposalStore().find((proposal) => proposal.id === editorId);
      const initialTarget = isRemoteDataSource()
        ? confirmedCollectionSnapshot<Proposal>('proposals')?.find(
            (proposal) => proposal.id === editorId
          ) || cachedTarget
        : cachedTarget;
      // A reviewed version is immutable. Its editor is a working copy whose
      // changes belong only to the replacement created during resubmission.
      if (!initialTarget || initialTarget.status !== 'Draft') {
        return draftPersistRef.current || Promise.resolve(true);
      }
      if (!editedSectionRevisions.current.size) {
        return draftPersistRef.current || Promise.resolve(true);
      }
      const previousOperation = draftPersistRef.current;
      const operation = runProposalDataTransaction(async () => {
        if (previousOperation && !(await previousOperation)) return false;
        // The global reservation has drained earlier writes before this point,
        // so matching text now comes from a confirmed cache.
        const effectiveEdits = new Map(editedSectionRevisions.current);
        if (!effectiveEdits.size) return true;
        const capturedSections = { ...editorSectionsRef.current };
        // Read after the preceding save and hydration complete. This ensures
        // every update carries Supabase's newest lossless updated_at token.
        const canonicalStore = ensureProposalStore();
        const target = canonicalStore.find((proposal) => proposal.id === editorId);
        if (!target || target.status !== 'Draft') {
          await reconcileWithRemote();
          return false;
        }
        // localStorage is updated before React necessarily paints a realtime
        // response. Detect against that freshest snapshot at the write point.
        registerCanonicalSectionConflicts(target);
        if (!confirmSectionConflictOverwrite()) return false;
        const merged = mergeEditedProposalSections(
          target.sections,
          capturedSections,
          effectiveEdits.keys()
        );
        if (!merged.changed) {
          clearPersistedSectionEdits(effectiveEdits);
          retainRevisionWorkingCopyFor(target, editorSectionsRef.current, true);
          return true;
        }
        const next = canonicalStore.map((proposal) =>
          proposal.id === editorId
            ? { ...proposal, sections: merged.sections as Proposal['sections'] }
            : proposal
        );
        const acknowledgement = {
          proposalId: editorId,
          sections: Object.fromEntries(
            [...effectiveEdits.keys()].map((key) => [key, merged.sections[key] || ''])
          ),
        };
        pendingDraftAcknowledgementRef.current = acknowledgement;
        let persisted = false;
        let confirmed: Proposal | undefined;
        try {
          persisted = await saveProposals(next, { suppressSyncError: true });
          if (persisted) {
            confirmed = ensureProposalStore().find((proposal) => proposal.id === editorId);
            if (confirmed) {
              registerCanonicalSectionConflicts(confirmed);
            }
          }
        } finally {
          if (pendingDraftAcknowledgementRef.current === acknowledgement) {
            pendingDraftAcknowledgementRef.current = null;
          }
        }
        if (!persisted) {
          await reconcileWithRemote();
          return false;
        }
        clearPersistedSectionEdits(effectiveEdits);
        if (confirmed) {
          retainRevisionWorkingCopyFor(confirmed, editorSectionsRef.current, true);
        }
        reload();
        return true;
      }).catch(() => false);
      draftPersistRef.current = operation;
      void operation.then((persisted) => {
        if (!persisted && draftPersistRef.current === operation) {
          toast('⚠️ Draft not saved. Your edits are still here — try again.', true);
        }
      });
      void operation.finally(() => {
        if (draftPersistRef.current === operation) draftPersistRef.current = null;
      });
      return operation;
    },
    [
      clearPersistedSectionEdits,
      confirmSectionConflictOverwrite,
      editingId,
      reconcileWithRemote,
      registerCanonicalSectionConflicts,
      retainRevisionWorkingCopyFor,
      reload,
      toast,
    ]
  );

  async function backToList() {
    if (submittingRef.current || leavingEditorRef.current) return;
    if (
      editing?.status === 'Reject & Revise' &&
      editedSectionRevisions.current.size > 0 &&
      !confirm('Discard your revision changes? They have not been submitted.')
    ) {
      return;
    }
    leavingEditorRef.current = true;
    setLeavingEditor(true);
    try {
      if (editingId) {
        do {
          const persisted = await persist();
          if (!persisted) return;
        } while (
          editedSectionRevisions.current.size > 0 &&
          ensureProposalStore().some((proposal) =>
            proposal.id === editingId && proposal.status === 'Draft'
          )
        );
      }
      clearSectionEdits();
      clearSectionConflicts();
      if (editing && canEditProposal(editing.status)) {
        clearProposalRevisionWorkingCopy(
          window.sessionStorage,
          currentUserId() || currentUser(),
          editing.id,
          workingCopyWriterId()
        );
      }
      editorProposalIdRef.current = null;
      setEditingId(null);
      suggestionRequestRef.current += 1;
      setSuggestion(null);
      reload();
    } finally {
      leavingEditorRef.current = false;
      setLeavingEditor(false);
    }
  }

  function switchSection(next: string) {
    setSection(next);
    suggestionRequestRef.current += 1;
    setGenerating(false);
    setSuggestion(null);
  }

  async function createFromOpportunity(oppId: string) {
    if (listSavingRef.current) return;
    const o = OPPORTUNITIES.find((x) => x.oppId === oppId);
    if (!o) return;
    const id = genId('PROP');
    const actorId = currentUserId() || profileIdForName(me);
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
      submittedById: actorId,
      owner: me,
      ownerId: actorId,
      generatedDate: new Date().toISOString().slice(0, 10),
      submittedDate: '',
      status: 'Draft',
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
    listSavingRef.current = true;
    setListSaving(true);
    try {
      await runProposalDataTransaction(async () => {
        const next = [...ensureProposalStore(), created];
        const persisted = await saveProposals(next);
        if (!persisted) {
          await reconcileWithRemote();
          return;
        }
        const canonical = ensureProposalStore().find((proposal) => proposal.id === id) || created;
        reload();
        setNewOpen(false);
        toast('📝 New proposal draft created — review and submit when ready');
        editorProposalIdRef.current = canonical.id;
        setEditingId(canonical.id);
        const canonicalSections = { ...canonical.sections };
        editorSectionsRef.current = canonicalSections;
        editorCanonicalSectionsRef.current = canonicalSections;
        editorCanonicalUpdatedAtRef.current = canonical.updatedAt;
        setSections(canonicalSections);
        clearSectionEdits();
        clearSectionConflicts();
        setSection('executive');
      });
    } finally {
      listSavingRef.current = false;
      setListSaving(false);
    }
  }

  /* ── SUBMIT / RESUBMIT ─────────────────────────────────── */
  async function submitForApproval() {
    if (
      !editing || !canEditProposal(editing.status) ||
      submittingRef.current || leavingEditorRef.current
    ) return;
    submittingRef.current = true;
    setSubmitting(true);
    const pendingDraftSave = draftPersistRef.current;

    try {
      // Reserve submission before awaiting an autosave so a remounted editor
      // cannot slip between that save and this status transition.
      await runProposalDataTransaction(async () => {
        if (pendingDraftSave && !(await pendingDraftSave)) return;
        const submittedSections = { ...editorSectionsRef.current };

        const currentStore = ensureProposalStore();
        const currentEditing = currentStore.find((proposal) => proposal.id === editing.id);
        if (!currentEditing || !canEditProposal(currentEditing.status)) {
          await reconcileWithRemote();
          toast('⚠️ This proposal changed elsewhere. Review the latest version and try again.', true);
          return;
        }
        registerCanonicalSectionConflicts(currentEditing);
        if (!confirmSectionConflictOverwrite()) return;
        const today = todayUK();
        const merged = mergeEditedProposalSections(
          currentEditing.sections,
          submittedSections,
          editedSectionRevisions.current.keys()
        ).sections;

        if (currentEditing.status === 'Reject & Revise') {
        /* Resubmit: the rejected version becomes Superseded (kept for the audit
           trail) and a NEW version of the same case goes back for review
           (Doc §4.9). Supabase persists this pair through one atomic RPC. */
        const newVersion: Proposal = {
          ...currentEditing,
          id: genId('PROP'),
          version: (currentEditing.version || 1) + 1,
          status: 'Pending Review',
          generatedDate: new Date().toISOString().slice(0, 10),
          submittedDate: today,
          lastUpdated: today,
          reviewer: '',
          reviewerId: undefined,
          reviewedDate: '',
          reviewNote: '',
          rejectionReason: '',
          outcome: undefined,
          sections: merged as Proposal['sections'],
        };
        const next = currentStore.map((p) =>
          p.id === currentEditing.id
            ? { ...p, status: 'Superseded' as ProposalStatus, lastUpdated: today }
            : p
        );
        next.push(newVersion);
        const persisted = await saveProposals(next);
        if (!persisted) {
          await reconcileWithRemote();
          return;
        }
        const canonical = ensureProposalStore().find((proposal) => proposal.id === newVersion.id)
          || newVersion;
        clearSectionEdits();
        clearSectionConflicts();
        clearProposalRevisionWorkingCopy(
          window.sessionStorage,
          currentUserId() || currentUser(),
          currentEditing.id,
          workingCopyWriterId()
        );
        reload();
        editorProposalIdRef.current = canonical.id;
        setEditingId(canonical.id);
        const canonicalSections = { ...canonical.sections };
        editorSectionsRef.current = canonicalSections;
        editorCanonicalSectionsRef.current = canonicalSections;
        editorCanonicalUpdatedAtRef.current = canonical.updatedAt;
        setSections(canonicalSections);
        toast(`📤 Resubmitted (v${canonical.version}) for review`);
          return;
        }

        // First submit of a Draft: Draft → Pending Review.
        const next = currentStore.map((p) =>
          p.id === currentEditing.id
            ? {
                ...p,
                status: 'Pending Review' as ProposalStatus,
                submittedDate: today,
                lastUpdated: today,
                sections: merged as Proposal['sections'],
              }
            : p
        );
        const persisted = await saveProposals(next);
        if (!persisted) {
          await reconcileWithRemote();
          return;
        }
        const canonical = ensureProposalStore().find((proposal) => proposal.id === currentEditing.id)
          || next.find((proposal) => proposal.id === currentEditing.id)
          || currentEditing;
        clearSectionEdits();
        clearSectionConflicts();
        clearProposalRevisionWorkingCopy(
          window.sessionStorage,
          currentUserId() || currentUser(),
          currentEditing.id,
          workingCopyWriterId()
        );
        reload();
        const canonicalSections = { ...canonical.sections };
        editorSectionsRef.current = canonicalSections;
        editorCanonicalSectionsRef.current = canonicalSections;
        editorCanonicalUpdatedAtRef.current = canonical.updatedAt;
        setSections(canonicalSections);
        toast('📤 Sent to Admin for review');
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function generateAIContent() {
    if (!editing || !canEditProposal(editing.status) || submittingRef.current) return;
    const request = ++suggestionRequestRef.current;
    setGenerating(true);
    setSuggestion('Generating…');
    const label = SECTION_LABELS[section] || section;
    const system =
      'You are a professional proposal writer for Ramssol Group, a Malaysian technology solutions company. Write compelling, specific proposal content. Be concise and professional.';
    const msg = `Write the "${label}" section of a proposal for: ${dealTitle(editing)}. Keep it under 150 words, professional and persuasive.`;
    const text = await callClaude([{ role: 'user', content: msg }], system);
    if (suggestionRequestRef.current !== request) return;
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
    const statusAllowsEdit = canEditProposal(editing.status);
    const editorBusy = submitting || leavingEditor;
    const canEdit = statusAllowsEdit && !editorBusy;
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
        <button className="back-btn" disabled={editorBusy} onClick={backToList}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to My Proposals
        </button>

        <div className="page-header">
          <div className="page-title">Proposal Generator</div>
          <div className="editor-actions">
            <button className="btn-secondary" disabled={editorBusy} onClick={() => setPreviewOpen(true)}>
              Preview
            </button>
            <button
              className="btn-secondary"
              disabled={submitState.disabled || editorBusy}
              style={{
                opacity: submitState.disabled || editorBusy ? 0.4 : 1,
                cursor: submitState.disabled || editorBusy ? 'not-allowed' : 'pointer',
              }}
              onClick={submitForApproval}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M22 2L11 13" />
                <path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
              <span>{submitting ? 'Submitting…' : submitState.label}</span>
            </button>
            <button className="btn-primary" disabled={editorBusy} onClick={exportProposal}>
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
        {sectionConflictKeys.length > 0 && (
          <div className="rejection-banner revise" role="alert">
            ⚠ This draft changed elsewhere in sections you are editing:{' '}
            {sectionConflictKeys.map((key) => SECTION_LABELS[key] || key).join(', ')}.
            {' '}Your text is preserved; the next save will ask before replacing those newer changes.
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
                  disabled={editorBusy}
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
                    {submitting
                      ? 'Submission in progress — editing is temporarily paused.'
                      : 'This version is locked because it has been submitted.'}
                  </p>
                )}
                <textarea
                  className="editor-textarea"
                  rows={14}
                  value={sections[section] || ''}
                  readOnly={!canEdit}
                  aria-readonly={!canEdit}
                  aria-describedby={!canEdit ? 'proposal-editor-lock' : undefined}
                  onChange={(e) => {
                    const next = {
                      ...editorSectionsRef.current,
                      [section]: e.target.value,
                    };
                    markSectionEdited(section, e.target.value);
                    editorSectionsRef.current = next;
                    setSections(next);
                    retainRevisionWorkingCopy(next);
                  }}
                  onBlur={canEdit ? () => void persist() : undefined}
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
                          const next = {
                            ...editorSectionsRef.current,
                            [section]: suggestion,
                          };
                          markSectionEdited(section, suggestion);
                          editorSectionsRef.current = next;
                          setSections(next);
                          retainRevisionWorkingCopy(next);
                          void persist();
                          setSuggestion(null);
                        }}
                      >
                        Use This
                      </button>
                      <button className="discard-btn" disabled={editorBusy} onClick={() => setSuggestion(null)}>
                        Discard
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="word-count">
                Words: {wordCount} · {editing.status === 'Reject & Revise'
                  ? 'Changes are kept in this tab until you resubmit'
                  : submitting ? 'Submitting…' : canEdit ? 'Draft autosave enabled' : 'Read only'}
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
                  disabled={editorBusy}
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
        <button className="btn-primary" disabled={listSaving} onClick={() => setNewOpen(true)}>
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
          <option value="Reject & Close">Rejected (Closed)</option>
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
                const closed = p.status === 'Reject & Close';
                const reviewedRejection = rejected || closed;
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
                      {reviewedRejection ? (
                        <>
                          <div style={{ color: closed ? 'var(--red-700)' : '#FB923C', fontWeight: 500 }}>
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
                          disabled={listSaving}
                          onClick={() => openEditor(p.id)}
                        >
                          {rejected ? 'Edit & Resubmit' : p.status === 'Draft' ? 'Edit' : 'View'}
                        </button>
                        {caseVersionCount(p.caseId) > 1 && (
                          <button className="row-btn ghost" disabled={listSaving} onClick={() => setHistoryCase(p.caseId)}>
                            History
                          </button>
                        )}
                        {p.status === 'Draft' && (
                          <button className="row-btn danger" disabled={listSaving} onClick={() => deleteProposal(p.id)}>
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
        onClose={listSaving ? () => undefined : () => setNewOpen(false)}
        title="New Proposal"
        sub="Pick an opportunity to create an account-specific starter draft. Use Generate with AI on any section you want to expand."
        actions={
          <button className="btn-secondary" disabled={listSaving} onClick={() => setNewOpen(false)}>
            Cancel
          </button>
        }
      >
        <div className="opp-pick">
          {oppPool.map((o) => (
            <button
              className="opp-item"
              key={o.oppId}
              disabled={listSaving}
              onClick={() => createFromOpportunity(o.oppId)}
            >
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
