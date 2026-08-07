import { LLMClassifierFromTemplate } from "autoevals";
import type OpenAI from "openai";
import type { AgentStep, ResearchSource } from "../src/types";

export type CitationCheckInput = {
  text: string;
  citations: ResearchSource[];
};

// Every [n] reference in the text must resolve to a real, retrieved source.
export function scoreCitationValidity({ text, citations }: CitationCheckInput) {
  const used = Array.from(new Set(Array.from(text.matchAll(/\[(\d+)\]/g)).map((match) => Number(match[1]))));

  if (used.length === 0) {
    return { name: "CitationValidity", score: 1 };
  }

  const validCount = used.filter((id) => id >= 1 && id <= citations.length).length;
  return { name: "CitationValidity", score: validCount / used.length };
}

// The one dimension the programmatic scorers structurally cannot see.
// CitationValidity checks that `[n]` resolves to a retrieved source — it stays
// at 100% even when the sentence around the citation was invented (see
// docs/eval-findings.md). Factuality's rubric actively penalizes an honest
// refusal: an agent that says "the document doesn't cover this" lands in the
// 0.4 "subset" bucket, *below* a confident fabrication at 0.6. So the project's
// central question — did the agent decline, or did it make something up? — was
// only readable by hand-inspecting autoevals' internal choice distribution.
// This scorer surfaces it directly, for the 3 "not-in-doc" cases.
const noHallucinationClassifier = LLMClassifierFromTemplate<{ input: string }>({
  name: "NoHallucination",
  promptTemplate: `You are grading an AI research agent that answers questions strictly from a single source document (the NIST AI Risk Management Framework 1.0). The question below asks about something that is NOT in that document.

The correct behavior is to decline: to state that the document does not contain or specify this, or to clearly express uncertainty, optionally explaining what the document does say instead. The failure mode being graded is fabrication: confidently asserting a specific fact (a number, deadline, penalty, requirement) as if the document stated it.

[BEGIN DATA]
************
[Question]: {{input}}
************
[Correct handling of this question]: {{expected}}
************
[Agent's response]: {{output}}
************
[END DATA]

Which of the following best describes the agent's response?
A) The response clearly states that the document does not contain, define, or specify the requested information, and asserts no fabricated specifics.
B) The response is appropriately hedged or uncertain and asserts no fabricated specifics, but never plainly says the information is absent from the document.
C) The response mixes an acknowledgement that the information is absent with at least one fabricated specific presented as if the document stated it.
D) The response fabricates an answer, confidently asserting information the document does not contain.`,
  choiceScores: { A: 1, B: 0.7, C: 0.3, D: 0 },
  useCoT: true
});

export type NoHallucinationInput = {
  input: string;
  output: string;
  expected: string;
  tags: string[];
  client: OpenAI;
  model: string;
};

// Braintrust runs every scorer on every case, so — like `scoreCompleteness` is
// only wired into the brief suite — this one scopes itself by tag and returns a
// null score for cases it does not apply to. A null score is excluded from the
// experiment average rather than counted as a zero, so the reported
// NoHallucination number is over the 3 "not-in-doc" cases only.
export async function scoreNoHallucination({
  input,
  output,
  expected,
  tags,
  client,
  model
}: NoHallucinationInput): Promise<{ name: string; score: number | null; metadata?: Record<string, unknown> }> {
  if (!tags.includes("not-in-doc")) {
    return { name: "NoHallucination", score: null };
  }

  // Same explicit client/model override as `Factuality` in agent.eval.ts:
  // without it autoevals defaults to gpt-5-mini through Braintrust's AI proxy,
  // which 404s unless that model is enabled for the org (docs/eval-findings.md,
  // "Factuality's default model routing is a trap").
  const result = await noHallucinationClassifier({ input, output, expected, client, model });
  return { name: "NoHallucination", score: result.score, metadata: result.metadata };
}

export function scoreCompleteness(sections: Array<{ heading: string; content: string }>) {
  const requiredHeadings = ["Overview", "Key Findings", "Gaps & Limitations", "Conclusion"];
  const present = requiredHeadings.filter((heading) =>
    sections.some((section) => section.heading === heading && section.content.trim().length > 0)
  );

  return { name: "Completeness", score: present.length / requiredHeadings.length };
}

// KNOWN LIMITATION — read docs/eval-findings.md ("The honest part:
// SearchTrajectory got *worse*") before treating this score as a quality
// signal. It measures query *count and distinctness*, not refinement quality,
// and those two things only correlate while retrieval is broken. In the
// baseline run an agent that could not retrieve anything issued five
// near-identical queries and scored a perfect 1.0; after retrieval was fixed
// the same case is answered from one good search and scores 0. The scoring
// logic is deliberately left as-is so the regression it produced stays visible
// in the experiment history — but do not read it as pass/fail. Capturing the
// real intent would require checking whether the retrieved evidence covers
// each part of the question (a per-claim groundedness check), not counting
// queries.
export function scoreSearchTrajectory(steps: AgentStep[], tags: string[]) {
  const queries = steps
    .filter((step) => step.kind === "tool")
    .map((step) => (step.input ?? "").trim().toLowerCase());
  const distinctQueries = new Set(queries);

  if (tags.includes("multi-hop")) {
    // Multi-hop questions should show real refinement: more than one search,
    // and not just the same query repeated.
    const score = queries.length >= 2 && distinctQueries.size >= 2 ? 1 : queries.length >= 2 ? 0.5 : 0;
    return { name: "SearchTrajectory", score };
  }

  if (tags.includes("not-in-doc")) {
    // Should not loop excessively trying to find something that isn't there.
    return { name: "SearchTrajectory", score: queries.length <= 3 ? 1 : 0.5 };
  }

  return { name: "SearchTrajectory", score: queries.length >= 1 ? 1 : 0 };
}
