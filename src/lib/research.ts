'use client';

export type ResearchResult = {
  configured: boolean;
  summary?: string;
  sources?: { title: string; url: string }[];
};

export async function researchCompany(
  query: string,
  location?: string
): Promise<ResearchResult> {
  try {
    const response = await fetch('/api/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, location }),
    });
    const body = (await response.json().catch(() => ({}))) as ResearchResult & { error?: string };
    if (response.status === 503 && body.configured === false) return { configured: false };
    if (!response.ok) throw new Error(body.error || `Research failed (${response.status}).`);
    return body;
  } catch {
    return { configured: false };
  }
}
