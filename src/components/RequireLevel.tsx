'use client';
/* RequireLevel is a navigation affordance. Supabase RLS is the authority
   for every remote read and write; this component only avoids showing a
   screen that the current profile cannot use. */
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
