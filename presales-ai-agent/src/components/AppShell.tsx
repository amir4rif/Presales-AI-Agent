'use client';
/* AppShell — the runtime that used to be app-shell.js:
   auth guard, live identity, level-aware sidebar, topbar.
   layout.tsx renders it around every page. */
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useToast } from './Toast';
import { titleFor } from '@/lib/nav';
import { LEVEL_NAME, currentLevel, currentRole, currentUser, getSession, type Level } from '@/lib/role';

/** Routes that render without the sidebar. */
const BARE = ['/login'];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [ready, setReady] = useState(false);
  const [identity, setIdentity] = useState<{ name: string; role: string; level: Level } | null>(null);

  const bare = BARE.includes(pathname);

  useEffect(() => {
    if (bare) {
      setReady(true);
      return;
    }
    if (!getSession()) {
      router.replace('/login');
      return;
    }
    setIdentity({ name: currentUser(), role: currentRole(), level: currentLevel() });
    setReady(true);

    // A redirect from RequireLevel leaves a note behind; show it once.
    const denied = sessionStorage.getItem('ramssolDenied');
    if (denied) {
      sessionStorage.removeItem('ramssolDenied');
      const lvl = Number(denied) as Level;
      setTimeout(
        () => toast(`🔒 That area is limited to ${LEVEL_NAME[lvl] || 'a higher level'} (Level ${denied}).`, true),
        300
      );
    }
  }, [bare, pathname, router, toast]);

  if (bare) return <>{children}</>;

  if (!ready || !identity) {
    return (
      <div className="router">
        <div className="rt">Opening your workspace…</div>
        <div className="bar">
          <i />
        </div>
      </div>
    );
  }

  return (
    <>
      <Sidebar level={identity.level} name={identity.name} role={identity.role} />
      <div className="main">
        <Topbar title={titleFor(pathname)} level={identity.level} />
        <div className="content">{children}</div>
      </div>
    </>
  );
}
