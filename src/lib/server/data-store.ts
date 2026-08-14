import 'server-only';

import {
  DATA_COLLECTIONS,
  type DataCollection,
} from '@/lib/integrations';
import {
  createLarkRecords,
  deleteLarkRecords,
  getLarkPrimaryFieldName,
  listAllLarkRecords,
  updateLarkRecords,
  type LarkRecord,
} from './lark';

type DataEnvelope = {
  version: 1;
  collection: DataCollection;
  key: string;
  payload: unknown;
};

const MAX_COLLECTION_ITEMS = 10_000;
const MAX_RECORD_CHARS = 90_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cellText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const joined = value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (isObject(part) && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
    return joined || null;
  }
  if (isObject(value) && typeof value.text === 'string') return value.text;
  return null;
}

function parseEnvelope(record: LarkRecord, primaryField: string) {
  const raw = cellText(record.fields[primaryField]);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DataEnvelope>;
    if (
      parsed.version !== 1 ||
      !DATA_COLLECTIONS.includes(parsed.collection as DataCollection) ||
      typeof parsed.key !== 'string' ||
      !('payload' in parsed)
    ) {
      return null;
    }
    const envelope = parsed as DataEnvelope;
    if (itemKey(envelope.collection, envelope.payload) !== envelope.key) return null;
    return { envelope, raw };
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function itemKey(collection: DataCollection, value: unknown): string {
  if (!isObject(value)) throw new Error(`Every ${collection} item must be an object.`);

  let parts: string[] = [];
  switch (collection) {
    case 'proposals':
      parts = [stringValue(value.id)];
      break;
    case 'prospects':
      parts = [stringValue(value.id)];
      break;
    case 'deals':
      parts = [value.rep, value.account].map(stringValue);
      break;
    case 'closedDeals':
      parts = [value.rep, value.account, value.closeDate].map(stringValue);
      break;
    case 'team':
      parts = [stringValue(value.email) || stringValue(value.name)];
      break;
  }

  if (!parts.length || parts.some((part) => !part.trim())) {
    throw new Error(`A ${collection} item is missing its stable identifier.`);
  }
  return parts.length === 1 ? parts[0] : JSON.stringify(parts);
}

function serialize(collection: DataCollection, value: unknown): { key: string; raw: string } {
  const key = itemKey(collection, value);
  const raw = JSON.stringify({ version: 1, collection, key, payload: value } satisfies DataEnvelope);
  if (raw.length > MAX_RECORD_CHARS) {
    throw new Error(`A ${collection} record is too large for the Lark storage contract.`);
  }
  return { key, raw };
}

export async function readAllDataCollections() {
  const primaryField = await getLarkPrimaryFieldName();
  const records = await listAllLarkRecords();
  const collections = Object.fromEntries(
    DATA_COLLECTIONS.map((collection) => [collection, [] as unknown[]])
  ) as Record<DataCollection, unknown[]>;
  const seen = Object.fromEntries(
    DATA_COLLECTIONS.map((collection) => [collection, new Set<string>()])
  ) as Record<DataCollection, Set<string>>;
  let ignoredRecords = 0;

  for (const record of records) {
    const parsed = parseEnvelope(record, primaryField);
    if (!parsed) {
      ignoredRecords += 1;
      continue;
    }
    if (seen[parsed.envelope.collection].has(parsed.envelope.key)) {
      ignoredRecords += 1;
      continue;
    }
    seen[parsed.envelope.collection].add(parsed.envelope.key);
    collections[parsed.envelope.collection].push(parsed.envelope.payload);
  }

  return { collections, ignoredRecords };
}

export async function replaceDataCollection(collection: DataCollection, items: unknown[]) {
  if (items.length > MAX_COLLECTION_ITEMS) {
    throw new Error(`${collection} exceeds the ${MAX_COLLECTION_ITEMS}-item safety limit.`);
  }

  const primaryField = await getLarkPrimaryFieldName();
  const currentRecords = await listAllLarkRecords();
  const existing = new Map<string, { recordId: string; raw: string }>();
  const duplicateIds: string[] = [];

  for (const record of currentRecords) {
    const parsed = parseEnvelope(record, primaryField);
    if (!parsed || parsed.envelope.collection !== collection) continue;
    if (existing.has(parsed.envelope.key)) duplicateIds.push(record.record_id);
    else existing.set(parsed.envelope.key, { recordId: record.record_id, raw: parsed.raw });
  }

  const next = new Map<string, string>();
  for (const item of items) {
    const entry = serialize(collection, item);
    if (next.has(entry.key)) throw new Error(`${collection} contains duplicate key "${entry.key}".`);
    next.set(entry.key, entry.raw);
  }

  const creates: { fields: Record<string, unknown> }[] = [];
  const updates: { record_id: string; fields: Record<string, unknown> }[] = [];
  const deletes = [...duplicateIds];

  for (const [key, raw] of next) {
    const prior = existing.get(key);
    if (!prior) creates.push({ fields: { [primaryField]: raw } });
    else if (prior.raw !== raw) {
      updates.push({ record_id: prior.recordId, fields: { [primaryField]: raw } });
    }
  }
  for (const [key, prior] of existing) {
    if (!next.has(key)) deletes.push(prior.recordId);
  }

  // Lark documents write-conflict errors for concurrent mutations, so keep
  // these operations sequential within one replacement.
  const created = creates.length ? await createLarkRecords(creates) : 0;
  const updated = updates.length ? await updateLarkRecords(updates) : 0;
  const deleted = deletes.length ? await deleteLarkRecords(deletes) : 0;

  return { created, updated, deleted, total: items.length };
}
