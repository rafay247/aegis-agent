import { test } from "node:test";
import assert from "node:assert/strict";

// Nothing listens on port 1, so a fresh connect attempt fails fast.
process.env.REDIS_URL = "redis://127.0.0.1:1";

test("getRedisClient does not hand back a client whose connection has closed", async () => {
  const { getRedisClient } = await import("./client");

  // A serverless instance that was frozen between requests: the client
  // connected once, then its socket dropped, so it is no longer open.
  const deadClient = { isReady: false, isOpen: false } as never;
  globalThis.__aegisRedisClient__ = deadClient;
  globalThis.__aegisRedisConnectPromise__ = Promise.resolve(deadClient);

  let returned: unknown;
  try {
    returned = await getRedisClient();
  } catch {
    returned = undefined;
  }

  assert.notEqual(returned, deadClient);
});
