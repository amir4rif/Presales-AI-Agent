import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { ApiError, GoogleGenAI } from '@google/genai';
import {
  getAiConfig,
  type AiProvider,
  type AnthropicEffort,
} from './config';

export type ProviderMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type GenerateOptions = {
  messages: ProviderMessage[];
  system?: string;
  maxTokens: number;
  effort: AnthropicEffort;
  signal: AbortSignal;
};

export type AiErrorKind =
  | 'authentication'
  | 'connection'
  | 'rate_limit'
  | 'refusal'
  | 'timeout'
  | 'upstream';

export class AiProviderError extends Error {
  constructor(
    public readonly kind: AiErrorKind,
    message: string,
    public readonly provider: AiProvider,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}
const THINKING_BUDGET: Record<AnthropicEffort, number> = {
  low: 512,
  medium: 2048,
  high: 4096,
  xhigh: 8192,
  max: 12288,
};

async function generateWithGemini(options: GenerateOptions) {
  const config = getAiConfig();
  if (config.provider !== 'gemini' || !config.apiKey) {
    throw new AiProviderError('authentication', 'Gemini is not configured.', 'gemini');
  }
  const client = new GoogleGenAI({
    apiKey: config.apiKey,
    httpOptions: { timeout: config.timeoutMs },
  });

  try {
    // Gemini counts thinking tokens against maxOutputTokens, so the visible
    // answer gets squeezed (and cut off mid-sentence) unless we budget extra
    // headroom for the thinking pass on top of what the caller asked for.
    const thinkingBudget = THINKING_BUDGET[options.effort];
    const response = await client.models.generateContent({
      model: config.model,
      contents: options.messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      config: {
        ...(options.system ? { systemInstruction: options.system } : {}),
        maxOutputTokens: options.maxTokens + thinkingBudget,
        thinkingConfig: { thinkingBudget },
        abortSignal: options.signal,
      },
    });
    const text = response.text?.trim();
    if (!text) {
      throw new AiProviderError('upstream', 'Gemini returned no text.', 'gemini');
    }
    if (response.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      throw new AiProviderError(
        'upstream',
        'Gemini response was cut off by the token limit. Try a shorter request or a higher maxTokens.',
        'gemini'
      );
    }
    return { text, model: config.model, provider: 'gemini' as const };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AiProviderError('timeout', 'Gemini request timed out.', 'gemini');
    }
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) {
        throw new AiProviderError('authentication', error.message, 'gemini', error.status);
      }
      if (error.status === 429) {
        throw new AiProviderError('rate_limit', error.message, 'gemini', error.status);
      }
      if (error.status === 408 || error.status >= 500) {
        throw new AiProviderError('connection', error.message, 'gemini', error.status);
      }
      throw new AiProviderError('upstream', error.message, 'gemini', error.status);
    }
    throw new AiProviderError(
      'connection',
      error instanceof Error ? error.message : 'Could not reach Gemini.',
      'gemini'
    );
  }
}

async function generateWithAnthropic(options: GenerateOptions) {
  const config = getAiConfig();
  if (config.provider !== 'anthropic' || !config.apiKey) {
    throw new AiProviderError('authentication', 'Anthropic is not configured.', 'anthropic');
  }
  const client = new Anthropic({ apiKey: config.apiKey });
  try {
    const response = await client.messages.create(
      {
        model: config.model,
        max_tokens: options.maxTokens,
        ...(options.system ? { system: options.system } : {}),
        messages: options.messages,
        output_config: { effort: options.effort },
      },
      { signal: options.signal }
    );
    if (response.stop_reason === 'refusal') {
      throw new AiProviderError('refusal', 'The model declined this request.', 'anthropic');
    }
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    if (!text) throw new AiProviderError('upstream', 'Anthropic returned no text.', 'anthropic');
    return { text, model: response.model, provider: 'anthropic' as const };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error instanceof Anthropic.APIUserAbortError ||
        (error instanceof DOMException && error.name === 'AbortError')) {
      throw new AiProviderError('timeout', 'Anthropic request timed out.', 'anthropic');
    }
    if (error instanceof Anthropic.AuthenticationError) {
      throw new AiProviderError('authentication', error.message, 'anthropic', error.status);
    }
    if (error instanceof Anthropic.RateLimitError) {
      throw new AiProviderError('rate_limit', error.message, 'anthropic', error.status);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new AiProviderError('connection', error.message, 'anthropic');
    }
    if (error instanceof Anthropic.APIError) {
      throw new AiProviderError('upstream', error.message, 'anthropic', error.status);
    }
    throw new AiProviderError('upstream', 'Unexpected Anthropic error.', 'anthropic');
  }
}

export function generateAi(options: GenerateOptions) {
  return getAiConfig().provider === 'anthropic'
    ? generateWithAnthropic(options)
    : generateWithGemini(options);
}
