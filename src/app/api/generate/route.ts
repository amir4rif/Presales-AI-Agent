/* ═══════════════════════════════════════════════════════════
   POST /api/generate — the only place the Anthropic key exists.

   The browser posts { messages, system, maxTokens } here and gets
   back { text }. ANTHROPIC_API_KEY is read from process.env on the
   server and never appears in any response, so it cannot be read
   out of DevTools the way the old localStorage key could.
═══════════════════════════════════════════════════════════ */
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

// The SDK needs Node APIs — keep this off the edge runtime.
export const runtime = 'nodejs';

const DEFAULT_MODEL = 'claude-opus-5';
const DEFAULT_EFFORT = 'medium';

/* Thinking is on by default on Opus 5 and max_tokens caps thinking +
   answer together, so the old 800-token ceiling would truncate the
   reply mid-sentence. 4096 leaves room for both. */
const DEFAULT_MAX_TOKENS = 4096;
const MAX_TOKENS_CEILING = 16000;   // above this we would need to stream

type Body = {
  messages?: { role: 'user' | 'assistant'; content: string }[];
  system?: string;
  maxTokens?: number;
  model?: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
};

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * GET /api/generate — "is AI wired up?" for the Settings and dashboard
 * status rows. Returns a boolean and the model name only; the key itself
 * never crosses this boundary.
 */
export async function GET() {
  return NextResponse.json({
    configured: Boolean(process.env.ANTHROPIC_API_KEY),
    model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
  });
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Deliberately vague to the browser; the detail goes to server logs.
    console.error('[api/generate] ANTHROPIC_API_KEY is not set in .env.local');
    return bad('AI is not configured on the server yet.', 503);
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return bad('Request body must be JSON.');
  }

  const { messages, system } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return bad('`messages` must be a non-empty array.');
  }
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return bad('Each message needs a role of "user" or "assistant" and string content.');
    }
  }

  const maxTokens = Math.min(
    Math.max(Number(body.maxTokens) || DEFAULT_MAX_TOKENS, 1),
    MAX_TOKENS_CEILING
  );
  const model = body.model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const effort = body.effort || process.env.ANTHROPIC_EFFORT || DEFAULT_EFFORT;

  const client = new Anthropic({ apiKey });

  try {
    const res = await client.beta.messages.create({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages,
      output_config: { effort },
      // A safety classifier can decline a request on Opus 5. `fallbacks:
      // "default"` re-serves it on Anthropic's recommended fallback model
      // inside the same call instead of handing the user an empty reply.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // Always check stop_reason before reading content — on a refusal the
    // content array is empty (pre-output) or partial (mid-stream).
    if (res.stop_reason === 'refusal') {
      return NextResponse.json(
        { error: 'The model declined this request. Try rephrasing it.' },
        { status: 422 }
      );
    }

    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return NextResponse.json({ text, model: res.model });
  } catch (err) {
    // Never echo the raw error to the browser: SDK errors can quote the
    // request, and we do not want any part of the key in a response body.
    console.error('[api/generate]', err);

    if (err instanceof Anthropic.AuthenticationError) {
      return bad('The server-side Anthropic key was rejected.', 502);
    }
    if (err instanceof Anthropic.RateLimitError) {
      return bad('AI is busy right now. Please try again in a moment.', 429);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return bad('Could not reach the AI service.', 504);
    }
    if (err instanceof Anthropic.APIError) {
      return bad('The AI service returned an error.', 502);
    }
    return bad('Unexpected error while generating.', 500);
  }
}
