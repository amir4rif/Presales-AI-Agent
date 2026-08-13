'use client';
/* One dashboard page that switches on level — the three
   dashboard-l1/l2/l3.html files collapse into this. Every tier lands on
   /dashboard, and the level decides what it renders (Doc §2). */
import LevelOne from '@/components/dashboard/LevelOne';
import LevelTwo from '@/components/dashboard/LevelTwo';
import LevelThree from '@/components/dashboard/LevelThree';
import RequireLevel from '@/components/RequireLevel';
import { currentLevel } from '@/lib/role';
import { useStats } from '@/lib/useStats';
import { useEffect, useState } from 'react';
import type { Level } from '@/lib/role';

export default function DashboardPage() {
  const { stats } = useStats();
  const [level, setLevel] = useState<Level | null>(null);

  useEffect(() => {
    setLevel(currentLevel());
  }, []);

  return (
    <RequireLevel min={1}>
      {!stats || !level ? (
        <div className="empty-hint" style={{ padding: 40 }}>
          Loading your workspace…
        </div>
      ) : level === 3 ? (
        <LevelThree s={stats} />
      ) : level === 2 ? (
        <LevelTwo s={stats} />
      ) : (
        <LevelOne s={stats} />
      )}
    </RequireLevel>
  );
}
