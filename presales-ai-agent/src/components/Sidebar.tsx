'use client';
/* Sidebar.tsx — the level-aware nav that app-shell.js used to build
   by hand. Each tier sees only its own workspace (Doc §2). Items above
   the user's level are not rendered at all, and a section label with
   nothing under it is dropped. */
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ICON_PATHS, NAV, isSection, type NavIcon } from '@/lib/nav';
import { clearSession, type Level } from '@/lib/role';

function Icon({ name }: { name: NavIcon }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] }}
    />
  );
}

export default function Sidebar({
  level,
  name,
  role,
}: {
  level: Level;
  name: string;
  role: string;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const visible = NAV.filter((n) => isSection(n) || level >= n.min);
  const initials = name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();

  function logout() {
    clearSession();
    router.replace('/login');
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-mark">
          <div className="logo-icon">
            <Image className="logo-img" src="/logoo.png" alt="Ramssol Group" width={62} height={58} />
          </div>
          <div>
            <div className="logo-name">Ramssol</div>
            <div className="logo-sub">Pre-Sales Copilot</div>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {visible.map((n, i) => {
          if (isSection(n)) {
            // Keep the label only if a real item follows it.
            const next = visible[i + 1];
            if (!next || isSection(next)) return null;
            return (
              <div className="nav-section-label" key={`sec-${n.sec}`}>
                {n.sec}
              </div>
            );
          }
          return (
            <Link
              key={n.href}
              className={`nav-item${pathname === n.href ? ' active' : ''}`}
              href={n.href}
            >
              <Icon name={n.icon} />
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div
        className="sidebar-user"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="user-avatar">{initials}</div>
          <div>
            <div className="user-name">{name}</div>
            <div className="user-role">
              {role} · L{level}
            </div>
          </div>
        </div>
        <button className="logout-btn" onClick={logout} title="Log out">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
