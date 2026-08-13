'use client';
/* Integration status. The keys now live on the server, so the browser
   asks the routes whether they are configured rather than reading
   localStorage — there is nothing to read there any more. */
import { useEffect, useState } from 'react';

export type Integrations = {
  ai: { configured: boolean; model: string } | null;
  lark: { configured: boolean; tableId: string | null } | null;
  loading: boolean;
};

export function useIntegrations(): Integrations {
  const [ai, setAi] = useState<Integrations['ai']>(null);
  const [lark, setLark] = useState<Integrations['lark']>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch('/api/generate').then((r) => r.json()).catch(() => null),
      fetch('/api/lark').then((r) => r.json()).catch(() => null),
    ]).then(([a, l]) => {
      if (!alive) return;
      setAi(a);
      setLark(l);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { ai, lark, loading };
}
