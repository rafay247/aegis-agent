import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, createRateLimiter } from "./rate-limit";

function fakeRedis() {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();
  return {
    counts,
    async incr(key: string) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    async expire(key: string, seconds: number) {
      ttls.set(key, seconds);
      return 1;
    },
    async ttl(key: string) {
      return ttls.get(key) ?? -1;
    }
  };
}

test("allows requests up to the limit, then blocks with a retry-after", async () => {
  const redis = fakeRedis();
  const limit = createRateLimiter(async () => redis);

  const results = [];
  for (let i = 0; i < 4; i += 1) {
    results.push(await limit({ bucket: "chat", id: "1.2.3.4", limit: 3, windowSeconds: 60 }));
  }

  assert.deepEqual(results.map((result) => result.allowed), [true, true, true, false]);
  assert.equal(results[2].remaining, 0);
  assert.ok(results[3].retryAfterSeconds > 0 && results[3].retryAfterSeconds <= 60);
});

test("buckets and clients are counted separately", async () => {
  const redis = fakeRedis();
  const limit = createRateLimiter(async () => redis);

  await limit({ bucket: "chat", id: "a", limit: 1, windowSeconds: 60 });
  assert.equal((await limit({ bucket: "chat", id: "b", limit: 1, windowSeconds: 60 })).allowed, true);
  assert.equal((await limit({ bucket: "upload", id: "a", limit: 1, windowSeconds: 60 })).allowed, true);
});

test("still enforces limits in-process when Redis is unavailable or errors", async () => {
  for (const getStore of [
    async () => null,
    async () => {
      throw new Error("down");
    }
  ]) {
    const limit = createRateLimiter(getStore);
    const rule = { bucket: "chat", id: "a", limit: 2, windowSeconds: 60 };
    const results = [await limit(rule), await limit(rule), await limit(rule)];
    assert.deepEqual(results.map((result) => result.allowed), [true, true, false]);
    assert.ok(results[2].retryAfterSeconds > 0);
  }
});

test("clientIp prefers the first x-forwarded-for hop", () => {
  const request = new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } });
  assert.equal(clientIp(request), "203.0.113.7");
  assert.equal(clientIp(new Request("http://x")), "unknown");
});
