import { NextResponse } from 'next/server';
import { getSupabaseStatus } from '@/lib/server/config';
import { readAllSupabaseData } from '@/lib/server/supabase-data';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
/** GET returns readiness; GET ?all=1 returns RLS-filtered shared data. */
export async function GET(request: Request) {
  const status = getSupabaseStatus();
  const wantsData = new URL(request.url).searchParams.get('all') === '1';
  if (!wantsData) return json(status);
  if (status.dataSource !== 'supabase') {
    return json({ error: 'Remote hydration is disabled while DATA_SOURCE=seed.' }, 409);
  }
  if (!status.configured) {
    return json({ error: 'Supabase mode is selected but its public configuration is incomplete.', ...status }, 503);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();
    const userId = typeof data?.claims?.sub === 'string' ? data.claims.sub : null;
    if (error || !userId) return json({ error: 'Authentication required.' }, 401);
    const result = await readAllSupabaseData(supabase, userId);
    return json({ source: 'supabase', ...result });
  } catch (error) {
    console.error('[api/data] Supabase hydration failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
    return json({ error: 'Could not hydrate the shared data layer from Supabase.' }, 502);
  }
}
