import { NextResponse } from 'next/server';
import { isDataCollection } from '@/lib/integrations';
import { getSupabaseStatus } from '@/lib/server/config';
import { AuthorizationError, writeSupabaseChanges } from '@/lib/server/supabase-data';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CHANGES = 250;

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
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();
    const userId = typeof data?.claims?.sub === 'string' ? data.claims.sub : null;
    if (error || !userId) return json({ error: 'Authentication required.' }, 401);
    const result = await writeSupabaseChanges(supabase, userId, collection, {
      upserts: candidate.upserts,
      deletes: candidate.deletes,
    });
    return json({ collection, ...result });
  } catch (error) {
    console.error(`[api/data/${collection}] Supabase persistence failed`, {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    if (error instanceof AuthorizationError) {
      return json({ error: error.message }, 403);
    }
    return json({ error: `Could not persist ${collection} to Supabase.` }, 502);
  }
}
