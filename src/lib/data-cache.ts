import type { DataCollection } from './integrations';

const cache: Partial<Record<DataCollection, unknown[]>> = {};

export function readCollectionCache<T>(collection: DataCollection): T[] {
  const items = cache[collection];
  return Array.isArray(items) ? items as T[] : [];
}

export function replaceCollectionCache(collection: DataCollection, items: unknown[]) {
  cache[collection] = items;
}

export function clearCollectionCache(collection?: DataCollection) {
  if (collection) {
    delete cache[collection];
    return;
  }
  for (const key of Object.keys(cache) as DataCollection[]) delete cache[key];
}
