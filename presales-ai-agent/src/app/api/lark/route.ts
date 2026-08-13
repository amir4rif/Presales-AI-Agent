/* ═══════════════════════════════════════════════════════════
   /api/lark — the Lark Base bridge. The token lives here.

   Replaces LARK_BASE_PROXY_URL in prospects.html, which was a
   PASTE_YOUR_… placeholder pointing at a Google Apps Script, and the
   Settings page that saved the app token straight into localStorage.

   The browser calls this route; the route mints a tenant access token
   from LARK_APP_ID / LARK_APP_SECRET and talks to Bitable. No Lark
   credential is ever sent to the browser.

   lib/data.ts still reads localStorage while NEXT_PUBLIC_DATA_SOURCE
   is "seed" — flip one table at a time once the credentials land.
═══════════════════════════════════════════════════════════ */
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// open.larksuite.com for Lark, open.feishu.cn for Feishu.
const BASE = process.env.LARK_BASE_URL || 'https://open.larksuite.com';

type TokenCache = { token: string; expiresAt: number };
let cached: TokenCache | null = null;

function creds() {
  return {
    appId: process.env.LARK_APP_ID,
    appSecret: process.env.LARK_APP_SECRET,
    appToken: process.env.LARK_APP_TOKEN,
    tableId: process.env.LARK_TABLE_ID,
  };
}

function isConfigured() {
  const c = creds();
  return Boolean(c.appId && c.appSecret && c.appToken);
}

/** Tenant access token, cached until a minute before it expires. */
async function tenantToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const { appId, appSecret } = creds();
  const res = await fetch(`${BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    cache: 'no-store',
  });
  const data = await res.json();
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`Lark auth failed (code ${data.code}): ${data.msg || 'unknown'}`);
  }
  cached = {
    token: data.tenant_access_token,
    expiresAt: Date.now() + Math.max((data.expire || 7200) - 60, 60) * 1000,
  };
  return cached.token;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * GET /api/lark              → { configured, tableId }
 * GET /api/lark?records=1    → the table's records
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const { tableId } = creds();

  if (!url.searchParams.get('records')) {
    return NextResponse.json({ configured: isConfigured(), tableId: tableId || null });
  }

  if (!isConfigured()) return bad('Lark Base is not configured on the server yet.', 503);

  const table = url.searchParams.get('table') || tableId;
  if (!table) return bad('No table id given and LARK_TABLE_ID is not set.');

  try {
    const { appToken } = creds();
    const token = await tenantToken();
    const pageSize = url.searchParams.get('page_size') || '100';
    const res = await fetch(
      `${BASE}/open-apis/bitable/v1/apps/${appToken}/tables/${table}/records?page_size=${pageSize}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
    );
    const data = await res.json();
    if (data.code !== 0) return bad(`Lark returned code ${data.code}: ${data.msg || ''}`, 502);
    return NextResponse.json({ records: data.data?.items || [], hasMore: !!data.data?.has_more });
  } catch (err) {
    console.error('[api/lark GET]', err);
    return bad('Could not read from Lark Base.', 502);
  }
}

/**
 * POST /api/lark — append records.
 * Body: { table?: string, records: [{ fields: Record<string, unknown> }] }
 */
export async function POST(req: Request) {
  if (!isConfigured()) return bad('Lark Base is not configured on the server yet.', 503);

  let body: { table?: string; records?: { fields: Record<string, unknown> }[] };
  try {
    body = await req.json();
  } catch {
    return bad('Request body must be JSON.');
  }

  const table = body.table || creds().tableId;
  if (!table) return bad('No table id given and LARK_TABLE_ID is not set.');
  if (!Array.isArray(body.records) || body.records.length === 0) {
    return bad('`records` must be a non-empty array of { fields }.');
  }

  try {
    const { appToken } = creds();
    const token = await tenantToken();
    const res = await fetch(
      `${BASE}/open-apis/bitable/v1/apps/${appToken}/tables/${table}/records/batch_create`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ records: body.records }),
      }
    );
    const data = await res.json();
    if (data.code !== 0) return bad(`Lark returned code ${data.code}: ${data.msg || ''}`, 502);
    return NextResponse.json({ created: data.data?.records?.length || 0 });
  } catch (err) {
    console.error('[api/lark POST]', err);
    return bad('Could not write to Lark Base.', 502);
  }
}
