'use client';

import {
  DATA_COLLECTIONS,
  STORAGE_KEY_BY_COLLECTION,
  type DataCollection,
  type DataSource,
} from './integrations';
import { setSession } from './role';
import { createSupabaseBrowserClient } from './supabase/client';

const SOURCE_KEY = 'ramssolDataSource';
const REMOTE_COLLECTIONS_KEY = 'ramssolRemoteCollections';
let syncQueue: Promise<void> = Promise.resolve();
let initialization: Promise<DataLayerStatus> | null = null;
let refreshing: Promise<void> | null = null;
let dataLayerGeneration = 0;
const requestControllers = new Set<AbortController>();

export type DataLayerStatus = {
  source: DataSource;
  ready: boolean;
};

type RemotePayload = {
  profile?: {
    id?: string;
    name?: string;
    email?: string;
    role?: string;
    level?: 1 | 2 | 3;
  };
  collections?: Record<string, unknown>;
};

export class DataLayerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataLayerError';
  }
}

class DataLayerCancelledError extends Error {
  constructor() {
    super('Data-layer operation was cancelled.');
    this.name = 'DataLayerCancelledError';
  }
}

function assertCurrentGeneration(generation: number) {
  if (generation !== dataLayerGeneration) throw new DataLayerCancelledError();
}

async function controlledFetch(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  requestControllers.add(controller);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    requestControllers.delete(controller);
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
  return typeof window !== 'undefined' && localStorage.getItem(SOURCE_KEY) === 'supabase';
}

async function responseJson(response: Response) {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function cacheProfile(profile: RemotePayload['profile']) {
  if (!profile?.name || !profile.email || !profile.role || !profile.level) {
    throw new DataLayerError('Supabase returned an incomplete user profile.');
  }
  const names = profile.name.trim().split(/\s+/);
  setSession({
    userId: profile.id,
    firstName: names[0] || '',
    lastName: names.slice(1).join(' '),
    email: profile.email,
    role: profile.role,
    level: profile.level,
  });
}

function cacheRemotePayload(payload: RemotePayload) {
  if (!payload.collections || typeof payload.collections !== 'object') {
    throw new DataLayerError('Supabase returned an invalid shared data payload.');
  }
  if (!payload.profile?.name || !payload.profile.email ||
      !payload.profile.role || !payload.profile.level) {
    throw new DataLayerError('Supabase returned an incomplete user profile.');
  }
  for (const collection of DATA_COLLECTIONS) {
    const items = payload.collections[collection];
    if (!Array.isArray(items)) {
      throw new DataLayerError(`Supabase returned an invalid ${collection} collection.`);
    }
  }
  for (const collection of DATA_COLLECTIONS) {
    const items = payload.collections[collection] as unknown[];
    localStorage.setItem(STORAGE_KEY_BY_COLLECTION[collection], JSON.stringify(items));
  }
  cacheProfile(payload.profile);
  localStorage.setItem(SOURCE_KEY, 'supabase');
  localStorage.setItem(REMOTE_COLLECTIONS_KEY, JSON.stringify(DATA_COLLECTIONS));
  window.dispatchEvent(new Event('rams:data-changed'));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchRemotePayload() {
  const response = await controlledFetch('/api/data?all=1', { cache: 'no-store' });
  const payload = (await responseJson(response)) as RemotePayload & { error?: string };
  if (!response.ok) {
    if (response.status === 401) throw new DataLayerError('Your session has expired. Please sign in again.');
    throw new DataLayerError(payload.error || 'Could not load shared data from Supabase.');
  }
  return payload;
}

/**
 * A brand-new profile row can briefly lag behind the auth session that just
 * created it (pooled-connection read-after-write skew), so the first
 * hydration right after signup can 502 even though the data is already
 * there. Retry a couple times before surfacing the error screen.
 */
async function loadRemotePayload(generation = dataLayerGeneration) {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const payload = await fetchRemotePayload();
      assertCurrentGeneration(generation);
      cacheRemotePayload(payload);
      return;
    } catch (error) {
      assertCurrentGeneration(generation);
      const retryable = attempt < attempts && !(error instanceof DataLayerError && /session has expired/i.test(error.message));
      if (!retryable) throw error;
      await wait(attempt * 400);
    }
  }
}

async function initialize(): Promise<DataLayerStatus> {
  const generation = dataLayerGeneration;
  const statusResponse = await controlledFetch('/api/data', { cache: 'no-store' });
  const status = await responseJson(statusResponse);
  assertCurrentGeneration(generation);
  if (!statusResponse.ok ||
      (status.dataSource !== 'seed' && status.dataSource !== 'supabase')) {
    throw new DataLayerError(
      typeof status.error === 'string' ? status.error : 'Could not read the server data configuration.'
    );
  }

  const source = status.dataSource as DataSource;
  const previousSource = localStorage.getItem(SOURCE_KEY);

  if (source === 'seed') {
    if (previousSource === 'supabase') {
      DATA_COLLECTIONS.forEach((collection) =>
        localStorage.removeItem(STORAGE_KEY_BY_COLLECTION[collection])
      );
    }
    localStorage.setItem(SOURCE_KEY, 'seed');
    localStorage.setItem(REMOTE_COLLECTIONS_KEY, '[]');
    return { source, ready: true };
  }

  if (!status.ready) {
    const missing = Array.isArray(status.missing) ? status.missing.join(', ') : 'Supabase settings';
    throw new DataLayerError(`Supabase mode is selected, but these values are missing: ${missing}.`);
  }

  await loadRemotePayload(generation);
  return { source, ready: true };
}

export function initializeDataLayer({ force = false } = {}) {
  if (force || !initialization) {
    const pending = initialize();
    initialization = pending;
    void pending.catch(() => {
      if (initialization === pending) initialization = null;
    });
  }
  return initialization;
}

export function resetDataLayer() {
  dataLayerGeneration += 1;
  requestControllers.forEach((controller) => controller.abort());
  requestControllers.clear();
  initialization = null;
  refreshing = null;
  syncQueue = Promise.resolve();
  DATA_COLLECTIONS.forEach((collection) =>
    localStorage.removeItem(STORAGE_KEY_BY_COLLECTION[collection])
  );
  localStorage.removeItem(REMOTE_COLLECTIONS_KEY);
  localStorage.removeItem(SOURCE_KEY);
}

async function refreshRemoteData() {
  if (!refreshing) {
    const generation = dataLayerGeneration;
    const pending = loadRemotePayload(generation)
      .then(() => {
        assertCurrentGeneration(generation);
        window.dispatchEvent(new Event('rams:remote-data'));
      });
    const tracked = pending.finally(() => {
      if (refreshing === tracked) refreshing = null;
    });
    refreshing = tracked;
  }
  return refreshing;
}

function emitSync(collection: DataCollection, ok: boolean, message?: string) {
  window.dispatchEvent(
    new CustomEvent('rams:data-sync', { detail: { collection, ok, message } })
  );
}

function itemRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function itemKey(collection: DataCollection, value: unknown): string {
  const item = itemRecord(value);
  if (!item) return '';
  if (collection === 'proposals' || collection === 'prospects') return String(item.id || '');
  if (collection === 'team') return String(item.id || item.email || '');
  if (item.id) return String(item.id);
  if (collection === 'deals') return JSON.stringify([item.rep, item.account]);
  return JSON.stringify([item.rep, item.account, item.closeDate]);
}

function changesBetween(collection: DataCollection, previous: unknown[], next: unknown[]) {
  const before = new Map(previous.map((item) => [itemKey(collection, item), item]));
  const after = new Map(next.map((item) => [itemKey(collection, item), item]));
  const upserts = next.filter((item) => {
    const old = before.get(itemKey(collection, item));
    return !old || JSON.stringify(old) !== JSON.stringify(item);
  });
  const deletes = previous.filter((item) => !after.has(itemKey(collection, item)));
  return { upserts, deletes };
}

/** Persist only changed records; a missing row never replaces a collection. */
export function queueDataSync(
  collection: DataCollection,
  previous: unknown[],
  next: unknown[]
) {
  if (typeof window === 'undefined' || !isRemoteDataSource()) return;
  if (!isRemoteCollection(collection)) return;
  const changes = changesBetween(collection, previous, next);
  if (!changes.upserts.length && !changes.deletes.length) return;
  const generation = dataLayerGeneration;

  syncQueue = syncQueue
    .catch(() => undefined)
    .then(async () => {
      assertCurrentGeneration(generation);
      const response = await controlledFetch(`/api/data/${collection}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const body = await responseJson(response);
      assertCurrentGeneration(generation);
      if (!response.ok) {
        throw new DataLayerError(
          typeof body.error === 'string' ? body.error : `Could not sync ${collection}.`
        );
      }
      await loadRemotePayload(generation);
      window.dispatchEvent(new Event('rams:remote-data'));
      emitSync(collection, true);
    })
    .catch((error) => {
      if (error instanceof DataLayerCancelledError || generation !== dataLayerGeneration) return;
      emitSync(
        collection,
        false,
        error instanceof Error ? error.message : `Could not sync ${collection}.`
      );
    });
}

/* Only tables people edit concurrently need live pushes: proposals (shared review)
   and deals (pipeline, worked by multiple reps). Prospects, closed deals, and
   profiles are single-actor edits and refresh on save without realtime. */
const REALTIME_TABLES = ['proposals', 'deals'] as const;

export function subscribeToRemoteChanges() {
  if (!isRemoteDataSource()) return () => undefined;
  const supabase = createSupabaseBrowserClient();
  let channel = supabase.channel(`remote-store-${crypto.randomUUID()}`);
  for (const table of REALTIME_TABLES) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      () => {
        void refreshRemoteData().catch((error) => {
          emitSync(
            table,
            false,
            error instanceof Error ? error.message : `Could not refresh ${table}.`
          );
        });
      }
    );
  }
  channel.subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
