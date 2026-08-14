import { NextResponse } from 'next/server';
import { isDataCollection } from '@/lib/integrations';
import { getLarkStatus } from '@/lib/server/config';
import { replaceDataCollection } from '@/lib/server/data-store';
import { LarkApiError } from '@/lib/server/lark';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ collection: string }> }
) {
  const { collection } = await context.params;
  if (!isDataCollection(collection)) return json({ error: 'Unknown data collection.' }, 404);

  const lark = getLarkStatus();
  if (lark.dataSource !== 'lark') {
    return json({ error: 'Remote persistence is disabled while DATA_SOURCE=seed.' }, 409);
  }
  if (!lark.ready) {
    return json({ error: 'Lark mode is selected but its server configuration is incomplete.' }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400);
  }
  if (!body || typeof body !== 'object' || !Array.isArray((body as { items?: unknown }).items)) {
    return json({ error: '`items` must be an array.' }, 400);
  }

  try {
    const result = await replaceDataCollection(
      collection,
      (body as { items: unknown[] }).items
    );
    return json({ collection, ...result });
  } catch (error) {
    console.error(`[api/data/${collection}] persistence failed`, {
      name: error instanceof Error ? error.name : 'UnknownError',
      code: error instanceof LarkApiError ? error.code : undefined,
    });
    const badInput = error instanceof Error && !(
      error instanceof LarkApiError
    );
    return json(
      { error: badInput ? error.message : `Could not persist ${collection} to Lark Base.` },
      badInput ? 400 : 502
    );
  }
}
