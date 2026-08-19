'use client';
/* Integration status. The keys now live on the server, so the browser
   asks the routes whether they are configured rather than reading
   localStorage — there is nothing to read there any more. */
import { useEffect, useState } from 'react';
import type {
  AiIntegrationStatus,
  LarkIntegrationStatus,
  SupabaseIntegrationStatus,
} from './integrations';

export type Integrations = {
  ai: AiIntegrationStatus | null;
  supabase: SupabaseIntegrationStatus | null;
  lark: LarkIntegrationStatus | null;
  loading: boolean;
};

async function status<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

export function useIntegrations(): Integrations {
  const [ai, setAi] = useState<Integrations['ai']>(null);
  const [supabase, setSupabase] = useState<Integrations['supabase']>(null);
  const [lark, setLark] = useState<Integrations['lark']>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      status<AiIntegrationStatus>('/api/generate'),
      status<SupabaseIntegrationStatus>('/api/data'),
      status<LarkIntegrationStatus>('/api/lark'),
    ]).then(([a, s, l]) => {
      if (!alive) return;
      setAi(a);
      setSupabase(s);
      setLark(l);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { ai, supabase, lark, loading };
}
