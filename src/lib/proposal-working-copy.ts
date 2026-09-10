import { scopedStorageKey } from './user-storage.ts';

const STORAGE_BASE = 'ramssol:proposal-revision-working-copy:v2';

export type ProposalRevisionWorkingCopy = {
  writerId: string;
  canonicalUpdatedAt: string;
  canonicalSections: Record<string, string>;
  conflictKeys: string[];
  editedKeys: string[];
  sections: Record<string, string>;
};

function workingCopyKey(identity: string, proposalId: string) {
  return scopedStorageKey(`${STORAGE_BASE}:${encodeURIComponent(proposalId)}`, identity);
}

export function clearProposalRevisionWorkingCopy(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  identity: string,
  proposalId: string,
  expectedWriterId?: string
) {
  try {
    const key = workingCopyKey(identity, proposalId);
    if (expectedWriterId) {
      const raw = storage.getItem(key);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as Partial<ProposalRevisionWorkingCopy>;
      if (parsed.writerId !== expectedWriterId) return false;
    }
    storage.removeItem(key);
    return true;
  } catch {
    // Browser storage can be unavailable in hardened/private contexts.
    return false;
  }
}

export function saveProposalRevisionWorkingCopy(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  identity: string,
  proposalId: string,
  writerId: string,
  canonicalUpdatedAt: string | undefined,
  canonicalSections: Record<string, string>,
  sections: Record<string, string>,
  editedKeys: Iterable<string>,
  conflictKeys: Iterable<string> = [],
  options: { expectedWriterId?: string } = {}
) {
  const keys = [...new Set(editedKeys)];
  const storageKey = workingCopyKey(identity, proposalId);
  if (options.expectedWriterId) {
    try {
      const raw = storage.getItem(storageKey);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as Partial<ProposalRevisionWorkingCopy>;
      if (parsed.writerId !== options.expectedWriterId) return false;
    } catch {
      return false;
    }
  }
  if (!keys.length) {
    return clearProposalRevisionWorkingCopy(
      storage,
      identity,
      proposalId,
      options.expectedWriterId
    );
  }

  const workingCopy: ProposalRevisionWorkingCopy = {
    writerId,
    canonicalUpdatedAt: canonicalUpdatedAt || '',
    canonicalSections: Object.fromEntries(
      keys.map((key) => [key, canonicalSections[key] || ''])
    ),
    conflictKeys: [...new Set(conflictKeys)].filter((key) => keys.includes(key)),
    editedKeys: keys,
    sections: Object.fromEntries(keys.map((key) => [key, sections[key] || ''])),
  };
  try {
    storage.setItem(storageKey, JSON.stringify(workingCopy));
    return true;
  } catch {
    // The beforeunload guard remains the fallback when storage is unavailable.
    return false;
  }
}

export function loadProposalRevisionWorkingCopy(
  storage: Pick<Storage, 'getItem' | 'removeItem'>,
  identity: string,
  proposalId: string,
  canonicalUpdatedAt: string | undefined,
  canonicalSections: Record<string, string>,
  allowedKeys: ReadonlySet<string>
): ProposalRevisionWorkingCopy | null {
  const key = workingCopyKey(identity, proposalId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProposalRevisionWorkingCopy>;
    if (
      typeof parsed.canonicalUpdatedAt !== 'string' ||
      typeof parsed.writerId !== 'string' || !parsed.writerId ||
      !Array.isArray(parsed.editedKeys) ||
      !Array.isArray(parsed.conflictKeys) ||
      !parsed.canonicalSections || typeof parsed.canonicalSections !== 'object' ||
      !parsed.sections || typeof parsed.sections !== 'object'
    ) {
      storage.removeItem(key);
      return null;
    }

    // The client writes an optimistic snapshot before Supabase confirms it.
    // Neither matching cache text nor a row-level revision advance proves that
    // this particular section was persisted: another section can advance the
    // same row token. Keep every real baseline-to-local edit until its writer
    // explicitly confirms and clears it after the server response.
    void canonicalUpdatedAt;
    const editedKeys = [...new Set(parsed.editedKeys)].filter((sectionKey) =>
      typeof sectionKey === 'string' &&
      allowedKeys.has(sectionKey) &&
      typeof parsed.sections?.[sectionKey] === 'string' &&
      typeof parsed.canonicalSections?.[sectionKey] === 'string' &&
      (parsed.sections[sectionKey] || '') !== (parsed.canonicalSections[sectionKey] || '')
    );
    if (!editedKeys.length) {
      storage.removeItem(key);
      return null;
    }
    const conflicts = new Set(
      parsed.conflictKeys.filter((sectionKey) => editedKeys.includes(sectionKey))
    );
    // Compare per-key baselines even when timestamps match or are missing.
    // updated_at is the CAS token, while the values are the final defense
    // against malformed/legacy snapshots and effect-order races.
    for (const sectionKey of editedKeys) {
      if (
        (parsed.canonicalSections[sectionKey] || '') !== (canonicalSections[sectionKey] || '') &&
        (parsed.sections[sectionKey] || '') !== (canonicalSections[sectionKey] || '')
      ) {
        conflicts.add(sectionKey);
      }
    }
    return {
      writerId: parsed.writerId,
      canonicalUpdatedAt: parsed.canonicalUpdatedAt,
      canonicalSections: Object.fromEntries(
        editedKeys.map((sectionKey) => [
          sectionKey,
          parsed.canonicalSections?.[sectionKey] || '',
        ])
      ),
      conflictKeys: [...conflicts],
      editedKeys,
      sections: Object.fromEntries(
        editedKeys.map((sectionKey) => [sectionKey, parsed.sections?.[sectionKey] || ''])
      ),
    };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Nothing else to recover.
    }
    return null;
  }
}
