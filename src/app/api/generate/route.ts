import { NextResponse } from 'next/server';
import { AiProviderError, generateAi } from '@/lib/server/ai-provider';
import { getAiConfig, getAiStatus, type AnthropicEffort } from '@/lib/server/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 32_000;
const MAX_TOTAL_INPUT_CHARS = 120_000;
const MAX_SYSTEM_CHARS = 24_000;
const EFFORTS = new Set<AnthropicEffort>(['low', 'medium', 'high', 'xhigh', 'max']);

type Body = {
  messages?: { role: 'user' | 'assistant'; content: string }[];
  system?: string;
  maxTokens?: number;
  effort?: AnthropicEffort;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
/** Readiness only: this never calls either provider and never returns a key. */
export async function GET() {
  return json(getAiStatus());
}

export async function POST(request: Request) {
  const config = getAiConfig();
  if (!config.apiKey) {
    console.error(`[api/generate] ${config.provider} key is not configured`);
    return json({ error: 'AI is not configured on the server yet.' }, 503);
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Request body must be JSON.' }, 400);
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return json({ error: `\`messages\` must contain between 1 and ${MAX_MESSAGES} items.` }, 400);
  }

  let totalChars = 0;
  for (const message of messages) {
    if (
      !message ||
      (message.role !== 'user' && message.role !== 'assistant') ||
      typeof message.content !== 'string' ||
      message.content.length === 0 ||
      message.content.length > MAX_MESSAGE_CHARS
    ) {
      return json(
        { error: `Each message needs a valid role and 1-${MAX_MESSAGE_CHARS} characters.` },
        400
      );
    }
    totalChars += message.content.length;
  }
  if (totalChars > MAX_TOTAL_INPUT_CHARS) {
    return json({ error: 'The combined message input is too large.' }, 413);
  }
  if (body.system !== undefined && typeof body.system !== 'string') {
    return json({ error: '`system` must be a string.' }, 400);
  }
  if ((body.system?.length || 0) > MAX_SYSTEM_CHARS) {
    return json({ error: 'The system prompt is too large.' }, 413);
  }
  if (body.effort !== undefined && !EFFORTS.has(body.effort)) {
    return json({ error: 'Unsupported effort level.' }, 400);
  }

  const requestedMax = Number(body.maxTokens);
  const defaultMax = Math.min(config.defaultMaxTokens, config.maxTokensCeiling);
  const maxTokens = Number.isFinite(requestedMax)
    ? Math.min(Math.max(Math.trunc(requestedMax), 1), config.maxTokensCeiling)
    : defaultMax;
  const effort = body.effort || ('effort' in config ? config.effort : 'medium');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await generateAi({
      messages,
      system: body.system,
      maxTokens,
      effort,
      signal: controller.signal,
    });
    return json(response);
  } catch (error) {
    console.error('[api/generate] request failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      provider: error instanceof AiProviderError ? error.provider : config.provider,
      kind: error instanceof AiProviderError ? error.kind : undefined,
      status: error instanceof AiProviderError ? error.status : undefined,
    });

    if (error instanceof AiProviderError) {
      if (error.kind === 'timeout') return json({ error: 'The AI request timed out.' }, 504);
      if (error.kind === 'authentication') {
        return json({ error: `The server-side ${error.provider} key was rejected.` }, 502);
      }
      if (error.kind === 'rate_limit') {
        const message = error.provider === 'gemini'
          ? 'Gemini’s free-tier request limit has been reached. Please try again after the quota window resets.'
          : 'The AI request limit has been reached. Please try again later.';
        return json({ error: message }, 429);
      }
      if (error.kind === 'refusal') {
        return json({ error: 'The model declined this request. Try rephrasing it.' }, 422);
      }
      if (error.kind === 'connection') {
        return json({ error: `Could not reach ${error.provider}.` }, 504);
      }
      return json({ error: 'The AI service returned an error.' }, 502);
    }
    return json({ error: 'Unexpected error while generating.' }, 500);
  } finally {
    clearTimeout(timeout);
  }
}
