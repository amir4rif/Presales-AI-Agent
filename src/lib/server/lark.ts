import 'server-only';

import { getLarkConfig } from './config';

export type LarkRecord = {
  record_id: string;
  fields: Record<string, unknown>;
};

export type LarkField = {
  field_id: string;
  field_name: string;
  is_primary?: boolean;
  type?: number;
  ui_type?: string;
};

type LarkResponse<T> = {
  code: number;
  msg?: string;
  data?: T;
};

type TokenCache = { token: string; expiresAt: number };
let tokenCache: TokenCache | null = null;

export class LarkApiError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = 'LarkApiError';
  }
}

function requiredConnection() {
  const config = getLarkConfig();
  if (!config.appId || !config.appSecret || !config.appToken || !config.tableId) {
    throw new LarkApiError('Lark Base server configuration is incomplete.');
  }
  return {
    ...config,
    appId: config.appId,
    appSecret: config.appSecret,
    appToken: config.appToken,
    tableId: config.tableId,
  };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

/** Tenant token cached until one minute before Lark expires it. */
async function tenantToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;

  const config = requiredConnection();
  const response = await fetchWithTimeout(
    `${config.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
    },
    config.timeoutMs
  );

  const body = (await response.json().catch(() => null)) as
    | (LarkResponse<never> & { tenant_access_token?: string; expire?: number })
    | null;

  if (!response.ok || !body || body.code !== 0 || !body.tenant_access_token) {
    throw new LarkApiError(
      `Lark authentication failed${body?.code != null ? ` (code ${body.code})` : ''}.`,
      body?.code,
      response.status
    );
  }

  tokenCache = {
    token: body.tenant_access_token,
    expiresAt: Date.now() + Math.max((body.expire || 7200) - 60, 60) * 1000,
  };
  return tokenCache.token;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = requiredConnection();
  const token = await tenantToken();
  const response = await fetchWithTimeout(
    `${config.baseUrl}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
        ...init.headers,
      },
    },
    config.timeoutMs
  );
  const body = (await response.json().catch(() => null)) as LarkResponse<T> | null;

  if (!response.ok || !body || body.code !== 0) {
    throw new LarkApiError(
      `Lark request failed${body?.code != null ? ` (code ${body.code})` : ''}.`,
      body?.code,
      response.status
    );
  }
  return (body.data || {}) as T;
}

function tablePath(suffix = '') {
  const { appToken, tableId } = requiredConnection();
  return `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}${suffix}`;
}

export async function listLarkFields(): Promise<LarkField[]> {
  const data = await request<{ items?: LarkField[] }>(`${tablePath('/fields')}?page_size=100`);
  return data.items || [];
}

export async function getLarkPrimaryFieldName(): Promise<string> {
  const configured = getLarkConfig().primaryField;
  if (configured) return configured;

  const fields = await listLarkFields();
  const primary = fields.find((field) => field.is_primary) || fields[0];
  if (!primary?.field_name) {
    throw new LarkApiError(
      'Could not discover the Lark table primary field. Set LARK_PRIMARY_FIELD explicitly.'
    );
  }
  return primary.field_name;
}

export async function listAllLarkRecords(): Promise<LarkRecord[]> {
  const records: LarkRecord[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < 100; page += 1) {
    const query = new URLSearchParams({ page_size: '500' });
    if (pageToken) query.set('page_token', pageToken);
    const data = await request<{
      items?: LarkRecord[];
      has_more?: boolean;
      page_token?: string;
    }>(`${tablePath('/records')}?${query.toString()}`);
    records.push(...(data.items || []));
    if (!data.has_more || !data.page_token) return records;
    pageToken = data.page_token;
  }

  throw new LarkApiError('Lark record pagination exceeded the safety limit.');
}

function chunks<T>(items: T[], size = 500): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

export async function createLarkRecords(records: { fields: Record<string, unknown> }[]) {
  let created = 0;
  for (const batch of chunks(records)) {
    const data = await request<{ records?: LarkRecord[] }>(tablePath('/records/batch_create'), {
      method: 'POST',
      body: JSON.stringify({ records: batch }),
    });
    created += data.records?.length || batch.length;
  }
  return created;
}

export async function updateLarkRecords(
  records: { record_id: string; fields: Record<string, unknown> }[]
) {
  let updated = 0;
  for (const batch of chunks(records)) {
    const data = await request<{ records?: LarkRecord[] }>(tablePath('/records/batch_update'), {
      method: 'POST',
      body: JSON.stringify({ records: batch }),
    });
    updated += data.records?.length || batch.length;
  }
  return updated;
}

export async function deleteLarkRecords(recordIds: string[]) {
  let deleted = 0;
  for (const batch of chunks(recordIds)) {
    await request(tablePath('/records/batch_delete'), {
      method: 'POST',
      body: JSON.stringify({ records: batch }),
    });
    deleted += batch.length;
  }
  return deleted;
}
