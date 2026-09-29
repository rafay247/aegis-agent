import { getRedisClient } from "@/lib/memory/client";

// Fixed-window rate limiting on Redis (Upstash in production): one counter
// per bucket + client that expires with its window. Like every other Redis
// use in the app it falls back to in-process state when Redis is unreachable
// — weaker on serverless (each instance counts separately) but still a limit.

type CounterStore = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number | boolean>;
  ttl(key: string): Promise<number>;
};

export type RateLimitRule = {
  bucket: string;
  id: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

// Minimal in-process CounterStore with the same semantics as Redis.
export function createMemoryCounterStore(now: () => number = Date.now): CounterStore {
  const counters = new Map<string, { count: number; expiresAt: number | null }>();

  function live(key: string) {
    const entry = counters.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= now()) {
      counters.delete(key);
      return undefined;
    }
    return entry;
  }

  return {
    async incr(key) {
      const entry = live(key) ?? { count: 0, expiresAt: null };
      entry.count += 1;
      counters.set(key, entry);
      return entry.count;
    },
    async expire(key, seconds) {
      const entry = live(key);
      if (!entry) {
        return 0;
      }
      entry.expiresAt = now() + seconds * 1000;
      return 1;
    },
    async ttl(key) {
      const entry = live(key);
      if (!entry) {
        return -2;
      }
      return entry.expiresAt === null ? -1 : Math.ceil((entry.expiresAt - now()) / 1000);
    }
  };
}

export function createRateLimiter(
  getStore: () => Promise<CounterStore | null>,
  fallbackStore: CounterStore = createMemoryCounterStore()
) {
  return async function checkRateLimit(rule: RateLimitRule): Promise<RateLimitResult> {
    let store: CounterStore | null = null;
    try {
      store = await getStore();
    } catch {
      store = null;
    }

    try {
      return await countRequest(store ?? fallbackStore, rule);
    } catch {
      // Redis failed mid-request: count in-process instead.
      return countRequest(fallbackStore, rule);
    }
  };
}

async function countRequest(
  store: CounterStore,
  { bucket, id, limit, windowSeconds }: RateLimitRule
): Promise<RateLimitResult> {
  const key = `aegis:ratelimit:${bucket}:${id}`;
  const hits = await store.incr(key);
  let ttl = hits === 1 ? -1 : await store.ttl(key);
  if (ttl < 0) {
    // First hit in the window, or a counter that somehow lost its expiry.
    await store.expire(key, windowSeconds);
    ttl = windowSeconds;
  }

  return {
    allowed: hits <= limit,
    limit,
    remaining: Math.max(0, limit - hits),
    retryAfterSeconds: hits <= limit ? 0 : ttl
  };
}

export const checkRateLimit = createRateLimiter(async () => getRedisClient());

export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

// Per-IP limits. Generous for a person using the app, tight enough that a
// script can't run up the OpenAI / Tavily bill.
export const rateLimits = {
  chat: { bucket: "chat", limit: 20, windowSeconds: 10 * 60 },
  upload: { bucket: "upload", limit: 20, windowSeconds: 60 * 60 },
  write: { bucket: "write", limit: 60, windowSeconds: 10 * 60 }
} as const;
