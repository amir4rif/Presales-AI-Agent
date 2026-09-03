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

  const suppliedIds = rows
    .map((row) => row.id)
    .filter((id): id is string => typeof id === 'string' && Boolean(id));
  const existingIds = new Set<string>();

  if (suppliedIds.length) {
    const existing = await client.from('proposals').select('id').in('id', suppliedIds);
    fail('Could not identify existing proposals', existing.error);
    for (const row of existing.data || []) existingIds.add(row.id);
  }

  const inserts: ProposalInsert[] = [];
  const updates: Array<{ id: string; row: ProposalUpdate }> = [];
  for (const row of rows) {
    const id = row.id;
    if (typeof id !== 'string' || !existingIds.has(id)) {
      inserts.push(row);
      continue;
    }

    const update: ProposalUpdate = { ...row };
    delete update.id;
    updates.push({ id, row: update });
  }

  // Insert a replacement version before marking its predecessor Superseded.
  // If either independent PostgREST call fails, this ordering preserves the
  // previously reviewable version instead of leaving the case with none.
  for (const group of groupByShape(inserts)) {
    const response = await client.from('proposals').insert(group);
    fail('Could not create proposals', response.error);
  }

  for (const update of updates) {
    const response = await client.from('proposals').update(update.row).eq('id', update.id);
    fail('Could not update proposal', response.error);
  }
}
