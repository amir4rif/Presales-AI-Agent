'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { useToast } from './Toast';
import { titleFor } from '@/lib/nav';
import { LEVEL_NAME, currentLevel, currentRole, currentUser, getSession, type Level } from '@/lib/role';
import { initializeDataLayer, subscribeToProposalChanges, type DataLayerStatus } from '@/lib/data-sync';

const BARE_ROUTES = ['/login', '/auth/update-password'];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [identity, setIdentity] = useState<{ name: string; role: string; level: Level } | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<DataLayerStatus | null>(null);
  const [dataRevision, setDataRevision] = useState(0);

  const bare = BARE_ROUTES.includes(pathname);

  const boot = useCallback(async (force = false) => {
    if (bare) return;

    setBootError(null);
    try {
      const data = await initializeDataLayer({ force });
      setDataStatus(data);
      if (data.source === 'seed' && !getSession()) {
        router.replace('/login');
        return;
      }
      setIdentity({ name: currentUser(), role: currentRole(), level: currentLevel() });
    } catch (error) {
      setIdentity(null);
      const message = error instanceof Error ? error.message : 'Could not initialize the shared data layer.';
      if (/session has expired|authentication required/i.test(message)) {
        router.replace('/login');
        return;
      }
      setBootError(message);
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
        toast(`Data sync failed for ${detail.collection || 'data'}: ${detail.message || 'unknown error'}`, true);
      }
    }
    window.addEventListener('rams:data-sync', onSync);
    return () => window.removeEventListener('rams:data-sync', onSync);
  }, [toast]);

  useEffect(() => {
    if (bare || dataStatus?.source !== 'supabase') return;
    return subscribeToProposalChanges();
  }, [bare, dataStatus?.source]);

  useEffect(() => {
    const reload = () => setDataRevision((value) => value + 1);
    window.addEventListener('rams:remote-data', reload);
    return () => window.removeEventListener('rams:remote-data', reload);
  }, []);

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
            Set <code>DATA_SOURCE=seed</code> to use the offline demo, or complete the Supabase values in{' '}
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
        <div className="content" key={dataRevision}>{children}</div>
      </div>
    </>
  );
}
