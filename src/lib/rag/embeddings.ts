import { env, hasOpenAiConfig } from "@/lib/env";

// text-embedding-3-small returns 1536-dimensional vectors.
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

const EMBEDDING_TIMEOUT_MS = 20000;

// Embed a batch of texts in a single request. Returns null (rather than throwing)
// when embeddings are unavailable, so callers can fall back gracefully.
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!hasOpenAiConfig() || texts.length === 0) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBEDDING_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.openAiApiKey}`
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      data?: Array<{ index: number; embedding: number[] }>;
    };

    if (!data.data || data.data.length !== texts.length) {
      return null;
    }

    // The API may return items out of order; sort by index to align with inputs.
    return data.data.sort((left, right) => left.index - right.index).map((item) => item.embedding);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function embedText(text: string): Promise<number[] | null> {
  const result = await embedTexts([text]);
  return result?.[0] ?? null;
}
