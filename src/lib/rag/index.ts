import { EMBEDDING_MODEL, embedText, embedTexts } from "@/lib/rag/embeddings";
import { insertChunks, listVectorSources, searchChunks, vectorStoreReady } from "@/lib/rag/vector-store";
import type { ResearchSource, RetrievalChunk } from "@/types";

export const ragConfig = {
  provider: "pgvector-with-in-memory-fallback",
  embeddingModel: EMBEDDING_MODEL
};

// In-memory fallback store: used when pgvector/embeddings are unavailable.
// Each document is kept whole here and matched with naive token overlap.
const userKnowledgeBase: RetrievalChunk[] = [];

// Chunking keeps embeddings focused and improves retrieval precision.
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS = 50;

function slugifyTitle(title: string) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function createSnippet(text: string) {
  const compactText = text.replace(/\s+/g, " ").trim();
  return compactText.length > 150 ? `${compactText.slice(0, 147)}...` : compactText;
}

function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= CHUNK_SIZE) {
    return clean ? [clean] : [];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < MAX_CHUNKS) {
    const end = Math.min(start + CHUNK_SIZE, clean.length);
    chunks.push(clean.slice(start, end));
    if (end === clean.length) {
      break;
    }
    start = end - CHUNK_OVERLAP;
  }

  return chunks;
}

export async function addKnowledgeDocument({ title, text }: { title: string; text: string }): Promise<ResearchSource> {
  const normalizedTitle = title.trim() || "Untitled source";
  const normalizedText = text.trim();
  const idSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceSlug = slugifyTitle(normalizedTitle) || "custom-source";
  const source: ResearchSource = {
    id: `source-custom-${idSuffix}`,
    title: normalizedTitle,
    url: `user-content://${sourceSlug}-${idSuffix}`,
    domain: "explicit-content",
    snippet: createSnippet(normalizedText),
    content: normalizedText,
    kind: "knowledge"
  };

  // Always keep an in-memory copy so retrieval still works if the vector path
  // is unavailable on read (mirrors the project's degrade-gracefully pattern).
  userKnowledgeBase.unshift({ id: `custom-${idSuffix}`, score: 0, text: normalizedText, source });

  // Vector path: chunk -> embed -> store in pgvector.
  if (await vectorStoreReady()) {
    const pieces = chunkText(normalizedText);
    const embeddings = await embedTexts(pieces);
    if (embeddings) {
      await insertChunks(
        pieces.map((content, index) => ({
          id: `${source.id}-chunk-${index}`,
          sourceId: source.id,
          source,
          content,
          embedding: embeddings[index]
        }))
      );
    }
  }

  return source;
}

export async function listKnowledgeSources(): Promise<ResearchSource[]> {
  if (await vectorStoreReady()) {
    const sources = await listVectorSources();
    if (sources && sources.length > 0) {
      return sources;
    }
  }

  return userKnowledgeBase.map((chunk) => chunk.source);
}

function scoreText(query: string, text: string) {
  const normalizedQuery = query.toLowerCase();
  const tokens = normalizedQuery.split(/\W+/).filter((token) => token.length > 2);
  const normalizedText = text.toLowerCase();

  return tokens.reduce((score, token) => {
    return score + (normalizedText.includes(token) ? 1 : 0);
  }, 0);
}

function keywordRetrieve(query: string, limit: number): RetrievalChunk[] {
  const scoredChunks = userKnowledgeBase
    .map((chunk) => ({
      ...chunk,
      score: scoreText(query, `${chunk.text} ${chunk.source.title} ${chunk.source.snippet}`)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  if (scoredChunks.some((chunk) => chunk.score > 0)) {
    return scoredChunks.filter((chunk) => chunk.score > 0);
  }

  return userKnowledgeBase.slice(0, limit);
}

export async function retrieveKnowledge(query: string, limit = 3): Promise<RetrievalChunk[]> {
  // Semantic retrieval via pgvector when available.
  if (await vectorStoreReady()) {
    const queryEmbedding = await embedText(query);
    if (queryEmbedding) {
      const hits = await searchChunks(queryEmbedding, limit);
      if (hits && hits.length > 0) {
        return hits;
      }
    }
  }

  // Fallback: in-memory token-overlap scoring.
  return keywordRetrieve(query, limit);
}
