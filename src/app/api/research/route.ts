import { ApiError, GoogleGenAI } from '@google/genai';
import { NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/server/api-auth';
import { getResearchConfig, getResearchStatus } from '@/lib/server/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_QUERY_CHARS = 600;
const MAX_LOCATION_CHARS = 160;
const MAX_SUMMARY_CHARS = 16_000;
const MAX_SEARCH_ENTRY_POINT_CHARS = 100_000;

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
  const chunk = object(value);
  const web = object(chunk?.web);
  const url = typeof web?.uri === 'string' ? web.uri : '';
  if (!/^https?:\/\//i.test(url)) return null;
  const title = typeof web?.title === 'string' && web.title.trim()
    ? web.title.trim()
    : new URL(url).hostname;

  // Keep Google's citation URL exactly as returned. Grounding can deliberately
  // return a Google redirect URL; resolving it here would alter the supplied
  // link, add latency, and create another outbound request to maintain.
  return { title, url };
}

function researchPrompt(query: string, location: string) {
  return `Use Google Search to research this prospect request for a Malaysian B2B technology pre-sales representative.

Research request: ${query}
Geographic context: ${location || 'Malaysia'}

Return a concise, factual English summary based only on the public sources you find. Prioritize official company pages, filings, reputable business reporting, and Malaysian or Southeast Asian sources when relevant. Cover the company profile, current operations, employee or revenue signals, and notable technology or transformation priorities. Distinguish confirmed facts from estimates, include useful dates, and do not invent private information.`;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export async function GET() {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;
  return json(getResearchStatus());
}

export async function POST(request: Request) {
  const auth = await requireApiSession();
  if (!auth.ok) return auth.response;

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
  const location = typeof body.location === 'string'
    ? body.location.trim().slice(0, MAX_LOCATION_CHARS)
    : '';
  if (!query || query.length > MAX_QUERY_CHARS) {
    return json({ error: `\`query\` must contain 1-${MAX_QUERY_CHARS} characters.` }, 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const client = new GoogleGenAI({
      apiKey: config.apiKey,
      httpOptions: { timeout: config.timeoutMs },
    });
    const response = await client.models.generateContent({
      model: config.model,
      contents: researchPrompt(query, location),
      config: {
        tools: [{ googleSearch: {} }],
        maxOutputTokens: 4_096,
        temperature: 0.2,
        abortSignal: controller.signal,
      },
    });

    const summary = response.text?.trim() || '';
    const candidate = response.candidates?.[0];
    const grounding = candidate?.groundingMetadata;
    const finishReason = candidate?.finishReason;
    if (
      finishReason === 'SAFETY' ||
      finishReason === 'BLOCKLIST' ||
      finishReason === 'PROHIBITED_CONTENT' ||
      finishReason === 'RECITATION'
    ) {
      return json({ error: 'Gemini declined this prospect-research request.' }, 422);
    }
    if (!summary) {
      return json({ error: 'Gemini returned no prospect-research summary.' }, 502);
    }
    if (finishReason === 'MAX_TOKENS' || summary.length > MAX_SUMMARY_CHARS) {
      return json({ error: 'The grounded research result was too long. Try a narrower query.' }, 502);
    }

    const seen = new Set<string>();
    const sources = (grounding?.groundingChunks || [])
      .map(sourceFrom)
      .filter((source): source is { title: string; url: string } => Boolean(source))
      .filter((source) => !seen.has(source.url) && Boolean(seen.add(source.url)))
      .slice(0, 10);
    if (!grounding?.webSearchQueries?.length || !sources.length) {
      return json({ error: 'Gemini did not return a grounded result. Try a more specific query.' }, 502);
    }

    const searchEntryPointHtml = grounding.searchEntryPoint?.renderedContent;
    if (typeof searchEntryPointHtml !== 'string' || !searchEntryPointHtml.trim()) {
      return json({ error: 'Google did not return the required Search Suggestions.' }, 502);
    }
    if (searchEntryPointHtml.length > MAX_SEARCH_ENTRY_POINT_CHARS) {
      return json({ error: 'Google returned an invalid Search Suggestions entry point.' }, 502);
    }

    return json({
      configured: true,
      provider: 'Gemini with Google Search grounding',
      summary,
      sources,
      // Google's terms require associated Search Suggestions to be displayed
      // with a grounded result. This additive, transient field intentionally
      // stays out of src/lib/research.ts and is never saved to a prospect.
      searchEntryPointHtml,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return json({ error: 'Prospect research timed out.' }, 504);
    }
    if (error instanceof ApiError) {
      if (error.status === 429) {
        return json({ error: 'The prospect-research request limit has been reached.' }, 429);
      }
      if (error.status === 401 || error.status === 403) {
        console.error('[api/research] Gemini authentication failed', { status: error.status });
        return json({ error: 'The prospect-research key was rejected by Gemini.' }, 503);
      }
      console.error('[api/research] Gemini request failed', { status: error.status });
      return json(
        {
          error: error.status === 408 || error.status >= 500
            ? 'Could not reach the prospect-research provider.'
            : 'The prospect-research provider returned an error.',
        },
        error.status === 408 || error.status >= 500 ? 504 : 502
      );
    }
    console.error('[api/research] Unexpected Gemini error', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    return json({ error: 'Could not reach the prospect-research provider.' }, 504);
  } finally {
    clearTimeout(timeout);
  }
}
