import { NextResponse } from 'next/server';
import { getLarkStatus } from '@/lib/server/config';
import { readAllDataCollections } from '@/lib/server/data-store';
import { LarkApiError } from '@/lib/server/lark';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/**
 * GET /api/data returns the active source without contacting Lark.
 * GET /api/data?all=1 hydrates every shared collection when Lark mode is on.
 */
export async function GET(request: Request) {
  const lark = getLarkStatus();
  const wantsData = new URL(request.url).searchParams.get('all') === '1';
  const status = {
    source: lark.dataSource,
    ready: lark.dataSource === 'seed' || lark.ready,
    missing: lark.dataSource === 'lark' ? lark.missing : [],
  };

  if (!wantsData) return json(status);
  if (lark.dataSource !== 'lark') {
    return json({ error: 'Remote hydration is disabled while DATA_SOURCE=seed.' }, 409);
  }
  if (!lark.ready) {
    return json({ error: 'Lark mode is selected but its server configuration is incomplete.', ...status }, 503);
  }

  try {
    const data = await readAllDataCollections();
    return json({ source: 'lark', ...data });
  } catch (error) {
    console.error('[api/data] hydration failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      code: error instanceof LarkApiError ? error.code : undefined,
    });
    return json({ error: 'Could not hydrate the shared data layer from Lark Base.' }, 502);
  }
}
