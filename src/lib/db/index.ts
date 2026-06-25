import { ensurePostgresSchema, getPostgresPool } from "@/lib/db/client";
import { getSessionState } from "@/lib/runtime-store";
import type { ChatMessage, ResearchRun } from "@/types";

export const databaseStatus = {
  connected: false,
  provider: getPostgresPool() ? "postgres-with-in-memory-fallback" : "in-memory-fallback"
};

async function touchSession(sessionId: string) {
  const pool = getPostgresPool();

  if (!pool) {
    return;
  }

  await pool.query(
    `
      INSERT INTO aegis_sessions (session_id)
      VALUES ($1)
      ON CONFLICT (session_id)
      DO UPDATE SET updated_at = NOW();
    `,
    [sessionId]
  );
}

export async function saveChatMessages(sessionId: string, messages: ChatMessage[]) {
  const pool = getPostgresPool();

  if (!pool || messages.length === 0) {
    return messages;
  }

  try {
    await ensurePostgresSchema();
    await touchSession(sessionId);

    for (const message of messages) {
      await pool.query(
        `
          INSERT INTO aegis_messages (id, session_id, role, content, created_at)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO NOTHING;
        `,
        [message.id, sessionId, message.role, message.content, message.createdAt]
      );
    }

    databaseStatus.connected = true;
  } catch {
    databaseStatus.connected = false;
  }

  return messages;
}

export async function deleteSessionData(sessionId: string) {
  const pool = getPostgresPool();

  if (!pool) {
    return;
  }

  try {
    await ensurePostgresSchema();
    await pool.query("DELETE FROM aegis_research_runs WHERE session_id = $1;", [sessionId]);
    await pool.query("DELETE FROM aegis_messages WHERE session_id = $1;", [sessionId]);
    await pool.query("DELETE FROM aegis_sessions WHERE session_id = $1;", [sessionId]);
    databaseStatus.connected = true;
  } catch {
    databaseStatus.connected = false;
  }
}

export async function listSessionMessages(sessionId: string, limit = 20) {
  const pool = getPostgresPool();

  if (!pool) {
    return getSessionState(sessionId).messages.slice(-limit);
  }

  try {
    await ensurePostgresSchema();
    const result = await pool.query<{
      id: string;
      role: ChatMessage["role"];
      content: string;
      created_at: string;
    }>(
      `
        SELECT id, role, content, created_at
        FROM aegis_messages
        WHERE session_id = $1
        ORDER BY created_at DESC
        LIMIT $2;
      `,
      [sessionId, limit]
    );

    databaseStatus.connected = true;

    return result.rows
      .reverse()
      .map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        createdAt: new Date(row.created_at).toISOString()
      }));
  } catch {
    databaseStatus.connected = false;
    return getSessionState(sessionId).messages.slice(-limit);
  }
}

export async function saveResearchRun(run: ResearchRun) {
  const pool = getPostgresPool();

  if (!pool) {
    return run;
  }

  try {
    await ensurePostgresSchema();
    await touchSession(run.sessionId);
    await pool.query(
      `
        INSERT INTO aegis_research_runs (
          id,
          session_id,
          question,
          answer,
          plan,
          citations,
          steps,
          created_at,
          used_model
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)
        ON CONFLICT (id) DO NOTHING;
      `,
      [
        run.id,
        run.sessionId,
        run.question,
        run.answer,
        JSON.stringify(run.plan),
        JSON.stringify(run.citations),
        JSON.stringify(run.steps ?? []),
        run.createdAt,
        run.usedModel
      ]
    );

    databaseStatus.connected = true;
  } catch {
    databaseStatus.connected = false;
  }

  return run;
}

export async function listResearchRuns(sessionId: string) {
  const pool = getPostgresPool();

  if (!pool) {
    return getSessionState(sessionId).runs;
  }

  try {
    await ensurePostgresSchema();
    const result = await pool.query<{
      id: string;
      session_id: string;
      question: string;
      answer: string;
      plan: ResearchRun["plan"];
      citations: ResearchRun["citations"];
      steps: ResearchRun["steps"];
      created_at: string;
      used_model: string;
    }>(
      `
        SELECT id, session_id, question, answer, plan, citations, steps, created_at, used_model
        FROM aegis_research_runs
        WHERE session_id = $1
        ORDER BY created_at DESC;
      `,
      [sessionId]
    );

    databaseStatus.connected = true;

    return result.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      question: row.question,
      answer: row.answer,
      plan: row.plan,
      citations: row.citations,
      steps: row.steps ?? [],
      createdAt: new Date(row.created_at).toISOString(),
      usedModel: row.used_model
    }));
  } catch {
    databaseStatus.connected = false;
    return getSessionState(sessionId).runs;
  }
}
