import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { DealWorkflowCommand, DealWorkflowResult } from '@/lib/data-sync';
import type { Database } from '@/lib/supabase/database.types';
import { SupabaseDataError } from '@/lib/server/supabase-data';

type Client = SupabaseClient<Database>;

function workflowResult(value: unknown): DealWorkflowResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The database returned an invalid deal-workflow result.');
  }
  const result = value as Partial<DealWorkflowResult>;
  if (
    !['closed', 'pending_approval', 'declined'].includes(result.status || '') ||
    typeof result.dealId !== 'string' ||
    !['Open', 'Won', 'Lost', 'Disqualified'].includes(result.outcome || '')
  ) {
    throw new Error('The database returned an invalid deal-workflow result.');
  }
  return result as DealWorkflowResult;
}

export async function executeSupabaseDealWorkflow(
  client: Client,
  command: DealWorkflowCommand
) {
  const response = command.action === 'close'
    ? await client.rpc('close_deal', {
        p_deal_id: command.dealId,
        p_outcome: command.outcome,
        p_reason: command.reason,
        p_source: command.source,
        p_close_date: command.closeDate,
        p_expected_updated_at: command.expectedUpdatedAt,
      })
    : await client.rpc('review_deal_disqualification', {
        p_deal_id: command.dealId,
        p_approve: command.approve,
        p_expected_updated_at: command.expectedUpdatedAt,
      });

  if (response.error) {
    throw new SupabaseDataError('Could not complete deal workflow', response.error);
  }
  return workflowResult(response.data);
}
