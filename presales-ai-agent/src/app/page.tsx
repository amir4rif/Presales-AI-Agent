'use client';
/* "/" — the entry router. It sends each user to the dashboard for their
   access level (Doc §2). The three dashboards are now one page that
   switches on level, so everyone lands on the same route and the page
   decides what to render. */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { HOME, currentLevel, getSession } from '@/lib/role';

const LABEL = {
  1: 'Level 1 · Data Entry',
  2: 'Level 2 · Reviewer',
  3: 'Level 3 · Administrator',
} as const;

export default function Home() {
  const router = useRouter();
  const [sub, setSub] = useState('Checking your access level');

  useEffect(() => {
    if (!getSession()) {
      router.replace('/login');
      return;
    }
    const level = currentLevel();
    setSub(LABEL[level]);
    const t = setTimeout(() => router.replace(HOME), 450);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="router">
      <Image src="/logoo.png" alt="Ramssol Group" width={62} height={58} />
      <div className="rt">Opening your workspace…</div>
      <div className="rs">{sub}</div>
      <div className="bar">
        <i />
      </div>
    </div>
  );
}
