import { env, hasRedisConfig } from "@/lib/env";
import { createClient } from "redis";

type AegisRedisClient = ReturnType<typeof createClient>;

declare global {
  var __aegisRedisClient__: AegisRedisClient | undefined;
  var __aegisRedisConnectPromise__: Promise<AegisRedisClient> | undefined;
}

export async function getRedisClient() {
  if (!hasRedisConfig()) {
    return null;
  }

  if (globalThis.__aegisRedisClient__?.isReady) {
    return globalThis.__aegisRedisClient__;
  }

  // With reconnectStrategy disabled, a client whose socket dropped (e.g. a
  // serverless instance frozen between requests) never recovers, yet its
  // resolved connect promise would keep handing it out and every command
  // would silently fall back to in-process memory. Start over instead.
  if (globalThis.__aegisRedisClient__ && !globalThis.__aegisRedisClient__.isOpen) {
    globalThis.__aegisRedisClient__ = undefined;
    globalThis.__aegisRedisConnectPromise__ = undefined;
  }

  if (!globalThis.__aegisRedisClient__) {
    const client = createClient({
      url: env.redisUrl,
      // Every other external call in this app degrades gracefully on a
      // timeout (see the AbortController guards in lib/agent/openai.ts and
      // lib/rag/embeddings.ts). Without these, an unreachable Redis host
      // hangs the connect() promise forever instead of ever rejecting.
      socket: {
        connectTimeout: 8_000,
        reconnectStrategy: false
      }
    });

    client.on("error", () => {
      // The memory layer falls back to in-process storage if Redis is unavailable.
    });

    globalThis.__aegisRedisClient__ = client;
  }

  if (!globalThis.__aegisRedisConnectPromise__) {
    const client = globalThis.__aegisRedisClient__;

    if (!client) {
      return null;
    }

    globalThis.__aegisRedisConnectPromise__ = client
      .connect()
      .then(() => client)
      .catch((error) => {
        globalThis.__aegisRedisConnectPromise__ = undefined;
        throw error;
      });
  }

  return globalThis.__aegisRedisConnectPromise__;
}
