import { NextResponse } from 'next/server';
import type { DealWorkflowCommand } from '@/lib/data-sync';
import { requireApiSession } from '@/lib/server/api-auth';
import { getSupabaseStatus } from '@/lib/server/config';
import { executeSupabaseDealWorkflow } from '@/lib/server/deal-workflow';
import { SupabaseDataError } from '@/lib/server/supabase-data';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SAFE_MESSAGES = [
  'You must be signed in to close a deal.',
  'The signed-in closer has no active application profile.',
  'You do not have permission to close this deal.',
  'This deal changed elsewhere. Refresh the pipeline and try again.',
  'Choose Won, Lost, or Disqualified.',
  'Choose a valid loss reason.',
  'Choose a valid disqualification reason.',
  'Won deals do not take a loss or disqualification reason.',
  'This deal already has a disqualification request awaiting Level 2 review.',
  'This deal is no longer open. Refresh the pipeline and try again.',
  'You must be signed in to review a disqualification request.',
  'A Level 2 reviewer is required for this disqualification decision.',
  'This deal has no disqualification request awaiting review.',
];

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseCommand(value: unknown): DealWorkflowCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const action = text(body.action);
  const dealId = text(body.dealId);
  const expectedUpdatedAt = text(body.expectedUpdatedAt);
  if (!dealId || !expectedUpdatedAt) return null;

  if (action === 'review-disqualification' && typeof body.approve === 'boolean') {
    return { action, dealId, approve: body.approve, expectedUpdatedAt };
  }

  const outcome = text(body.outcome);
  if (
    action !== 'close' ||
    !['Won', 'Lost', 'Disqualified'].includes(outcome) ||
    !text(body.closeDate)
  ) {
    return null;
  }
  return {
    action,
    dealId,
    outcome: outcome as 'Won' | 'Lost' | 'Disqualified',
    reason: text(body.reason),
    source: text(body.source),
    closeDate: text(body.closeDate),
    expectedUpdatedAt,
  };
}

function safeWorkflowMessage(error: SupabaseDataError) {
  return SAFE_MESSAGES.find((message) => error.message.endsWith(message)) ||
    'The deal workflow could not be completed.';
}

export async function POST(request: Request) {
  const status = getSupabaseStatus();
  if (!status.configured) {
    return json({ error: 'Supabase mode is selected but its public configuration is incomplete.' }, 503);
  }

  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

  let command: DealWorkflowCommand | null = null;
  try {
    command = parseCommand(await request.json());
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400);
  }
  if (!command) return json({ error: 'The deal workflow request is incomplete.' }, 400);

  try {
    if (!auth.supabase) return json({ error: 'Supabase mode is not available.' }, 503);
    return json(await executeSupabaseDealWorkflow(auth.supabase, command));
  } catch (error) {
    console.error('[api/deals/close] Deal workflow failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown error',
      code: error instanceof SupabaseDataError ? error.code : undefined,
    });
    if (error instanceof SupabaseDataError) {
      const responseStatus = error.code === '42501'
        ? 403
        : ['40001', '55000', 'P0002', '23505'].includes(error.code || '')
          ? 409
          : error.code === '22023'
            ? 400
            : 502;
      return json({ error: safeWorkflowMessage(error) }, responseStatus);
    }
    return json({ error: 'The deal workflow could not be completed.' }, 502);
  }
}
