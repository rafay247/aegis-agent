import { getRedisClient } from "@/lib/memory/client";

// Fixed-window rate limiting on Redis (Upstash in production): one counter
// per bucket + client that expires with its window. Like every other Redis
// use in the app it fails open — if Redis is unreachable, requests are allowed.

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

export function createRateLimiter(getStore: () => Promise<CounterStore | null>) {
  return async function checkRateLimit({ bucket, id, limit, windowSeconds }: RateLimitRule): Promise<RateLimitResult> {
    const open = { allowed: true, limit, remaining: limit, retryAfterSeconds: 0 };

    try {
      const store = await getStore();
      if (!store) {
        return open;
      }

      const key = `aegis:ratelimit:${bucket}:${id}`;
      const count = await store.incr(key);
      let ttl = count === 1 ? -1 : await store.ttl(key);
      if (ttl < 0) {
        // First hit in the window, or a counter that somehow lost its expiry.
        await store.expire(key, windowSeconds);
        ttl = windowSeconds;
      }

      return {
        allowed: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: count <= limit ? 0 : ttl
      };
    } catch {
      return open;
    }
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
