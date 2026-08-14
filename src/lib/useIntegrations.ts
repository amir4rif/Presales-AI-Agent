'use client';
/* Integration status. The keys now live on the server, so the browser
   asks the routes whether they are configured rather than reading
   localStorage — there is nothing to read there any more. */
import { useEffect, useState } from 'react';
import type { AnthropicIntegrationStatus, LarkIntegrationStatus } from './integrations';

export type Integrations = {
  ai: AnthropicIntegrationStatus | null;
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
  const [lark, setLark] = useState<Integrations['lark']>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      status<AnthropicIntegrationStatus>('/api/generate'),
      status<LarkIntegrationStatus>('/api/lark'),
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
