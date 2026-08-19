import { NextResponse } from 'next/server';
import { getResearchConfig, getResearchStatus } from '@/lib/server/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_QUERY_CHARS = 600;
const MAX_SUMMARY_CHARS = 16_000;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sourceFrom(value: unknown) {
  const item = object(value);
  if (!item) return null;
  const url = [item.link, item.url, item.source].find((part) => typeof part === 'string') as string | undefined;
  if (!url || !/^https?:\/\//i.test(url)) return null;
  const title = [item.title, item.name].find((part) => typeof part === 'string') as string | undefined;
  return { title: title || new URL(url).hostname, url };
}

function summaryFrom(payload: Record<string, unknown>) {
  if (typeof payload.markdown === 'string') return payload.markdown.slice(0, MAX_SUMMARY_CHARS);
  const blocks = Array.isArray(payload.text_blocks) ? payload.text_blocks : [];
  return blocks
    .map((block) => {
      if (typeof block === 'string') return block;
      const item = object(block);
      return item && typeof item.text === 'string' ? item.text : '';
    })
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_SUMMARY_CHARS);
}

export async function GET() {
  return json(getResearchStatus());
}

export async function POST(request: Request) {
  const config = getResearchConfig();
  if (!config.apiKey) {
    return json({ ...getResearchStatus(), error: 'Prospect research is not configured.' }, 503);
  }

  let body: { query?: unknown; location?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400);
  }
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  const location = typeof body.location === 'string' ? body.location.trim() : '';
  if (!query || query.length > MAX_QUERY_CHARS) {
    return json({ error: `\`query\` must contain 1-${MAX_QUERY_CHARS} characters.` }, 400);
  }

  const url = new URL('https://serpapi.com/search');
  url.searchParams.set('engine', 'brave_ai_mode');
  url.searchParams.set('q', query);
  url.searchParams.set('country', 'my');
  url.searchParams.set('language', 'en');
  url.searchParams.set('safeSearch', 'strict');
  url.searchParams.set('output', 'json');
  url.searchParams.set('api_key', config.apiKey);
  if (location) url.searchParams.set('location', location.slice(0, 160));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.status === 429) {
      return json({ error: 'The prospect-research request limit has been reached.' }, 429);
    }
    if (!response.ok || typeof payload.error === 'string') {
      console.error('[api/research] SerpApi request failed', { status: response.status });
      return json({ error: 'The prospect-research provider returned an error.' }, 502);
    }

    const candidates = [
      ...(Array.isArray(payload.references) ? payload.references : []),
      ...(Array.isArray(payload.web_results) ? payload.web_results : []),
    ];
    const seen = new Set<string>();
    const sources = candidates
      .map(sourceFrom)
      .filter((source): source is { title: string; url: string } => Boolean(source))
      .filter((source) => !seen.has(source.url) && Boolean(seen.add(source.url)))
      .slice(0, 10);

    return json({
      configured: true,
      provider: 'SerpApi Brave AI Mode',
      summary: summaryFrom(payload),
      sources,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return json({ error: 'Prospect research timed out.' }, 504);
    }
    return json({ error: 'Could not reach the prospect-research provider.' }, 504);
  } finally {
    clearTimeout(timeout);
  }
}
