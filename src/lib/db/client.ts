import { env, hasDatabaseConfig } from "@/lib/env";
import { Pool } from "pg";

declare global {
  var __aegisPostgresPool__: Pool | undefined;
  var __aegisPostgresSchemaPromise__: Promise<void> | undefined;
}

function createPool() {
  if (!hasDatabaseConfig()) {
    return null;
  }

  if (!globalThis.__aegisPostgresPool__) {
    globalThis.__aegisPostgresPool__ = new Pool({
      connectionString: env.databaseUrl,
      max: 10
    });
  }

  return globalThis.__aegisPostgresPool__;
}

export function getPostgresPool() {
  return createPool();
}

export async function ensurePostgresSchema() {
  const pool = createPool();

  if (!pool) {
    return;
  }

  if (!globalThis.__aegisPostgresSchemaPromise__) {
    globalThis.__aegisPostgresSchemaPromise__ = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS aegis_sessions (
          session_id TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS aegis_messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL,
          inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS aegis_messages_session_created_idx
        ON aegis_messages (session_id, created_at DESC);
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS aegis_research_runs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          question TEXT NOT NULL,
          answer TEXT NOT NULL,
          plan JSONB NOT NULL,
          citations JSONB NOT NULL,
          steps JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL,
          used_model TEXT NOT NULL,
          inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      // Keep older databases compatible with the agent-trace column.
      await pool.query(`
        ALTER TABLE aegis_research_runs
        ADD COLUMN IF NOT EXISTS steps JSONB NOT NULL DEFAULT '[]'::jsonb;
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS aegis_research_runs_session_created_idx
        ON aegis_research_runs (session_id, created_at DESC);
      `);
    })().catch((error) => {
      globalThis.__aegisPostgresSchemaPromise__ = undefined;
      throw error;
    });
  }

  await globalThis.__aegisPostgresSchemaPromise__;
}
