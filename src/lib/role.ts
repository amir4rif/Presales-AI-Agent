/* ═══════════════════════════════════════════════════════════
   role.ts — the single definition of ROLE_LEVELS.

   This used to live in two places (app-data.js and app-shell.js),
   which is exactly the sort of pair that drifts. Everything that
   needs a level now imports it from here.
═══════════════════════════════════════════════════════════ */

export type Level = 1 | 2 | 3;

export const ROLE_LEVELS: Record<string, Level> = {
  'Sales Representative': 1,
  'Sales Manager': 2,
  'Sales Operations': 3,
  'Pre-Sales': 1,
  'COO Office': 3,
};

export const LEVEL_NAME: Record<Level, string> = {
  1: 'Data Entry',
  2: 'Reviewer',
  3: 'Administrator',
};

/* Minimum level required per route. Anything not listed is level 1.
   RequireLevel reads this; Sidebar uses it to decide what to render. */
export const PAGE_LEVELS: Record<string, Level> = {
  '/admin/settings': 3,
  '/admin/approvals': 2,
  '/analytics': 2,
};

export type Session = {
  userId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  level?: Level;
};

const SESSION_KEY = 'ramssolSession';

function parse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** The signed-in session, or null when nobody is signed in. */
export function getSession(): Session | null {
  if (typeof window === 'undefined') return null;
  return parse<Session>(sessionStorage.getItem(SESSION_KEY));
}

export function setSession(s: Session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

/** Identity of the signed-in user (Doc §3.8 — "My Proposals shows own only"). */
export function currentUser(): string {
  const s = getSession();
  if (s && (s.firstName || s.lastName)) {
    const name = `${s.firstName || ''} ${s.lastName || ''}`.trim();
    if (name) return name;
  }
  return 'Lim LG';
}

/** Stable database identity of the signed-in user, when remotely authenticated. */
export function currentUserId(): string | undefined {
  return getSession()?.userId;
}

/** Access level of the signed-in user (Doc §2). */
export function currentLevel(): Level {
  const s = getSession();
  if (s) return s.level || ROLE_LEVELS[s.role || ''] || 1;
  return 1;
}

export function currentRole(): string {
  const s = getSession();
  return s?.role || 'Sales Representative';
}

/** Level from a role name, used at sign-up / sign-in. */
export function levelForRole(role: string): Level {
  return ROLE_LEVELS[role] || 1;
}

/** Where "/" sends each tier. All three land on the same page now. */
export const HOME = '/dashboard';

export function requiredLevel(path: string): Level {
  return PAGE_LEVELS[path] || 1;
}
