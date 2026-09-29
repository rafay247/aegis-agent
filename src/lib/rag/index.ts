import { EMBEDDING_MODEL, embedText, embedTexts } from "@/lib/rag/embeddings";
import { deleteVectorSource, insertChunks, listVectorSources, searchChunks, vectorStoreReady } from "@/lib/rag/vector-store";
import { DEMO_WORKSPACE } from "@/lib/workspace";
import type { ResearchSource, RetrievalChunk } from "@/types";

export const ragConfig = {
  provider: "pgvector-with-in-memory-fallback",
  embeddingModel: EMBEDDING_MODEL
};

type StoredChunk = RetrievalChunk & { workspaceId: string };

declare global {
  var __aegisKnowledgeBase__: StoredChunk[] | undefined;
}

// In-memory fallback store: used when pgvector/embeddings are unavailable.
// Each document is kept whole here and matched with naive token overlap.
// Kept on globalThis because every route handler is bundled separately, so a
// module-level array would give each route its own, disconnected copy.
const userKnowledgeBase: StoredChunk[] = (globalThis.__aegisKnowledgeBase__ ??= []);

// Chunking keeps embeddings focused and improves retrieval precision.
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
// 200 chunks comfortably covers a large single document (e.g. a 40-50 page PDF)
// without truncating the back half of it — see src/lib/rag/index.test.ts.
const MAX_CHUNKS = 200;

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

export function chunkText(text: string): string[] {
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

export async function addKnowledgeDocument({
  title,
  text,
  workspaceId = DEMO_WORKSPACE
}: {
  title: string;
  text: string;
  workspaceId?: string;
}): Promise<ResearchSource> {
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
  userKnowledgeBase.unshift({ id: `custom-${idSuffix}`, score: 0, text: normalizedText, source, workspaceId });

  // Vector path: chunk -> embed -> store in pgvector.
  if (await vectorStoreReady()) {
    const pieces = chunkText(normalizedText);
    const embeddings = await embedTexts(pieces);
    if (embeddings) {
      await insertChunks(
        pieces.map((content, index) => ({
          id: `${source.id}-chunk-${index}`,
          sourceId: source.id,
          workspaceId,
          source,
          content,
          embedding: embeddings[index]
        }))
      );
    }
  }

  return source;
}

// Removes a document from both stores. Returns false if neither had it.
export async function deleteKnowledgeDocument(sourceId: string, workspaceId = DEMO_WORKSPACE): Promise<boolean> {
  let removedFromMemory = false;
  for (let index = userKnowledgeBase.length - 1; index >= 0; index -= 1) {
    const chunk = userKnowledgeBase[index];
    if (chunk.source.id === sourceId && chunk.workspaceId === workspaceId) {
      userKnowledgeBase.splice(index, 1);
      removedFromMemory = true;
    }
  }

  const removedChunks = (await vectorStoreReady()) ? await deleteVectorSource(sourceId, workspaceId) : null;
  return removedFromMemory || (removedChunks ?? 0) > 0;
}

function workspaceChunks(workspaceId: string) {
  return userKnowledgeBase.filter((chunk) => chunk.workspaceId === workspaceId);
}

export async function listKnowledgeSources(workspaceId = DEMO_WORKSPACE): Promise<ResearchSource[]> {
  if (await vectorStoreReady()) {
    const sources = await listVectorSources(workspaceId);
    if (sources && sources.length > 0) {
      return sources;
    }
  }

  return workspaceChunks(workspaceId).map((chunk) => chunk.source);
}

function scoreText(query: string, text: string) {
  const normalizedQuery = query.toLowerCase();
  const tokens = normalizedQuery.split(/\W+/).filter((token) => token.length > 2);
  const normalizedText = text.toLowerCase();

  return tokens.reduce((score, token) => {
    return score + (normalizedText.includes(token) ? 1 : 0);
  }, 0);
}

function keywordRetrieve(query: string, limit: number, workspaceId: string): RetrievalChunk[] {
  const candidates = workspaceChunks(workspaceId).map(({ workspaceId: _workspaceId, ...chunk }) => chunk);
  const scoredChunks = candidates
    .map((chunk) => ({
      ...chunk,
      score: scoreText(query, `${chunk.text} ${chunk.source.title} ${chunk.source.snippet}`)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  if (scoredChunks.some((chunk) => chunk.score > 0)) {
    return scoredChunks.filter((chunk) => chunk.score > 0);
  }

  return candidates.slice(0, limit);
}

// Default depth of 6. Three ~1200-char chunks is not enough evidence for a
// multi-part question over a long document, and duplicate ingestions of the
// same file (which the app allows) can consume half the slots with identical
// text — see docs/eval-findings.md.
export async function retrieveKnowledge(query: string, limit = 6, workspaceId = DEMO_WORKSPACE): Promise<RetrievalChunk[]> {
  // Semantic retrieval via pgvector when available.
  if (await vectorStoreReady()) {
    const queryEmbedding = await embedText(query);
    if (queryEmbedding) {
      const hits = await searchChunks(queryEmbedding, limit, workspaceId);
      if (hits && hits.length > 0) {
        return hits;
      }
    }
  }

  // Fallback: in-memory token-overlap scoring.
  return keywordRetrieve(query, limit, workspaceId);
}
