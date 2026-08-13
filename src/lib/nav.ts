/* Nav model — one list, used by the sidebar, the topbar title and
   global search, so they can never disagree about what a level can see. */
import type { Level } from './role';

export type NavIcon = 'home' | 'users' | 'doc' | 'edit' | 'check' | 'pulse' | 'grid' | 'gear';

export type NavItem =
  | { sec: string }
  | { label: string; icon: NavIcon; href: string; min: Level; title?: string };

export const NAV: NavItem[] = [
  { sec: 'Workspace' },
  { label: 'Dashboard',        icon: 'home',  href: '/dashboard',        min: 1, title: 'My Workspace' },
  { label: 'Prospects',        icon: 'users', href: '/prospects',        min: 1, title: 'Prospects' },
  { label: 'Compliance (RFP)', icon: 'doc',   href: '/compliance',       min: 1, title: 'Compliance (RFP)' },
  { label: 'My Proposals',     icon: 'edit',  href: '/proposals',        min: 1, title: 'My Proposals' },
  { label: 'Approvals',        icon: 'check', href: '/admin/approvals',  min: 2, title: 'Approvals' },
  { sec: 'Insights' },
  { label: 'Pipeline',         icon: 'pulse', href: '/pipeline',         min: 1, title: 'Pipeline' },
  { label: 'Analytics',        icon: 'grid',  href: '/analytics',        min: 2, title: 'Analytics' },
  { sec: 'System' },
  { label: 'Administration',   icon: 'gear',  href: '/admin/settings',   min: 3, title: 'Administration' },
];

export const isSection = (n: NavItem): n is { sec: string } => 'sec' in n;

export function navLinks(level: Level) {
  return NAV.filter((n): n is Extract<NavItem, { href: string }> => !isSection(n) && level >= n.min);
}

export function titleFor(pathname: string) {
  const hit = NAV.find((n) => !isSection(n) && n.href === pathname);
  return hit && !isSection(hit) ? hit.title || hit.label : 'Ramssol Pre-Sales Copilot';
}

export const ICON_PATHS: Record<NavIcon, string> = {
  home:  '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  doc:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  edit:  '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  check: '<path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.6 0 3.1.42 4.4 1.15"/><path d="M21 5l-9 9"/>',
  pulse: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  grid:  '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  gear:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
};
