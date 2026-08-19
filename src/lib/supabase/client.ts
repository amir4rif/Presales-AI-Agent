'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

function publicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) {
    throw new Error('Supabase is selected, but its public URL or publishable key is missing.');
  }
  return { url, key };
}
export function createSupabaseBrowserClient() {
  if (browserClient) return browserClient;
  const { url, key } = publicConfig();
  browserClient = createBrowserClient<Database>(url, key);
  return browserClient;
}
