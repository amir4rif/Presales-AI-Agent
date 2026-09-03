export type ProposalSections = Record<string, string>;

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
