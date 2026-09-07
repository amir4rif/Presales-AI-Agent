import 'server-only';

import type { DataSource } from '@/lib/integrations';

export type AnthropicEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type AiProvider = 'gemini' | 'anthropic';

const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';
const DEFAULT_ANTHROPIC_EFFORT: AnthropicEffort = 'medium';
const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const DEFAULT_LARK_BASE_URL = 'https://open.larksuite.com';
const PLACEHOLDER = /^(?:paste|replace|your|todo|changeme|example|<|\{)/i;
const EFFORTS = new Set<AnthropicEffort>(['low', 'medium', 'high', 'xhigh', 'max']);

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value || PLACEHOLDER.test(value)) return undefined;
  return value;
}

function positiveInt(name: string, fallback: number, ceiling: number): number {
  const value = Number(env(name));
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, ceiling);
}

function dataSource(): DataSource {
  const value = env('DATA_SOURCE') || env('NEXT_PUBLIC_DATA_SOURCE') || 'seed';
  return value === 'supabase' ? 'supabase' : 'seed';
}

function aiProvider(): AiProvider {
  return env('AI_PROVIDER') === 'anthropic' ? 'anthropic' : 'gemini';
}

function effort(): AnthropicEffort {
  const value = env('ANTHROPIC_EFFORT') as AnthropicEffort | undefined;
  return value && EFFORTS.has(value) ? value : DEFAULT_ANTHROPIC_EFFORT;
}

function larkBaseUrl(): string {
  const raw = env('LARK_BASE_URL') || DEFAULT_LARK_BASE_URL;
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return DEFAULT_LARK_BASE_URL;
  }
}

export function getAnthropicConfig() {
  return {
    apiKey: env('ANTHROPIC_API_KEY'),
    model: env('ANTHROPIC_MODEL') || DEFAULT_ANTHROPIC_MODEL,
    effort: effort(),
    defaultMaxTokens: positiveInt('ANTHROPIC_DEFAULT_MAX_TOKENS', 4096, 64_000),
    maxTokensCeiling: positiveInt('ANTHROPIC_MAX_TOKENS', 16_000, 128_000),
    timeoutMs: positiveInt('ANTHROPIC_TIMEOUT_MS', 90_000, 300_000),
  };
}

export function getAnthropicStatus() {
  const config = getAnthropicConfig();
  const missing = config.apiKey ? [] : ['ANTHROPIC_API_KEY'];
  return {
    configured: missing.length === 0,
    model: config.model,
    effort: config.effort,
    missing,
  };
}

export function getGeminiConfig() {
  return {
    apiKey: env('GEMINI_API_KEY'),
    model: env('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL,
    defaultMaxTokens: positiveInt('GEMINI_DEFAULT_MAX_TOKENS', 4096, 65_536),
    maxTokensCeiling: positiveInt('GEMINI_MAX_TOKENS', 16_000, 65_536),
    timeoutMs: positiveInt('GEMINI_TIMEOUT_MS', 90_000, 300_000),
  };
}

export function getAiConfig() {
  const provider = aiProvider();
  return provider === 'anthropic'
    ? { provider, ...getAnthropicConfig() }
    : { provider, ...getGeminiConfig() };
}

export function getAiStatus() {
  const config = getAiConfig();
  const missing = config.apiKey
    ? []
    : [config.provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY'];
  return {
    configured: missing.length === 0,
    provider: config.provider,
    model: config.model,
    missing,
  };
}

export function getSupabaseConfig() {
  return {
    url: env('NEXT_PUBLIC_SUPABASE_URL'),
    publishableKey: env('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    dataSource: dataSource(),
  };
}

export function getSupabaseStatus() {
  const config = getSupabaseConfig();
  const missing = [
    !config.url && 'NEXT_PUBLIC_SUPABASE_URL',
    !config.publishableKey && 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  ].filter((name): name is string => Boolean(name));
  return {
    configured: missing.length === 0,
    ready: config.dataSource === 'seed' || missing.length === 0,
    dataSource: config.dataSource,
    missing: config.dataSource === 'supabase' ? missing : [],
  };
}

export function getResearchConfig() {
  return {
    // Deliberately separate from proposal generation. For quota isolation this
    // key must belong to a separate Cloud project; Gemini quotas are per project.
    apiKey: env('RESEARCH_GEMINI_API_KEY'),
    model: env('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL,
    timeoutMs: positiveInt('RESEARCH_GEMINI_TIMEOUT_MS', 90_000, 300_000),
  };
}

export function getResearchStatus() {
  const config = getResearchConfig();
  return {
    configured: Boolean(config.apiKey),
    provider: 'Gemini with Google Search grounding' as const,
    model: config.model,
    missing: config.apiKey ? [] : ['RESEARCH_GEMINI_API_KEY'],
  };
}
export function getLarkConfig() {
  return {
    appId: env('LARK_APP_ID'),
    appSecret: env('LARK_APP_SECRET'),
    appToken: env('LARK_APP_TOKEN'),
    tableId: env('LARK_TABLE_ID'),
    primaryField: env('LARK_PRIMARY_FIELD'),
    baseUrl: larkBaseUrl(),
    timeoutMs: positiveInt('LARK_TIMEOUT_MS', 15_000, 120_000),
  };
}

export function getLarkStatus() {
  const config = getLarkConfig();
  const missing = [
    !config.appId && 'LARK_APP_ID',
    !config.appSecret && 'LARK_APP_SECRET',
    !config.appToken && 'LARK_APP_TOKEN',
    !config.tableId && 'LARK_TABLE_ID',
  ].filter((name): name is string => Boolean(name));

  const configured = Boolean(config.appId && config.appSecret && config.appToken);
  return {
    configured,
    ready: configured && Boolean(config.tableId),
    dataSource: 'inactive' as const,
    tableConfigured: Boolean(config.tableId),
    primaryFieldConfigured: Boolean(config.primaryField),
    missing,
  };
}
