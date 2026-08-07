import { Eval } from "braintrust";
import { Factuality } from "autoevals";
import OpenAI from "openai";
import { runReactAgent } from "../src/lib/agent";
import { runBriefAgent } from "../src/lib/agent/brief";
import { listKnowledgeSources } from "../src/lib/rag";
import { chatCases, briefCases } from "./dataset";
import { scoreCitationValidity, scoreCompleteness, scoreNoHallucination, scoreSearchTrajectory } from "./scorers";

// Verified against the installed braintrust@3.27.0 SDK
// (node_modules/braintrust/dist/index.d.ts): `Eval<Input, Output, Expected,
// Metadata>` takes an `Evaluator` with `data`/`task`/`scores`, each score
// function receives `EvalScorerArgs = EvalCase<Input, Expected, Metadata> &
// { output: Output }`, i.e. `{ input, expected, metadata, output }` — the
// exact shape the brief's draft assumed. The only change from the brief's
// draft is replacing its `any`-typed args with real generics so `args.output`,
// `args.expected`, `args.input`, and `args.metadata.tags` are all type-checked
// instead of unchecked; the scoring logic itself is unchanged.
type CaseMetadata = { tags: string[] };

// autoevals' Factuality defaults to model "gpt-5-mini" and, when
// BRAINTRUST_API_KEY is set, routes the call through Braintrust's AI proxy —
// which 404s with "no provider configured for 'gpt-5-mini'" unless that
// model is separately enabled under the org's Braintrust Settings > AI
// Providers. We already have a working OPENAI_API_KEY (used elsewhere in
// this repo for answer synthesis), so pass an explicit OpenAI client and
// model to Factuality to call OpenAI directly and skip the proxy entirely.
const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const factualityModel = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

Eval<string, Awaited<ReturnType<typeof runReactAgent>>, string, CaseMetadata>("aegis-agent-eval", {
  data: () =>
    chatCases.map((testCase) => ({
      input: testCase.input,
      expected: testCase.expected,
      metadata: { tags: testCase.tags }
    })),
  task: async (input) => {
    const knowledgeCount = (await listKnowledgeSources()).length;
    return runReactAgent(input, [], false, knowledgeCount);
  },
  scores: [
    (args) =>
      Factuality({
        output: args.output.text,
        expected: args.expected,
        input: args.input,
        model: factualityModel,
        client: openaiClient
      }),
    (args) => scoreCitationValidity({ text: args.output.text, citations: args.output.citations }),
    (args) => scoreSearchTrajectory(args.output.steps, args.metadata?.tags ?? []),
    (args) =>
      scoreNoHallucination({
        input: args.input,
        output: args.output.text,
        expected: args.expected ?? "",
        tags: args.metadata?.tags ?? [],
        client: openaiClient,
        model: factualityModel
      })
  ]
});

Eval<string, Awaited<ReturnType<typeof runBriefAgent>>, string, CaseMetadata>("aegis-agent-eval-briefs", {
  data: () =>
    briefCases.map((testCase) => ({
      input: testCase.input,
      expected: testCase.expected,
      metadata: { tags: testCase.tags }
    })),
  task: async (input) => runBriefAgent(input),
  scores: [
    (args) =>
      Factuality({
        output: args.output.sections.map((section) => `${section.heading}: ${section.content}`).join("\n"),
        expected: args.expected,
        input: args.input,
        model: factualityModel,
        client: openaiClient
      }),
    (args) =>
      scoreCitationValidity({
        text: args.output.sections.map((section) => section.content).join(" "),
        citations: args.output.citations
      }),
    (args) => scoreCompleteness(args.output.sections),
    (args) => scoreSearchTrajectory(args.output.steps, args.metadata?.tags ?? [])
  ]
});
