const CONTROL_OR_BACKSLASH = /[\\\u0000-\u001f\u007f]/;

function isUnsafe(candidate: string) {
  return (
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    CONTROL_OR_BACKSLASH.test(candidate)
  );
}

/**
 * Accept only same-origin application paths for post-authentication redirects.
 * Repeated decoding catches values such as /%252f%252fevil.example as well as
 * raw and encoded backslashes, which URL parsers can otherwise treat as slashes.
 */
export function safeNextPath(value: string | null, fallback = '/dashboard') {
  if (!value) return fallback;

  let decoded = value;
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      if (isUnsafe(decoded)) return fallback;
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return fallback;
  }
  if (isUnsafe(decoded)) return fallback;

  try {
    const origin = 'https://internal.invalid';
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
