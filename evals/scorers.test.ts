import { test } from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { scoreCitationValidity, scoreCompleteness, scoreNoHallucination, scoreSearchTrajectory } from "./scorers";

test("scoreCitationValidity gives full score when every citation resolves", () => {
  const result = scoreCitationValidity({
    text: "The system must be reliable [1] and safe [2].",
    citations: [
      { id: "a", title: "A", url: "u1", domain: "d1", snippet: "", kind: "knowledge" },
      { id: "b", title: "B", url: "u2", domain: "d2", snippet: "", kind: "knowledge" }
    ]
  });
  assert.equal(result.score, 1);
});

test("scoreCitationValidity penalizes a dangling citation index", () => {
  const result = scoreCitationValidity({
    text: "This claim cites a source that does not exist [5].",
    citations: [{ id: "a", title: "A", url: "u1", domain: "d1", snippet: "", kind: "knowledge" }]
  });
  assert.equal(result.score, 0);
});

test("scoreCitationValidity scores 1 when no citations were used or expected", () => {
  const result = scoreCitationValidity({ text: "No citations here.", citations: [] });
  assert.equal(result.score, 1);
});

test("scoreCompleteness scores 1 when all four required sections have content", () => {
  const result = scoreCompleteness([
    { heading: "Overview", content: "x" },
    { heading: "Key Findings", content: "y" },
    { heading: "Gaps & Limitations", content: "z" },
    { heading: "Conclusion", content: "w" }
  ]);
  assert.equal(result.score, 1);
});

test("scoreCompleteness penalizes a missing section", () => {
  const result = scoreCompleteness([
    { heading: "Overview", content: "x" },
    { heading: "Key Findings", content: "y" },
    { heading: "Gaps & Limitations", content: "" },
    { heading: "Conclusion", content: "w" }
  ]);
  assert.equal(result.score, 0.75);
});

test("scoreSearchTrajectory rewards refined, distinct queries on multi-hop cases", () => {
  const steps = [
    { id: "1", kind: "tool" as const, tool: "search_knowledge" as const, input: "AI RMF functions", summary: "" },
    { id: "2", kind: "tool" as const, tool: "search_knowledge" as const, input: "MAP function categories", summary: "" }
  ];
  assert.equal(scoreSearchTrajectory(steps, ["multi-hop"]).score, 1);
});

test("scoreSearchTrajectory penalizes a repeated near-identical query on multi-hop cases", () => {
  const steps = [
    { id: "1", kind: "tool" as const, tool: "search_knowledge" as const, input: "AI RMF functions", summary: "" },
    { id: "2", kind: "tool" as const, tool: "search_knowledge" as const, input: "ai rmf functions", summary: "" }
  ];
  assert.equal(scoreSearchTrajectory(steps, ["multi-hop"]).score, 0.5);
});

test("scoreSearchTrajectory doesn't penalize a single search on a direct-fact case", () => {
  const steps = [
    { id: "1", kind: "tool" as const, tool: "search_knowledge" as const, input: "GOVERN 1.1", summary: "" }
  ];
  assert.equal(scoreSearchTrajectory(steps, ["direct"]).score, 1);
});

// The grading path itself needs a live model, so the unit test covers only the
// tag scoping: a non-"not-in-doc" case must short-circuit to a null score
// *without* calling the LLM (a stub client that would throw if touched).
test("scoreNoHallucination returns a null score and makes no model call off-tag", async () => {
  const throwingClient = new Proxy(
    {},
    {
      get() {
        throw new Error("scoreNoHallucination should not call the model for a non not-in-doc case");
      }
    }
  ) as OpenAI;

  const result = await scoreNoHallucination({
    input: "What are the four functions of the AI RMF Core?",
    output: "GOVERN, MAP, MEASURE, MANAGE.",
    expected: "GOVERN, MAP, MEASURE, and MANAGE.",
    tags: ["direct"],
    client: throwingClient,
    model: "gpt-4.1-mini"
  });

  assert.equal(result.name, "NoHallucination");
  assert.equal(result.score, null);
});
