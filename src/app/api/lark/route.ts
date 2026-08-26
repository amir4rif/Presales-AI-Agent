import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/server/api-auth';
import { getLarkStatus } from '@/lib/server/config';
import {
  createLarkRecords,
  deleteLarkRecords,
  LarkApiError,
  listAllLarkRecords,
  updateLarkRecords,
} from '@/lib/server/lark';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function serverError(error: unknown, operation: string) {
  const code = error instanceof LarkApiError ? error.code : undefined;
  console.error(`[api/lark] ${operation} failed`, {
    name: error instanceof Error ? error.name : 'UnknownError',
    code,
  });
  return json({ error: `Could not ${operation} Lark Base records.`, code }, 502);
}

async function bodyOf(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * GET /api/lark returns configuration readiness without making a Lark call.
 * GET /api/lark?records=1 is the explicit diagnostic/read operation.
 */
export async function GET(request: Request) {
  const wantsRecords = new URL(request.url).searchParams.get('records') === '1';
  const auth = await requireApiSession(wantsRecords ? 3 : 1);
  if (!auth.ok) return auth.response;

  const status = getLarkStatus();
  if (!wantsRecords) return json(status);
  if (!status.ready) return json({ error: 'Lark Base is not configured on the server yet.' }, 503);

  try {
    const records = await listAllLarkRecords();
    return json({ records, count: records.length });
  } catch (error) {
    return serverError(error, 'read');
  }
}

/** POST /api/lark — create up to 500 raw Bitable records. */
export async function POST(request: Request) {
  const auth = await requireApiSession(3);
  if (!auth.ok) return auth.response;

  if (!getLarkStatus().ready) {
    return json({ error: 'Lark Base is not configured on the server yet.' }, 503);
  }
  const body = await bodyOf(request);
  const records = isObject(body) && Array.isArray(body.records) ? body.records : null;
  if (!records?.length || records.length > 500) {
    return json({ error: '`records` must contain between 1 and 500 items.' }, 400);
  }
  if (!records.every((record) => isObject(record) && isObject(record.fields))) {
    return json({ error: 'Each record must contain a `fields` object.' }, 400);
  }

  try {
    const created = await createLarkRecords(
      records as { fields: Record<string, unknown> }[]
    );
    return json({ created }, 201);
  } catch (error) {
    return serverError(error, 'create');
  }
}

/** PATCH /api/lark — update up to 500 raw Bitable records. */
export async function PATCH(request: Request) {
  const auth = await requireApiSession(3);
  if (!auth.ok) return auth.response;

  if (!getLarkStatus().ready) {
    return json({ error: 'Lark Base is not configured on the server yet.' }, 503);
  }
  const body = await bodyOf(request);
  const records = isObject(body) && Array.isArray(body.records) ? body.records : null;
  if (!records?.length || records.length > 500) {
    return json({ error: '`records` must contain between 1 and 500 items.' }, 400);
  }
  if (
    !records.every(
      (record) =>
        isObject(record) && typeof record.record_id === 'string' && isObject(record.fields)
    )
  ) {
    return json({ error: 'Each record needs `record_id` and a `fields` object.' }, 400);
  }

  try {
    const updated = await updateLarkRecords(
      records as { record_id: string; fields: Record<string, unknown> }[]
    );
    return json({ updated });
  } catch (error) {
    return serverError(error, 'update');
  }
}

/** DELETE /api/lark — delete up to 500 raw Bitable record IDs. */
export async function DELETE(request: Request) {
  const auth = await requireApiSession(3);
  if (!auth.ok) return auth.response;

  if (!getLarkStatus().ready) {
    return json({ error: 'Lark Base is not configured on the server yet.' }, 503);
  }
  const body = await bodyOf(request);
  const records = isObject(body) && Array.isArray(body.records) ? body.records : null;
  if (
    !records?.length ||
    records.length > 500 ||
    !records.every((recordId) => typeof recordId === 'string')
  ) {
    return json({ error: '`records` must contain between 1 and 500 record IDs.' }, 400);
  }

  try {
    const deleted = await deleteLarkRecords(records as string[]);
    return json({ deleted });
  } catch (error) {
    return serverError(error, 'delete');
  }
}
