'use client';
import { useCallback, useEffect, useState } from 'react';
import { stats, type Stats } from './data';

/** Stats read from the shared browser cache after AppShell hydrates it. */
export function useStats() {
  const [value, setValue] = useState<Stats | null>(null);
  const refresh = useCallback(() => setValue(stats()), []);
  useEffect(() => {
    refresh();
    window.addEventListener('rams:data-changed', refresh);
    return () => window.removeEventListener('rams:data-changed', refresh);
  }, [refresh]);
  return { stats: value, refresh };
}

export function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  return `Good ${part}, ${name.split(' ')[0]} 👋`;
}
