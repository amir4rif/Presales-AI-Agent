import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from '@/lib/supabase/database.types';

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const publicReadiness =
    pathname === '/api/data' &&
    request.method === 'GET' &&
    request.nextUrl.searchParams.get('all') !== '1';
  const publicPath =
    pathname.startsWith('/login') || pathname.startsWith('/auth') || publicReadiness;
  const dataSource = process.env.DATA_SOURCE || process.env.NEXT_PUBLIC_DATA_SOURCE || 'seed';
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (dataSource !== 'supabase' || !url || !key) {
    if (process.env.NODE_ENV !== 'production' || publicPath) {
      return NextResponse.next({ request });
    }
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Server authentication is not configured.' },
        { status: 503, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.searchParams.set('error', 'server_configuration');
    return NextResponse.redirect(login);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const authenticated = Boolean(data?.claims?.sub);
  if (!authenticated && !publicPath) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Authentication required.' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    const login = request.nextUrl.clone();
    login.pathname = '/login';
    login.searchParams.set('next', pathname);
    return NextResponse.redirect(login);
  }

  if (authenticated && pathname === '/login') {
    const dashboard = request.nextUrl.clone();
    dashboard.pathname = '/dashboard';
    dashboard.search = '';
    return NextResponse.redirect(dashboard);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
