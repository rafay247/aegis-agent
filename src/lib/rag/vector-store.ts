import { getPostgresPool } from "@/lib/db/client";
import { EMBEDDING_DIMENSIONS } from "@/lib/rag/embeddings";
import type { ResearchSource, RetrievalChunk } from "@/types";

declare global {
  // Cache the schema-readiness probe across hot reloads.
  var __aegisVectorSchemaPromise__: Promise<boolean> | undefined;
}

export type ChunkInsert = {
  id: string;
  sourceId: string;
  source: ResearchSource;
  content: string;
  embedding: number[];
};

// pgvector accepts a vector as a bracketed literal, e.g. "[0.1,0.2,...]".
function toVectorLiteral(embedding: number[]) {
  return `[${embedding.join(",")}]`;
}

// Ensure the extension, table, and index exist. Returns false (and degrades to
// the in-memory keyword store) if Postgres or pgvector is unavailable.
async function ensureVectorSchema(): Promise<boolean> {
  const pool = getPostgresPool();
  if (!pool) {
    return false;
  }

  if (!globalThis.__aegisVectorSchemaPromise__) {
    globalThis.__aegisVectorSchemaPromise__ = (async () => {
      try {
        await pool.query("CREATE EXTENSION IF NOT EXISTS vector;");
        await pool.query(`
          CREATE TABLE IF NOT EXISTS aegis_knowledge_chunks (
            id TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            domain TEXT NOT NULL,
            snippet TEXT NOT NULL,
            content TEXT NOT NULL,
            embedding vector(${EMBEDDING_DIMENSIONS}) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `);
        await pool.query(`
          CREATE INDEX IF NOT EXISTS aegis_knowledge_chunks_embedding_idx
          ON aegis_knowledge_chunks USING hnsw (embedding vector_cosine_ops);
        `);
        return true;
      } catch {
        // Allow a later retry, but report unavailable for now.
        globalThis.__aegisVectorSchemaPromise__ = undefined;
        return false;
      }
    })();
  }

  return globalThis.__aegisVectorSchemaPromise__;
}

export async function vectorStoreReady(): Promise<boolean> {
  return ensureVectorSchema();
}

export async function insertChunks(chunks: ChunkInsert[]): Promise<boolean> {
  const pool = getPostgresPool();
  if (!pool || chunks.length === 0 || !(await ensureVectorSchema())) {
    return false;
  }

  try {
    for (const chunk of chunks) {
      await pool.query(
        `
          INSERT INTO aegis_knowledge_chunks
            (id, source_id, title, url, domain, snippet, content, embedding)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)
          ON CONFLICT (id) DO NOTHING;
        `,
        [
          chunk.id,
          chunk.sourceId,
          chunk.source.title,
          chunk.source.url,
          chunk.source.domain,
          chunk.source.snippet,
          chunk.content,
          toVectorLiteral(chunk.embedding)
        ]
      );
    }
    return true;
  } catch {
    return false;
  }
}

// Cosine-similarity search. `<=>` is pgvector's cosine-distance operator, so
// score = 1 - distance is the similarity (1 = identical).
export async function searchChunks(queryEmbedding: number[], limit: number): Promise<RetrievalChunk[] | null> {
  const pool = getPostgresPool();
  if (!pool || !(await ensureVectorSchema())) {
    return null;
  }

  try {
    const result = await pool.query<{
      id: string;
      source_id: string;
      title: string;
      url: string;
      domain: string;
      snippet: string;
      content: string;
      score: string;
    }>(
      `
        SELECT id, source_id, title, url, domain, snippet, content,
               1 - (embedding <=> $1::vector) AS score
        FROM aegis_knowledge_chunks
        ORDER BY embedding <=> $1::vector
        LIMIT $2;
      `,
      [toVectorLiteral(queryEmbedding), limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      text: row.content,
      score: Number(row.score),
      source: {
        id: row.source_id,
        title: row.title,
        url: row.url,
        domain: row.domain,
        snippet: row.snippet,
        content: row.content,
        kind: "knowledge"
      }
    }));
  } catch {
    return null;
  }
}

export async function listVectorSources(): Promise<ResearchSource[] | null> {
  const pool = getPostgresPool();
  if (!pool || !(await ensureVectorSchema())) {
    return null;
  }

  try {
    // One row per source, newest first.
    const result = await pool.query<{
      source_id: string;
      title: string;
      url: string;
      domain: string;
      snippet: string;
    }>(`
      SELECT source_id, title, url, domain, snippet
      FROM (
        SELECT DISTINCT ON (source_id)
          source_id, title, url, domain, snippet, created_at
        FROM aegis_knowledge_chunks
        ORDER BY source_id, created_at DESC
      ) latest
      ORDER BY latest.created_at DESC;
    `);

    return result.rows.map((row) => ({
      id: row.source_id,
      title: row.title,
      url: row.url,
      domain: row.domain,
      snippet: row.snippet,
      kind: "knowledge"
    }));
  } catch {
    return null;
  }
}
