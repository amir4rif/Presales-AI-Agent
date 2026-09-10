import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

type Client = SupabaseClient<Database>;
type ProposalInsert = Database['public']['Tables']['proposals']['Insert'];
type ProposalUpdate = Database['public']['Tables']['proposals']['Update'];
type OperationError = {
  code?: string;
  details?: string | null;
  hint?: string | null;
  message: string;
};
type Fail = (context: string, error: OperationError | null) => void;

type ProposalRow = Database['public']['Tables']['proposals']['Row'];
type ExistingProposal = Pick<ProposalRow, 'id' | 'status' | 'updated_at'>;
type ExistingUpdate = {
  id: string;
  row: ProposalUpdate;
  existing: ExistingProposal;
};
export type DraftProposalDelete = Pick<ProposalRow, 'id' | 'updated_at'>;

const STALE_PROPOSAL_MESSAGE =
  'This proposal changed elsewhere. Refresh the latest data and try again.';
const DRAFT_DELETE_MESSAGE =
  'Only current draft proposals can be deleted. Refresh the latest data and try again.';
const LOGICAL_MUTATION_MESSAGE =
  'A proposal request must contain exactly one logical change.';

function workflowError(message: string): OperationError {
  return { code: '42501', message };
}

function copyDefined<Key extends keyof ProposalUpdate>(
  target: ProposalUpdate,
  source: ProposalUpdate,
  key: Key
) {
  if (source[key] !== undefined) target[key] = source[key];
}

/**
 * Build the smallest update allowed by the proposal lifecycle. In particular,
 * never replay browser copies of server timestamps or submitted content: the
 * wire model intentionally contains a full snapshot, while an UPDATE must not.
 */
function mutableProposalUpdate(row: ProposalUpdate, actualStatus: string): ProposalUpdate {
  const update: ProposalUpdate = {};
  const desiredStatus = typeof row.status === 'string' ? row.status : actualStatus;

  // Status is safe to repeat and gives an otherwise-empty legitimate update a
  // write target; the query separately compares against the pre-read status.
  update.status = desiredStatus;

  if (actualStatus === 'Draft') {
    // Draft content can be edited before submission. Identity, ownership,
    // generation dates, and server-managed timestamps remain untouched.
    copyDefined(update, row, 'opportunity_id');
    copyDefined(update, row, 'company');
    copyDefined(update, row, 'deal');
    copyDefined(update, row, 'value');
    copyDefined(update, row, 'sections');

    // submitted_at is assigned only on the Draft -> Pending Review event. It
    // must not be round-tripped from the formatted display date on draft saves.
    if (desiredStatus === 'Pending Review') {
      copyDefined(update, row, 'submitted_at');
    }
    return update;
  }

  if (actualStatus === 'Pending Review' && desiredStatus !== actualStatus) {
    // These fields are created by the review decision itself. No identity,
    // proposal content, submitted_at, generated_on, created_at, or updated_at
    // is copied from the browser's submitted-version snapshot.
    copyDefined(update, row, 'reviewer_id');
    copyDefined(update, row, 'reviewer');
    copyDefined(update, row, 'reviewed_at');
    copyDefined(update, row, 'rejection_reason');
    copyDefined(update, row, 'review_note');
    copyDefined(update, row, 'outcome');
  } else if (actualStatus === 'Approved' && desiredStatus === actualStatus) {
    // Outcome tracking is the only supported same-status edit after approval.
    copyDefined(update, row, 'outcome');
  }

  return update;
}

function serverTimestampFreeInsert(row: ProposalInsert): ProposalInsert {
  const insert = { ...row };
  // A replacement commonly inherits its predecessor's client snapshot. New
  // rows must always receive fresh timestamps from PostgreSQL.
  delete insert.created_at;
  delete insert.updated_at;
  return insert;
}

function isPendingReplacement(row: ProposalInsert) {
  return typeof row.id === 'string' &&
    typeof row.case_id === 'string' &&
    typeof row.version === 'number' &&
    row.status === 'Pending Review';
}

function predecessorIndexFor(
  replacement: ProposalInsert,
  updates: ExistingUpdate[],
  consumedUpdates: Set<number>
) {
  return updates.findIndex(({ row }, index) =>
    !consumedUpdates.has(index) &&
    row.status === 'Superseded' &&
    row.case_id === replacement.case_id &&
    row.version === Number(replacement.version) - 1
  );
}

function groupByShape<Row extends Record<string, unknown>>(rows: Row[]): Row[][] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const shape = Object.keys(row).sort().join(' ');
    const group = groups.get(shape);
    if (group) group.push(row);
    else groups.set(shape, [row]);
  }
  return Array.from(groups.values());
}

/**
 * Proposal IDs are generated in the browser for both new and existing rows,
 * so an ID's presence cannot select INSERT versus UPDATE. Look up the IDs and
 * use a filtered UPDATE for existing rows; an upsert would run PostgreSQL's
 * BEFORE INSERT workflow branch even when ON CONFLICT later chose UPDATE.
 */
export async function writeProposalRows(
  client: Client,
  rows: ProposalInsert[],
  fail: Fail
) {
  if (!rows.length) return;
  if (rows.length > 2) {
    fail('Could not save proposals', workflowError(LOGICAL_MUTATION_MESSAGE));
    return;
  }

  const suppliedIds = rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string' && Boolean(id));
  const existingById = new Map<string, ExistingProposal>();

  if (suppliedIds.length) {
    const existing = await client
      .from('proposals')
      .select('id,status,updated_at')
      .in('id', suppliedIds);
    fail('Could not identify existing proposals', existing.error);
    for (const row of existing.data || []) existingById.set(row.id, row);
  }

  const inserts: ProposalInsert[] = [];
  const updates: ExistingUpdate[] = [];
  for (const row of rows) {
    const id = row.id;
    if (typeof id !== 'string') {
      inserts.push(serverTimestampFreeInsert(row));
      continue;
    }
    const existing = existingById.get(id);
    if (!existing) {
      inserts.push(serverTimestampFreeInsert(row));
      continue;
    }

    const update: ProposalUpdate = { ...row };
    delete update.id;
    updates.push({ id, row: update, existing });
  }

  // A resubmit pair must be one database transaction. The RPC locks and
  // validates the rejected predecessor, supersedes it, and creates the next
  // version. It also prevents two browser tabs from branching off stale v1.
  const consumedInserts = new Set<number>();
  const consumedUpdates = new Set<number>();
  for (const [insertIndex, replacement] of inserts.entries()) {
    if (!isPendingReplacement(replacement)) continue;
    const updateIndex = predecessorIndexFor(replacement, updates, consumedUpdates);
    if (updateIndex < 0) continue;

    const predecessor = updates[updateIndex];
    const expectedUpdatedAt = predecessor.row.updated_at;
    if (typeof expectedUpdatedAt !== 'string' ||
        expectedUpdatedAt !== predecessor.existing.updated_at) {
      fail('Could not resubmit proposal', workflowError(STALE_PROPOSAL_MESSAGE));
      return;
    }
    const response = await client.rpc('resubmit_proposal', {
      p_predecessor_id: predecessor.id,
      p_new_id: replacement.id!,
      p_sections: replacement.sections ?? {},
      p_expected_updated_at: expectedUpdatedAt,
    });
    fail('Could not resubmit proposal', response.error);
    consumedInserts.add(insertIndex);
    consumedUpdates.add(updateIndex);
  }

  const ordinaryInserts = inserts.filter((_, index) => !consumedInserts.has(index));
  const ordinaryUpdates = updates.filter((_, index) => !consumedUpdates.has(index));

  // Every API request is one logical mutation. Two rows are allowed only for
  // the predecessor/replacement pair consumed by the transactional RPC.
  if (rows.length === 2 &&
      (consumedInserts.size !== 1 || consumedUpdates.size !== 1 ||
       ordinaryInserts.length || ordinaryUpdates.length)) {
    fail('Could not save proposals', workflowError(LOGICAL_MUTATION_MESSAGE));
    return;
  }

  for (const group of groupByShape(ordinaryInserts)) {
    const response = await client.from('proposals').insert(group);
    fail('Could not create proposals', response.error);
  }

  for (const update of ordinaryUpdates) {
    const expectedUpdatedAt = update.row.updated_at;
    if (typeof expectedUpdatedAt !== 'string' ||
        expectedUpdatedAt !== update.existing.updated_at) {
      fail('Could not update proposal', workflowError(STALE_PROPOSAL_MESSAGE));
      continue;
    }

    const payload = mutableProposalUpdate(update.row, update.existing.status);
    const response = await client
      .from('proposals')
      .update(payload)
      .eq('id', update.id)
      .eq('status', update.existing.status)
      .eq('updated_at', expectedUpdatedAt)
      .select('id');
    fail('Could not update proposal', response.error);
    if (response.error) continue;
    if (response.data?.length !== 1 || response.data[0]?.id !== update.id) {
      fail('Could not update proposal', workflowError(STALE_PROPOSAL_MESSAGE));
    }
  }
}

/** Delete only visible Draft rows and verify that RLS/status filters did not
 * silently turn any requested delete into a zero-row success. */
export async function deleteDraftProposalRows(
  client: Client,
  rows: DraftProposalDelete[],
  fail: Fail
) {
  if (!rows.length) return;
  if (rows.length !== 1 || !rows[0].id || !rows[0].updated_at) {
    fail('Could not delete proposals', workflowError(DRAFT_DELETE_MESSAGE));
    return;
  }
  const [row] = rows;

  const response = await client
    .from('proposals')
    .delete()
    .eq('id', row.id)
    .eq('status', 'Draft')
    .eq('updated_at', row.updated_at)
    .select('id');
  fail('Could not delete proposals', response.error);
  if (response.error) return;

  if (response.data?.length !== 1 || response.data[0]?.id !== row.id) {
    fail('Could not delete proposals', workflowError(DRAFT_DELETE_MESSAGE));
  }
}
