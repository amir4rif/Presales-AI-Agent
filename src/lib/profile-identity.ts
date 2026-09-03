export type ProfileIdentity = {
  id: string;
  name: string;
};

export type ProfilesLoader = () => Promise<ProfileIdentity[]>;

/** A safe-to-show validation failure for a legacy name-only write. */
export class ProfileResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileResolutionError';
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const normalizedName = (value: string) => value.trim().toLocaleLowerCase();

/**
 * IDs on the wire are authoritative. Name lookup exists only for older
 * clients, and succeeds only when the display name has exactly one match.
 */
export async function resolveProfileIdFromWire(
  item: Record<string, unknown>,
  nameField: string,
  idField: string,
  loadProfiles: ProfilesLoader,
  fallback: string
): Promise<string> {
  const explicit = text(item[idField]);
  if (explicit) return explicit;

  const name = text(item[nameField]);
  if (!name) return fallback;

  const normalized = normalizedName(name);
  const matches = (await loadProfiles()).filter(
    (profile) => normalizedName(profile.name) === normalized
  );
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    throw new ProfileResolutionError(
      `The ${nameField} name "${name}" matches multiple profiles; include ${idField}.`
    );
  }
  throw new ProfileResolutionError(
    `Could not resolve "${name}" to an existing user for ${nameField}.`
  );
}
