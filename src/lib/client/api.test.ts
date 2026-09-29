import { test } from "node:test";
import assert from "node:assert/strict";
import { readEventStream } from "./api";
import type { AgentStreamEvent } from "../../types";

test("readEventStream parses NDJSON events split across arbitrary chunks", async () => {
  const events: AgentStreamEvent[] = [
    { type: "tool_start", id: "s1", tool: "web_search", query: "node lts" },
    { type: "delta", text: "Node 24 is LTS [1]." },
    { type: "error", error: "boom" }
  ];
  const bytes = new TextEncoder().encode(events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 5) {
        controller.enqueue(bytes.slice(i, i + 5));
      }
      controller.close();
    }
  });

  const received: AgentStreamEvent[] = [];
  await readEventStream(body, (event) => received.push(event));
  assert.deepEqual(received, events);
});
