'use client';

import {
  DATA_COLLECTIONS,
  type DataCollection,
  type DataSource,
} from './integrations';
import {
  clearCollectionCache,
  replaceCollectionCache,
} from './data-cache';
import { changesBetween, type DataChangeOptions } from './data-changes';
import { LatestRequestCoordinator, SerialTaskCoordinator } from './latest-request';
import { setSession } from './role';
import { createSupabaseBrowserClient } from './supabase/client';

let syncQueue: Promise<void> = Promise.resolve();
let initialization: Promise<DataLayerStatus> | null = null;
let initializationRequest = 0;
let refreshing: Promise<void> | null = null;
let dataLayerGeneration = 0;
let hydrationCoordinator = new LatestRequestCoordinator();
let proposalTransactionCoordinator = new SerialTaskCoordinator();
const requestControllers = new Set<AbortController>();
const canonicalCollections: Partial<Record<DataCollection, unknown[]>> = {};
let activeSource: DataSource | null = null;
let activeCollections = new Set<DataCollection>();

/** Last collection payload confirmed by Supabase, never the optimistic cache. */
export function confirmedCollectionSnapshot<T>(collection: DataCollection): readonly T[] | null {
  const snapshot = canonicalCollections[collection];
  return Array.isArray(snapshot) ? snapshot as T[] : null;
}

/** Wait for every mutation already queued, including rollback or hydration. */
export async function waitForPendingDataSync() {
  while (true) {
    const pending = syncQueue;
    await pending;
    if (pending === syncQueue) return;
  }
}

/**
 * Serialize the full proposal operation, including the initial sync drain and
 * confirmed read. This closes the gap a bare "wait, then write" would leave.
 */
export function runDataTransaction<T>(transaction: () => Promise<T> | T) {
  const generation = dataLayerGeneration;
  return proposalTransactionCoordinator.run(async () => {
    assertCurrentGeneration(generation);
    await waitForPendingDataSync();
    assertCurrentGeneration(generation);
    return transaction();
  });
}

export function runProposalDataTransaction<T>(transaction: () => Promise<T> | T) {
  return runDataTransaction(transaction);
}

export type DealWorkflowCommand =
  | {
      action: 'close';
      dealId: string;
      outcome: 'Won' | 'Lost' | 'Disqualified';
      reason: string;
      source: string;
      closeDate: string;
      expectedUpdatedAt: string;
    }
  | {
      action: 'review-disqualification';
      dealId: string;
      approve: boolean;
      expectedUpdatedAt: string;
    };

export type DealWorkflowResult = {
  status: 'closed' | 'pending_approval' | 'declined';
  dealId: string;
  outcome: 'Open' | 'Won' | 'Lost' | 'Disqualified';
};

export function executeRemoteDealWorkflow(command: DealWorkflowCommand) {
  if (!isRemoteDataSource()) {
    throw new DataLayerError('The database connection is not initialized.');
  }

  return runDataTransaction(async () => {
    const generation = dataLayerGeneration;
    const response = await controlledFetch('/api/deals/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    const body = await responseJson(response) as Partial<DealWorkflowResult> & { error?: string };
    assertCurrentGeneration(generation);
    if (!response.ok) {
      throw new DataLayerError(body.error || 'Could not complete the deal workflow.');
    }
    if (!body.status || !body.dealId || !body.outcome) {
      throw new DataLayerError('The deal workflow returned an invalid response.');
    }

    await loadRemotePayload(generation);
    assertCurrentGeneration(generation);
    window.dispatchEvent(new Event('rams:remote-data'));
    return body as DealWorkflowResult;
  });
}

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

class DataLayerSupersededError extends Error {
  constructor() {
    super('A newer data-layer request superseded this one.');
    this.name = 'DataLayerSupersededError';
  }
}

function assertCurrentGeneration(generation: number) {
  if (generation !== dataLayerGeneration) throw new DataLayerCancelledError();
}

function assertCurrentInitialization(generation: number, request: number) {
  assertCurrentGeneration(generation);
  if (request !== initializationRequest) throw new DataLayerSupersededError();
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
  return [...activeCollections];
}

export function isRemoteCollection(collection: DataCollection) {
  return remoteCollections().includes(collection);
}

export function isRemoteDataSource() {
  return typeof window !== 'undefined' && activeSource === 'supabase';
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
    canonicalCollections[collection] = items;
    replaceCollectionCache(collection, items);
  }
  cacheProfile(payload.profile);
  activeSource = 'supabase';
  activeCollections = new Set(DATA_COLLECTIONS);
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
  // Capture the coordinator so resetDataLayer can replace it without turning
  // an aborted old-generation request into a successful supersession.
  const coordinator = hydrationCoordinator;
  await coordinator.run(
    async (isLatest) => {
      const attempts = 3;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        if (!isLatest()) throw new DataLayerSupersededError();
        try {
          const payload = await fetchRemotePayload();
          assertCurrentGeneration(generation);
          return payload;
        } catch (error) {
          assertCurrentGeneration(generation);
          // Do not retry a response that can no longer become canonical.
          if (!isLatest()) throw error;
          const retryable = attempt < attempts &&
            !(error instanceof DataLayerError && /session has expired/i.test(error.message));
          if (!retryable) throw error;
          await wait(attempt * 400);
        }
      }
      throw new DataLayerError('Could not load shared data from Supabase.');
    },
    (payload) => {
      assertCurrentGeneration(generation);
      cacheRemotePayload(payload);
    }
  );
  assertCurrentGeneration(generation);
}

async function initialize(request: number): Promise<DataLayerStatus> {
  const generation = dataLayerGeneration;
  const statusResponse = await controlledFetch('/api/data', { cache: 'no-store' });
  const status = await responseJson(statusResponse);
  assertCurrentInitialization(generation, request);
  if (!statusResponse.ok || status.dataSource !== 'supabase') {
    throw new DataLayerError(
      typeof status.error === 'string' ? status.error : 'Could not read the server data configuration.'
    );
  }

  const source = status.dataSource as DataSource;
  if (!status.ready) {
    const missing = Array.isArray(status.missing) ? status.missing.join(', ') : 'Supabase settings';
    throw new DataLayerError(`Supabase mode is selected, but these values are missing: ${missing}.`);
  }

  await loadRemotePayload(generation);
  assertCurrentInitialization(generation, request);
  return { source, ready: true };
}

export function initializeDataLayer({ force = false } = {}) {
  if (force || !initialization) {
    const request = ++initializationRequest;
    const pending: Promise<DataLayerStatus> = initialize(request).catch((error) => {
      if (error instanceof DataLayerSupersededError) {
        const newer = initialization;
        if (newer && newer !== pending) return newer;
      }
      throw error;
    });
    initialization = pending;
    void pending.catch(() => {
      if (initialization === pending) initialization = null;
    });
  }
  return initialization;
}

export function resetDataLayer() {
  dataLayerGeneration += 1;
  initializationRequest += 1;
  // Isolate the next signed-in generation. The old coordinator still
  // propagates cancellation to the callers that belong to the old session.
  hydrationCoordinator = new LatestRequestCoordinator();
  proposalTransactionCoordinator = new SerialTaskCoordinator();
  requestControllers.forEach((controller) => controller.abort());
  requestControllers.clear();
  initialization = null;
  refreshing = null;
  syncQueue = Promise.resolve();
  DATA_COLLECTIONS.forEach((collection) => delete canonicalCollections[collection]);
  clearCollectionCache();
  activeCollections.clear();
  activeSource = null;
}

async function refreshRemoteData() {
  if (!refreshing) {
    const generation = dataLayerGeneration;
    const pending = loadRemotePayload(generation)
      .then(() => {
        assertCurrentGeneration(generation);
        window.dispatchEvent(new Event('rams:remote-data'));
      })
      // Realtime hydration is a best-effort background refresh. A mutation's
      // post-write hydration owns its error, so reporting here as well could
      // turn one failure into duplicate/misleading "Data sync failed" toasts.
      .catch(() => undefined);
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

function restoreCanonicalCollection(collection: DataCollection) {
  const canonical = canonicalCollections[collection];
  if (!canonical) return;
  replaceCollectionCache(collection, canonical);
  window.dispatchEvent(new Event('rams:data-changed'));
  window.dispatchEvent(new Event('rams:remote-data'));
}

/** Persist only changed records; a missing row never replaces a collection. */
export function queueDataSync(
  collection: DataCollection,
  previous: unknown[],
  next: unknown[],
  options: DataChangeOptions = {}
) {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (!isRemoteDataSource() || !isRemoteCollection(collection)) {
    replaceCollectionCache(collection, previous);
    window.dispatchEvent(new Event('rams:data-changed'));
    emitSync(collection, false, 'The database connection is not initialized. Refresh and try again.');
    return Promise.resolve(false);
  }
  const changes = changesBetween(collection, previous, next, options);
  if (!changes.upserts.length && !changes.deletes.length) return Promise.resolve(true);
  const generation = dataLayerGeneration;

  const operation = syncQueue
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
      // Always start a post-mutation read. Reusing `refreshing` here could
      // accidentally accept a realtime GET that began before this PUT.
      // Once the PUT is confirmed, however, a failed follow-up GET must not
      // turn the committed write into a reported failure or roll it back from
      // the optimistic cache. The next refresh will reconcile server fields.
      try {
        await loadRemotePayload(generation);
        assertCurrentGeneration(generation);
      } catch {
        assertCurrentGeneration(generation);
      }
      window.dispatchEvent(new Event('rams:remote-data'));
      emitSync(collection, true);
    });

  syncQueue = operation
    .catch((error) => {
      if (error instanceof DataLayerCancelledError || generation !== dataLayerGeneration) return;
      // An optimistic cache write must not survive a rejected remote mutation.
      // The last payload confirmed by Supabase remains correct across queued
      // writes, unlike an individual operation's `previous` snapshot.
      restoreCanonicalCollection(collection);
      if (!options.suppressSyncError) {
        emitSync(
          collection,
          false,
          error instanceof Error ? error.message : `Could not sync ${collection}.`
        );
      }
    });

  // Callers that present a success message can wait for the real remote write.
  // This promise always resolves, so legacy fire-and-forget saves stay safe.
  return operation.then(
    () => true,
    () => false
  );
}

const REALTIME_TABLES = [
  'proposals',
  'deals',
  'workspace_config',
  'compliance_rows',
] as const;

export function subscribeToRemoteChanges() {
  if (!isRemoteDataSource()) return () => undefined;
  const supabase = createSupabaseBrowserClient();
  let channel = supabase.channel(`remote-store-${crypto.randomUUID()}`);
  for (const table of REALTIME_TABLES) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      () => {
        void refreshRemoteData();
      }
    );
  }
  channel.subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
