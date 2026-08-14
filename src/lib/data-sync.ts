'use client';

import {
  DATA_COLLECTIONS,
  STORAGE_KEY_BY_COLLECTION,
  type DataCollection,
  type DataSource,
} from './integrations';

const SOURCE_KEY = 'ramssolDataSource';
const REMOTE_COLLECTIONS_KEY = 'ramssolRemoteCollections';
let syncQueue: Promise<void> = Promise.resolve();
let initialization: Promise<DataLayerStatus> | null = null;

export type DataLayerStatus = {
  source: DataSource;
  ready: boolean;
  ignoredRecords?: number;
};

export class DataLayerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataLayerError';
  }
}

function remoteCollections(): DataCollection[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(REMOTE_COLLECTIONS_KEY) || '[]');
    return Array.isArray(value)
      ? value.filter((item): item is DataCollection => DATA_COLLECTIONS.includes(item))
      : [];
  } catch {
    return [];
  }
}

export function isRemoteCollection(collection: DataCollection) {
  return remoteCollections().includes(collection);
}

export function isRemoteDataSource() {
  return typeof window !== 'undefined' && localStorage.getItem(SOURCE_KEY) === 'lark';
}

async function responseJson(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

async function initialize(): Promise<DataLayerStatus> {
  const statusResponse = await fetch('/api/data', { cache: 'no-store' });
  const status = await responseJson(statusResponse);
  if (!statusResponse.ok || (status.source !== 'seed' && status.source !== 'lark')) {
    throw new DataLayerError(
      typeof status.error === 'string' ? status.error : 'Could not read the server data configuration.'
    );
  }

  const source = status.source as DataSource;
  const previousSource = localStorage.getItem(SOURCE_KEY);

  if (source === 'seed') {
    if (previousSource === 'lark') {
      // Values loaded from Lark are only a browser cache. Clear that cache when
      // intentionally returning to demo mode so the authored seed data returns.
      DATA_COLLECTIONS.forEach((collection) =>
        localStorage.removeItem(STORAGE_KEY_BY_COLLECTION[collection])
      );
    }
    localStorage.setItem(SOURCE_KEY, 'seed');
    localStorage.setItem(REMOTE_COLLECTIONS_KEY, '[]');
    return { source, ready: true };
  }

  if (!status.ready) {
    const missing = Array.isArray(status.missing) ? status.missing.join(', ') : 'Lark settings';
    throw new DataLayerError(`Lark mode is selected, but these values are missing: ${missing}.`);
  }

  const dataResponse = await fetch('/api/data?all=1', { cache: 'no-store' });
  const data = await responseJson(dataResponse);
  if (!dataResponse.ok || !data.collections || typeof data.collections !== 'object') {
    throw new DataLayerError(
      typeof data.error === 'string' ? data.error : 'Could not load shared data from Lark Base.'
    );
  }

  const collections = data.collections as Record<string, unknown>;
  for (const collection of DATA_COLLECTIONS) {
    const items = collections[collection];
    if (!Array.isArray(items)) {
      throw new DataLayerError(`Lark returned an invalid ${collection} collection.`);
    }
    localStorage.setItem(STORAGE_KEY_BY_COLLECTION[collection], JSON.stringify(items));
  }
  localStorage.setItem(SOURCE_KEY, 'lark');
  localStorage.setItem(REMOTE_COLLECTIONS_KEY, JSON.stringify(DATA_COLLECTIONS));
  window.dispatchEvent(new Event('rams:data-changed'));

  return {
    source,
    ready: true,
    ignoredRecords: typeof data.ignoredRecords === 'number' ? data.ignoredRecords : 0,
  };
}

export function initializeDataLayer({ force = false } = {}) {
  if (force || !initialization) initialization = initialize();
  return initialization;
}

function emitSync(collection: DataCollection, ok: boolean, message?: string) {
  window.dispatchEvent(
    new CustomEvent('rams:data-sync', { detail: { collection, ok, message } })
  );
}

/**
 * Keep the existing synchronous page APIs while serializing every remote write.
 * All collections share one Base table, so cross-collection writes must not race.
 */
export function queueDataSync(collection: DataCollection, items: unknown[]) {
  if (typeof window === 'undefined' || localStorage.getItem(SOURCE_KEY) !== 'lark') return;
  if (!isRemoteCollection(collection)) return;

  syncQueue = syncQueue
    .catch(() => undefined)
    .then(async () => {
      const response = await fetch(`/api/data/${collection}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const body = await responseJson(response);
      if (!response.ok) {
        throw new DataLayerError(
          typeof body.error === 'string' ? body.error : `Could not sync ${collection}.`
        );
      }
      emitSync(collection, true);
    })
    .catch((error) => {
      emitSync(
        collection,
        false,
        error instanceof Error ? error.message : `Could not sync ${collection}.`
      );
    });
}
