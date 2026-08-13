'use client';
import { useCallback, useEffect, useState } from 'react';
import { stats, type Stats } from './data';

/** Stats read from localStorage, so they can only be computed after mount. */
export function useStats() {
  const [value, setValue] = useState<Stats | null>(null);
  const refresh = useCallback(() => setValue(stats()), []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { stats: value, refresh };
}

export function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  return `Good ${part}, ${name.split(' ')[0]} 👋`;
}
