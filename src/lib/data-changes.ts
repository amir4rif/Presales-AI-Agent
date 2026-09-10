import type { DataCollection } from './integrations';

export type DataChangeOptions = {
  /**
   * Proposal and prospect deletes are destructive and must be explicitly
   * tied to the user's confirmed delete action.
   */
  proposalDeleteIds?: readonly string[];
  /** Prospect deletion is likewise allowed only from its explicit confirmed action. */
  prospectDeleteIds?: readonly number[];
  /**
   * Background editors can coalesce queued failures and present one final
   * outcome themselves. Canonical rollback still happens in every case.
   */
  suppressSyncError?: boolean;
};

function itemRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function itemKey(collection: DataCollection, value: unknown): string {
  const item = itemRecord(value);
  if (!item) return '';
  if (collection === 'proposals' || collection === 'prospects') return String(item.id || '');
  if (collection === 'team') return String(item.id || item.email || '');
  if (item.id) return String(item.id);
  if (collection === 'deals') return JSON.stringify([item.rep, item.account]);
  return JSON.stringify([item.rep, item.account, item.closeDate]);
}

/** Preserve proposal rows omitted by a stale full-store client snapshot. */
export function mergeProposalSnapshot(
  previous: unknown[],
  next: unknown[],
  explicitDeleteIds: readonly string[] = []
) {
  const nextIds = new Set(next.map((item) => itemKey('proposals', item)).filter(Boolean));
  const deletedIds = new Set(explicitDeleteIds);
  const preserved = previous.filter((item) => {
    const id = itemKey('proposals', item);
    return id && !nextIds.has(id) && !deletedIds.has(id);
  });
  return [...next, ...preserved];
}

export function changesBetween(
  collection: DataCollection,
  previous: unknown[],
  next: unknown[],
  options: DataChangeOptions = {}
) {
  const before = new Map(previous.map((item) => [itemKey(collection, item), item]));
  const after = new Map(next.map((item) => [itemKey(collection, item), item]));
  const upserts = next.filter((item) => {
    const old = before.get(itemKey(collection, item));
    return !old || JSON.stringify(old) !== JSON.stringify(item);
  });

  // A full collection array can be stale while another browser tab creates a
  // row. Proposal and prospect deletion therefore require the exact ID from
  // the confirmed Delete action; ordinary updates never infer deletes.
  const allowedDeletes = collection === 'proposals'
    ? new Set((options.proposalDeleteIds || []).map(String))
    : collection === 'prospects'
      ? new Set((options.prospectDeleteIds || []).map(String))
      : null;
  const deletes = previous.filter((item) => {
    const key = itemKey(collection, item);
    return !after.has(key) && (!allowedDeletes || allowedDeletes.has(key));
  });

  return { upserts, deletes };
}
