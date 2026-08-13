/* ═══════════════════════════════════════════════════════════
   ai.ts — one copy of callClaude, instead of eight.

   The browser no longer talks to api.anthropic.com. It posts to our
   own /api/generate, which holds the key. Changing the model, the
   prompt shape, or the error handling is now a one-file edit.
═══════════════════════════════════════════════════════════ */

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export type CallOptions = {
  maxTokens?: number;
  /** low | medium | high | xhigh | max — deeper costs more and takes longer. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  signal?: AbortSignal;
};

/**
 * Same contract the eight copies had: returns the model's text, or a
 * "⚠️ …" string on failure so callers can render it straight into the UI.
 */
export async function callClaude(
  messages: ChatMessage[],
  system?: string,
  options: CallOptions = {}
): Promise<string> {
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        system,
        maxTokens: options.maxTokens,
        effort: options.effort,
      }),
      signal: options.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) return `⚠️ ${data.error || `Request failed (${res.status}).`}`;
    return data.text || '';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return '';
    return `⚠️ ${e instanceof Error ? e.message : 'Network error.'}`;
  }
}

/** Convenience wrapper for the common "one prompt in, text out" case. */
export function askClaude(prompt: string, system?: string, options?: CallOptions) {
  return callClaude([{ role: 'user', content: prompt }], system, options);
}

/** True when the reply is one of our error strings rather than model output. */
export function isAiError(text: string) {
  return text.startsWith('⚠️');
}
