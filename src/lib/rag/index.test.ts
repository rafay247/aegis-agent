import { test } from "node:test";
import assert from "node:assert/strict";
import { addKnowledgeDocument, chunkText, deleteKnowledgeDocument, listKnowledgeSources, retrieveKnowledge } from "./index";

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

test("deleteKnowledgeDocument removes a document so it is neither listed nor retrieved", async () => {
  const kept = await addKnowledgeDocument({ title: "Kept note", text: "The kept note mentions turnips." });
  const removed = await addKnowledgeDocument({ title: "Removed note", text: "The removed note mentions parsnips." });

  assert.equal(await deleteKnowledgeDocument(removed.id), true);

  const listedIds = (await listKnowledgeSources()).map((source) => source.id);
  assert.ok(listedIds.includes(kept.id));
  assert.ok(!listedIds.includes(removed.id));
  const retrievedIds = (await retrieveKnowledge("parsnips")).map((chunk) => chunk.source.id);
  assert.ok(!retrievedIds.includes(removed.id));
  assert.equal(await deleteKnowledgeDocument(removed.id), false);
});

test("documents are isolated per workspace: listing, retrieval and deletion", async () => {
  const mine = await addKnowledgeDocument({ title: "Mine", text: "Quokkas live on Rottnest Island.", workspaceId: "workspace-aaaaaaaaaaaaaaaa" });
  const theirs = await addKnowledgeDocument({ title: "Theirs", text: "Quokkas are marsupials.", workspaceId: "workspace-bbbbbbbbbbbbbbbb" });

  const listed = (await listKnowledgeSources("workspace-aaaaaaaaaaaaaaaa")).map((source) => source.id);
  assert.ok(listed.includes(mine.id));
  assert.ok(!listed.includes(theirs.id));

  const retrieved = (await retrieveKnowledge("quokkas", 6, "workspace-aaaaaaaaaaaaaaaa")).map((chunk) => chunk.source.id);
  assert.ok(!retrieved.includes(theirs.id));

  assert.equal(await deleteKnowledgeDocument(theirs.id, "workspace-aaaaaaaaaaaaaaaa"), false, "cannot delete another workspace's document");
  assert.ok((await listKnowledgeSources("workspace-bbbbbbbbbbbbbbbb")).some((source) => source.id === theirs.id));
});
