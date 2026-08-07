import { test } from "node:test";
import assert from "node:assert/strict";
import { createSourceRegistry } from "./index";
import type { ResearchSource } from "../../types";

test("registerSources prefers content (the retrieved chunk) over snippet (the document-level preview)", () => {
  const { registerSources } = createSourceRegistry();

  const source: ResearchSource = {
    id: "doc-1",
    title: "NIST AI RMF",
    url: "https://example.com/nist-ai-rmf",
    domain: "example.com",
    snippet: "Document title page preview...",
    content: "The actual retrieved chunk text with the real answer in it.",
    kind: "knowledge"
  };

  const observation = registerSources([source]);

  assert.ok(
    observation.includes("The actual retrieved chunk text with the real answer in it."),
    "observation should include the chunk-level content"
  );
  assert.ok(
    !observation.includes("Document title page preview..."),
    "observation should not include the document-level snippet when content is present"
  );
});

test("registerSources reuses the same citation index when the same source url is registered twice", () => {
  const { registerSources, sources } = createSourceRegistry();

  const source: ResearchSource = {
    id: "doc-1",
    title: "NIST AI RMF",
    url: "https://example.com/nist-ai-rmf",
    domain: "example.com",
    snippet: "Preview text",
    content: "Chunk one text.",
    kind: "knowledge"
  };

  const duplicate: ResearchSource = {
    ...source,
    content: "Chunk two text, a different chunk from the same document."
  };

  const firstObservation = registerSources([source]);
  const secondObservation = registerSources([duplicate]);

  assert.ok(firstObservation.startsWith("[1] "));
  assert.ok(secondObservation.startsWith("[1] "), "same url should reuse citation index [1]");
  assert.equal(sources.length, 1, "the registry should only track one unique source for the shared url");
});
