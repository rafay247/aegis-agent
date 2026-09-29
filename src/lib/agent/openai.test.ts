import { test } from "node:test";
import assert from "node:assert/strict";
import { readStreamedMessage } from "./openai";

function sse(events: unknown[], splitAt = 7) {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  const bytes = new TextEncoder().encode(text);
  // Deliberately split mid-line to exercise buffering.
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += splitAt) {
        controller.enqueue(bytes.slice(i, i + splitAt));
      }
      controller.close();
    }
  });
}

test("streams answer text through the callback and returns the full message", async () => {
  const pieces: string[] = [];
  const message = await readStreamedMessage(
    sse([
      { choices: [{ delta: { role: "assistant", content: "" } }] },
      { choices: [{ delta: { content: "Hello" } }] },
      { choices: [{ delta: { content: " world [1]." } }] }
    ]),
    (text) => pieces.push(text)
  );

  assert.deepEqual(pieces, ["Hello", " world [1]."]);
  assert.equal(message.content, "Hello world [1].");
  assert.equal(message.tool_calls, undefined);
});

test("assembles tool calls from fragmented deltas", async () => {
  const message = await readStreamedMessage(
    sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "web_search", arguments: "" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"node lts"}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: "call_2", function: { name: "web_search", arguments: '{"query":"x"}' } }] } }] }
    ]),
    () => assert.fail("no text expected")
  );

  assert.equal(message.content, null);
  assert.deepEqual(
    message.tool_calls?.map((call) => [call.id, call.function.name, JSON.parse(call.function.arguments).query]),
    [
      ["call_1", "web_search", "node lts"],
      ["call_2", "web_search", "x"]
    ]
  );
});
