import 'server-only';

import { NextResponse } from 'next/server';
import { getSupabaseStatus } from '@/lib/server/config';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type ApiSessionResult =
  | {
      ok: true;
      userId: string;
      level: number;
      supabase: SupabaseServerClient | null;
    }
  | { ok: false; response: NextResponse };

function jsonError(error: string, status: number): ApiSessionResult {
  return {
    ok: false,
    response: NextResponse.json(
      { error },
      { status, headers: { 'Cache-Control': 'private, no-store' } }
    ),
  };
}

/**
 * Route-level authentication for protected APIs. The proxy performs the same
 * check, but keeping it here means a matcher or platform regression cannot
 * expose provider keys, generated data, or integration records.
 *
 * Seed mode is intentionally available only to the local development server.
 */
export async function requireApiSession(minimumLevel = 1): Promise<ApiSessionResult> {
  const status = getSupabaseStatus();

  if (status.dataSource === 'seed') {
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true, userId: 'seed-development', level: 3, supabase: null };
    }
    return jsonError('Server authentication is not configured.', 503);
  }
  if (!status.configured) {
    return jsonError('Server authentication is not configured.', 503);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();
    const userId = typeof data?.claims?.sub === 'string' ? data.claims.sub : null;
    if (error || !userId) return jsonError('Authentication required.', 401);

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('level, status')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('[api/auth] profile authorization failed', {
        code: profileError.code,
      });
      return jsonError('Could not verify account access.', 503);
    }
    if (!profile || profile.status !== 'active') {
      return jsonError('This account is inactive.', 403);
    }

    const level = Number(profile.level);
    if (!Number.isFinite(level) || level < minimumLevel) {
      return jsonError('Insufficient access level.', 403);
    }
    return { ok: true, userId, level, supabase };
  } catch (error) {
    console.error('[api/auth] session verification failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    return jsonError('Could not verify the current session.', 503);
  }
}
