import type { DataCollection } from './integrations';

export type DataChangeOptions = {
  /**
   * Proposal, deal, and prospect deletes are destructive and must be explicitly
   * tied to the user's confirmed delete action.
   */
  proposalDeleteIds?: readonly string[];
  /** Deal deletion is allowed only from the confirmed row action. */
  dealDeleteIds?: readonly string[];
  /** Closed-deal deletion is allowed only from its confirmed history action. */
  closedDealDeleteIds?: readonly string[];
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
  // Deal identity is always its stable ID. Account text is display data and
  // must never become an implicit relationship or mutation key.
  return String(item.id || '');
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
  // row. Proposal, deal, and prospect deletion therefore require the exact ID from
  // the confirmed Delete action; ordinary updates never infer deletes.
  const allowedDeletes = collection === 'proposals'
    ? new Set((options.proposalDeleteIds || []).map(String))
    : collection === 'deals'
      ? new Set((options.dealDeleteIds || []).map(String))
      : collection === 'closedDeals'
        ? new Set((options.closedDealDeleteIds || []).map(String))
      : collection === 'prospects'
        ? new Set((options.prospectDeleteIds || []).map(String))
        : null;
  const deletes = previous.filter((item) => {
    const key = itemKey(collection, item);
    return !after.has(key) && (!allowedDeletes || allowedDeletes.has(key));
  });

  return { upserts, deletes };
}
