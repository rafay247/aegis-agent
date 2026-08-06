import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "./index";

test("chunks long text without truncating before MAX_CHUNKS is reached", () => {
  const longText = "word ".repeat(30000); // ~150,000 chars, well under the 200-chunk cap
  const chunks = chunkText(longText);
  const normalizedInput = longText.replace(/\s+/g, " ").trim();
  const lastChunk = chunks[chunks.length - 1];

  assert.ok(chunks.length > 1);
  assert.ok(normalizedInput.endsWith(lastChunk.slice(-50)));
});

test("returns the whole text as a single chunk when under the chunk size", () => {
  const shortText = "A short document about AI risk.";
  assert.deepEqual(chunkText(shortText), [shortText]);
});
