/** Build a browser-storage key that cannot bleed across signed-in accounts. */
export function scopedStorageKey(base: string, identity: string) {
  const scope = identity.trim() || 'seed-user';
  return `${base}:${encodeURIComponent(scope)}`;
}
