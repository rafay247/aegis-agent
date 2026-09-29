import { NextResponse } from "next/server";
import { getPostgresPool } from "@/lib/db/client";
import { hasDatabaseConfig, hasRedisConfig } from "@/lib/env";
import { getRedisClient } from "@/lib/memory/client";

type Check = { status: "ok" | "unavailable" | "not-configured"; latencyMs?: number; error?: string };

// Every integration degrades silently, so this is the one place that says
// whether Redis and Postgres are actually reachable. Only the error's type
// is reported, never connection details.
async function check(configured: boolean, probe: () => Promise<unknown>): Promise<Check> {
  if (!configured) {
    return { status: "not-configured" };
  }

  const startedAt = Date.now();
  try {
    await probe();
    return { status: "ok", latencyMs: Date.now() - startedAt };
  } catch (error) {
    const kind = error instanceof Error ? `${error.name}: ${error.message.split("\n")[0].slice(0, 80)}` : "unknown";
    return { status: "unavailable", latencyMs: Date.now() - startedAt, error: kind.replace(/\S+@\S+/g, "***") };
  }
}

export async function GET() {
  const [redis, postgres] = await Promise.all([
    check(hasRedisConfig(), async () => {
      const client = await getRedisClient();
      if (!client) {
        throw new Error("no client");
      }
      await client.ping();
    }),
    check(hasDatabaseConfig(), async () => {
      await getPostgresPool()?.query("SELECT 1;");
    })
  ]);

  return NextResponse.json({
    name: "Aegis",
    status: "ok",
    phase: "phase-3",
    checks: { redis, postgres },
    timestamp: new Date().toISOString()
  });
}
