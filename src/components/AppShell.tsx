'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useToast } from './Toast';
import { titleFor } from '@/lib/nav';
import { LEVEL_NAME, currentLevel, currentRole, currentUser, getSession, type Level } from '@/lib/role';
import { initializeDataLayer } from '@/lib/data-sync';

const BARE_ROUTES = ['/login'];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [identity, setIdentity] = useState<{ name: string; role: string; level: Level } | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const reportedIgnored = useRef(false);

  const bare = BARE_ROUTES.includes(pathname);

  const boot = useCallback(async (force = false) => {
    if (bare) return;

    if (!getSession()) {
      router.replace('/login');
      return;
    }

    setBootError(null);
    try {
      const data = await initializeDataLayer({ force });
      setIdentity({ name: currentUser(), role: currentRole(), level: currentLevel() });
      if (data.ignoredRecords && !reportedIgnored.current) {
        reportedIgnored.current = true;
        toast(
          `Lark loaded, but ${data.ignoredRecords} unrelated or invalid record${data.ignoredRecords === 1 ? '' : 's'} were ignored.`,
          true
        );
      }
    } catch (error) {
      setIdentity(null);
      setBootError(error instanceof Error ? error.message : 'Could not initialize the shared data layer.');
      return;
    }

    const denied = sessionStorage.getItem('ramssolDenied');
    if (denied) {
      sessionStorage.removeItem('ramssolDenied');
      const level = Number(denied) as Level;
      setTimeout(
        () => toast(`That area is limited to ${LEVEL_NAME[level] || 'a higher level'} (Level ${denied}).`, true),
        300
      );
    }
  }, [bare, router, toast]);

  useEffect(() => {
    void boot();
  }, [boot, pathname]);

  useEffect(() => {
    function onSync(event: Event) {
      const detail = (event as CustomEvent<{ ok?: boolean; collection?: string; message?: string }>).detail;
      if (detail?.ok === false) {
        toast(`Lark sync failed for ${detail.collection || 'data'}: ${detail.message || 'unknown error'}`, true);
      }
    }
    window.addEventListener('rams:data-sync', onSync);
    return () => window.removeEventListener('rams:data-sync', onSync);
  }, [toast]);

  if (bare) return <>{children}</>;
  if (bootError) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div className="card" style={{ maxWidth: 560, padding: 28 }}>
          <div className="card-title" style={{ marginBottom: 10 }}>Data connection needs attention</div>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 18 }}>
            {bootError}
          </p>
          <p style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.6, marginBottom: 18 }}>
            Set <code>DATA_SOURCE=seed</code> to keep using mock data, or complete the Lark values in{' '}
            <code>.env.local</code> and restart the server.
          </p>
          <button className="btn-primary" onClick={() => void boot(true)}>Retry</button>
        </div>
      </div>
    );
  }
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
