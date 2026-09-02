'use client';

import { useEffect } from 'react';

/**
 * Refresh a page's shared-data state after Supabase has updated the browser
 * cache, without remounting the page and discarding its local UI state.
 */
export function useRemoteDataRefresh(refresh: () => void) {
  useEffect(() => {
    window.addEventListener('rams:remote-data', refresh);
    return () => window.removeEventListener('rams:remote-data', refresh);
  }, [refresh]);
}
