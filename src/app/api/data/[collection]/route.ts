import { NextResponse } from 'next/server';
import { isDataCollection } from '@/lib/integrations';
import { requireApiSession } from '@/lib/server/api-auth';
import { getSupabaseStatus } from '@/lib/server/config';
import {
  AuthorizationError,
  SupabaseDataError,
  writeSupabaseChanges,
} from '@/lib/server/supabase-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CHANGES = 250;

const PROPOSAL_WORKFLOW_MESSAGES = [
  'A proposal can only be created as your own draft or pending version.',
  'Proposal ownership cannot be changed.',
  'Only the proposal owner can edit or submit a draft.',
  'Submitted proposal versions are immutable. Create a new version instead.',
  'Only the proposal owner can resubmit this version.',
  'Only the current Reject & Revise version can be resubmitted. Refresh My Proposals and try again.',
  'New proposal versions must be created by resubmitting the current rejected version.',
  'A rejected proposal can only be superseded by the atomic resubmit operation.',
  'A proposal can only be superseded by the atomic resubmit operation.',
  'Proposal ID, case, and version identity cannot be changed.',
  'This proposal changed elsewhere. Refresh the latest data and try again.',
  'Only current draft proposals can be deleted. Refresh the latest data and try again.',
  'A proposal request must contain exactly one logical change.',
  'The signed-in reviewer has no active application profile.',
  'The signed-in proposal owner has no active application profile.',
  'Proposal audit metadata cannot be changed.',
  'Proposal submission time can only be set by submitting a draft.',
  'Reviewer audit fields can only be set when a pending proposal is decided.',
  'Proposal outcomes can only be tracked on approved versions.',
  'Level 1 users cannot change reviewer-controlled proposal fields.',
  'This proposal status transition is not permitted.',
];

function proposalWorkflowMessage(error: SupabaseDataError) {
  const knownMessage = PROPOSAL_WORKFLOW_MESSAGES.find((message) =>
    error.message.endsWith(message)
  );
  if (knownMessage) return knownMessage;
  if (process.env.NODE_ENV === 'development') {
    return error.message.replace(/^[^:]+:\s*/, '');
  }
  return 'You do not have permission to make this proposal change.';
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
export async function PUT(
  request: Request,
  context: { params: Promise<{ collection: string }> }
) {
  const { collection } = await context.params;
  if (!isDataCollection(collection)) return json({ error: 'Unknown data collection.' }, 404);

  const status = getSupabaseStatus();
  if (status.dataSource !== 'supabase') {
    return json({ error: 'Remote persistence is disabled while DATA_SOURCE=seed.' }, 409);
  }
  if (!status.configured) {
    return json({ error: 'Supabase mode is selected but its public configuration is incomplete.' }, 503);
  }

  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400);
  }
  const candidate = body as { upserts?: unknown; deletes?: unknown };
  if (!body || typeof body !== 'object' ||
      !Array.isArray(candidate.upserts) || !Array.isArray(candidate.deletes)) {
    return json({ error: '`upserts` and `deletes` must both be arrays.' }, 400);
  }
  if (candidate.upserts.length + candidate.deletes.length > MAX_CHANGES) {
    return json({ error: `A request can change at most ${MAX_CHANGES} records.` }, 413);
  }

  try {
    if (!auth.supabase) return json({ error: 'Supabase mode is not available.' }, 503);
    const result = await writeSupabaseChanges(auth.supabase, auth.userId, collection, {
      upserts: candidate.upserts,
      deletes: candidate.deletes,
    });
    return json({ collection, ...result });
  } catch (error) {
    console.error(`[api/data/${collection}] Supabase persistence failed`, {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: error instanceof SupabaseDataError ? error.code : undefined,
      details: error instanceof SupabaseDataError ? error.details : undefined,
      hint: error instanceof SupabaseDataError ? error.hint : undefined,
    });
    if (error instanceof AuthorizationError) {
      return json({ error: error.message }, 403);
    }
    if (error instanceof SupabaseDataError && error.code === '42501') {
      const message = collection === 'proposals'
        ? proposalWorkflowMessage(error)
        : 'You do not have permission to make this change.';
      return json({ error: message }, 403);
    }
    return json({ error: `Could not persist ${collection} to Supabase.` }, 502);
  }
}
