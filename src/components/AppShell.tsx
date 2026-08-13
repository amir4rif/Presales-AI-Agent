'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useToast } from './Toast';
import { titleFor } from '@/lib/nav';
import { LEVEL_NAME, currentLevel, currentRole, currentUser, getSession, type Level } from '@/lib/role';

const BARE_ROUTES = ['/login'];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [identity, setIdentity] = useState<{ name: string; role: string; level: Level } | null>(null);

  const bare = BARE_ROUTES.includes(pathname);

  useEffect(() => {
    if (bare) return;

    if (!getSession()) {
      router.replace('/login');
      return;
    }

    setIdentity({ name: currentUser(), role: currentRole(), level: currentLevel() });

    const denied = sessionStorage.getItem('ramssolDenied');
    if (denied) {
      sessionStorage.removeItem('ramssolDenied');
      const level = Number(denied) as Level;
      setTimeout(
        () => toast(`That area is limited to ${LEVEL_NAME[level] || 'a higher level'} (Level ${denied}).`, true),
        300
      );
    }
  }, [bare, pathname, router, toast]);

  if (bare) return <>{children}</>;
  if (!identity) return null;

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
