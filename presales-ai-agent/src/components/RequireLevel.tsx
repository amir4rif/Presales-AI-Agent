'use client';
/* RequireLevel — replaces the PAGE_LEVELS check that lived in app-shell.js.

   NOTE (carried over from the design doc, still open): this is a
   client-side guard only, exactly like the old one. It stops the nav,
   not a determined user. Real enforcement needs the level checked on
   the server once auth moves off localStorage. */
import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { HOME, LEVEL_NAME, currentLevel, getSession, type Level } from '@/lib/role';

export default function RequireLevel({
  min,
  children,
}: {
  min: Level;
  children: ReactNode;
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (!getSession()) {
      router.replace('/login');
      return;
    }
    if (currentLevel() < min) {
      sessionStorage.setItem('ramssolDenied', String(min));
      router.replace(HOME);
      return;
    }
    setAllowed(true);
  }, [min, router]);

  if (!allowed) {
    return (
      <div className="empty-hint" style={{ padding: 40 }}>
        Checking your access level…
      </div>
    );
  }
  return <>{children}</>;
}

export { LEVEL_NAME };
