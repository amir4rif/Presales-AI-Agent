export type ProposalSections = Record<string, string>;

export type ProposalEditorRebase = {
  sections: ProposalSections;
  editedKeys: string[];
};

export function conflictingProposalSectionKeys(
  previousCanonical: ProposalSections | null | undefined,
  nextCanonical: ProposalSections | null | undefined,
  editedKeys: Iterable<string>,
  acknowledgedWrite: ProposalSections | null | undefined = undefined,
  localDraft: ProposalSections | null | undefined = undefined
) {
  const previous = previousCanonical || {};
  const next = nextCanonical || {};
  const acknowledged = acknowledgedWrite || {};
  const local = localDraft || {};

  return [...new Set(editedKeys)].filter((key) => {
    const before = previous[key] || '';
    const after = next[key] || '';
    if (before === after) return false;
    // A concurrent edit that arrived at the exact same value is already
    // reconciled; saving this draft cannot overwrite anything for that key.
    if (Object.prototype.hasOwnProperty.call(local, key) && (local[key] || '') === after) {
      return false;
    }
    // A post-write hydration that contains the exact value this editor just
    // persisted is our acknowledgement, not a competing same-field edit.
    return !Object.prototype.hasOwnProperty.call(acknowledged, key) ||
      (acknowledged[key] || '') !== after;
  });
}

export function remainingProposalSectionEditRevisions(
  current: ReadonlyMap<string, number>,
  persisted: ReadonlyMap<string, number>
) {
  const remaining = new Map(current);
  for (const [key, revision] of persisted) {
    if (remaining.get(key) === revision) remaining.delete(key);
  }
  return remaining;
}

export function currentProposalSectionEditRevisions(
  current: ReadonlyMap<string, number>,
  captured: ReadonlyMap<string, number>
) {
  return new Map(
    [...captured].filter(([key, revision]) => current.get(key) === revision)
  );
}

export function enqueueProposalDraftPersist(
  previous: Promise<boolean> | null,
  persist: () => Promise<boolean>
) {
  return (previous || Promise.resolve(true))
    .catch(() => false)
    .then((previousPersisted) => previousPersisted ? persist() : false)
    .catch(() => false);
}

/**
 * Merge only fields the editor actually changed. Missing sections are treated
 * as empty for display, but are not materialized into storage just because the
 * proposal was opened.
 */
export function mergeEditedProposalSections(
  stored: ProposalSections | null | undefined,
  draft: ProposalSections,
  editedKeys: Iterable<string>
) {
  const current = stored || {};
  const next = { ...current };
  let changed = false;

  for (const key of new Set(editedKeys)) {
    const value = draft[key] || '';
    if ((current[key] || '') === value) continue;
    next[key] = value;
    changed = true;
  }

  return { changed, sections: changed ? next : current };
}

/**
 * Bring an open editor up to date with its canonical proposal without
 * overwriting fields the user is still editing. A different proposal or a
 * newly locked version is always replaced wholesale so stale working-copy
 * content cannot remain visible.
 */
export function rebaseProposalEditorSections(
  canonical: ProposalSections | null | undefined,
  draft: ProposalSections | null | undefined,
  editedKeys: Iterable<string>,
  options: { sameProposal: boolean; editable: boolean }
): ProposalEditorRebase {
  const canonicalSections = { ...(canonical || {}) };
  if (!options.sameProposal || !options.editable) {
    return { sections: canonicalSections, editedKeys: [] };
  }

  const localSections = draft || {};
  const preservedKeys = [...new Set(editedKeys)];
  for (const key of preservedKeys) {
    canonicalSections[key] = localSections[key] || '';
  }

  return { sections: canonicalSections, editedKeys: preservedKeys };
}
