# Document Brief + Evaluation Harness — Design

## Purpose

Aegis Agent is a working ReAct research agent (web search + RAG chat). This
project extends it to demonstrate a second, closely related competency for
client-facing portfolio purposes: single-document deep-dive workflows with
iterative search refinement, structured report generation, and a rigorous,
documented evaluation practice (dataset, scorers, regression tests,
before/after improvement, findings writeup) using Braintrust.

This mirrors a real Upwork job spec ("AI Agent Evaluation Developer for RAG
Document Workflow POC") closely enough to be shown to prospective clients as
evidence of having done this exact type of work.

## Decisions already made

- **Extend Aegis Agent in place** rather than build a separate demo repo —
  the eval work should read as a feature of a real product, not an isolated
  toy.
- **Braintrust** is the eval/tracing platform (over Plumloom or a fully
  custom harness) — first-class TypeScript SDK, fits the existing Next.js/TS
  stack, free tier.
- **Keep the hand-rolled ReAct agent loop**, not a rewrite onto LangChain.js
  or Google ADK. The job listing prefers those frameworks, but the design
  choice — and how it's presented — is to state plainly in the docs that
  this was built without a framework by design, and note it is a
  straightforward port to LangChain/ADK if a client's stack requires it.
  Framework-swapping the working agent loop is out of scope here.
- **Demo document**: one real public technical PDF, ingested through the
  existing PDF upload path (`addKnowledgeDocument`), not a toy fixture.
  Candidate: NIST AI Risk Management Framework 1.0 (~45 pages, clearly
  sectioned, freely available, answers are checkable against the source).
- Braintrust API key is provisioned in `.env.local` (gitignored) as
  `BRAINTRUST_API_KEY` / `BRAINTRUST_PROJECT`.

## Architecture

### 1. Seed script

`scripts/seed-knowledge.ts` — fetches/reads the demo PDF and calls the
existing `addKnowledgeDocument` ingestion path (same chunking/embedding code
the UI's PDF upload uses) so the knowledge base is pre-populated without
manual upload before every demo or eval run.

### 2. Brief mode (`src/lib/agent/brief.ts`)

A sibling to the existing `runReactAgent` (`src/lib/agent/index.ts`), not a
replacement:

- Tools: `search_knowledge` only (single-document scope; no web search).
- Iteration cap raised from 5 to ~8, since report generation legitimately
  needs more retrieval passes than a chat answer.
- System prompt explicitly instructs the model to self-assess evidence
  coverage per section, and if a section isn't well supported by what's been
  retrieved so far, to issue a *refined* follow-up query (different wording,
  narrower or reframed) before writing that section. This is what produces
  observable, scoreable "search → notice gap → refine" trajectories, rather
  than relying on incidental multi-calling.
- Output contract: `ResearchBrief` (new type in `src/types/index.ts`):
  ```ts
  type ResearchBrief = {
    title: string;
    sections: Array<{
      heading: "Overview" | "Key Findings" | "Gaps & Limitations" | "Conclusion";
      content: string; // inline [n] citations
      citationIds: number[];
    }>;
    citations: ResearchSource[];
    steps: AgentStep[];
  };
  ```
  Fixed required sections (rather than model-chosen headings) so
  completeness is mechanically checkable by a scorer.

### 3. API + UI

- `POST /api/brief` — `{ topic }` in, `ResearchBrief` out. Same
  persistence/degradation conventions as `/api/chat`.
- UI gets a "Generate Brief" mode alongside existing chat, rendering
  sections with inline citations.
- "Export trace" button downloads the run's `steps` array as JSON —
  satisfies "capture the full agent trace" directly, no new storage needed.

### 4. Trace enrichment

`AgentStep` (`src/types/index.ts`) gains: full query text (already present),
full observation text (currently only a summary/count), and timing
(`startedAt`/`durationMs`). This applies to both chat and brief steps, so
existing `ResearchRun` traces become genuinely complete, not just
summarized.

### 5. Observability wiring (Braintrust tracing)

`src/lib/observability/index.ts` is currently a disabled stub. It becomes a
real integration:

- `hasBraintrustConfig()` checks for `BRAINTRUST_API_KEY`.
- When configured, model calls and tool calls in both `runReactAgent` and
  `runBriefAgent` are wrapped in Braintrust's `traced()` spans.
- When not configured, this is fully inert — same graceful-degradation
  pattern as every other integration in this codebase (Redis, Postgres,
  Tavily, pgvector).
- Effect: live app runs *and* eval runs both produce Braintrust traces
  through the identical code path, so eval traces are representative of
  production behavior, not a separate instrumented copy.

## Evaluation harness

Lives at `evals/` at the repo root, outside the Next.js app. Calls
`runReactAgent` / `runBriefAgent` directly (function import, not HTTP) —
faster, and gives Braintrust's tracing full visibility into internal steps
without a network hop.

### Dataset (`evals/dataset.ts`, 18 cases)

| Category | Count | Tests |
|---|---|---|
| Direct factual questions (answerable from one section) | 6 | correctness, grounding |
| Multi-hop questions (evidence from 2+ sections) | 5 | search refinement/trajectory |
| "Not in the document" questions | 3 | honesty — should decline, not hallucinate |
| Brief-generation requests | 4 | structured completeness, citations |

Each case: `{ input, expected, tags }`.

### Scorers (`evals/scorers.ts`)

One per job-listed evaluation dimension:

- **Correctness** — LLM-graded via `autoevals`' Factuality scorer against
  the expected answer.
- **Grounding / citation validity** — programmatic: every `[n]` citation in
  the output must resolve to an actually-retrieved source in that run's
  `citations` array. Score = valid / total citations used.
- **Completeness** (brief cases only) — programmatic: all four required
  section headings present and non-empty.
- **Search trajectory** — heuristic over the `steps` array: multi-hop cases
  should show ≥2 distinct (non-duplicate) queries; single-fact and
  "not-in-doc" cases shouldn't loop needlessly.
- **No-hallucination** ("not in doc" cases only) — LLM-graded: did the agent
  correctly decline rather than fabricate an answer.

### Running evals

`npx braintrust eval evals/*.eval.ts` uploads results and traces to the
Braintrust project. `package.json` gets an `"eval"` script wrapping this.

### Before/after story

1. Run the baseline suite and record scores.
2. Inspect failures in the Braintrust UI; the most likely real failure mode
   given the current prompt is single-shot retrieval on multi-hop cases
   (no refinement).
3. Fix it in `runBriefAgent`'s prompt/loop logic.
4. Add the failing case as a pinned regression test in the dataset.
5. Re-run the suite, record the new scores, and capture the delta as the
   documented before/after improvement.

This must be a real observed failure and fix, not a staged one — if the
baseline run doesn't surface a genuine gap, the actual gap found (whatever
it is) becomes the documented one.

## Deliverables

Matches the job listing's deliverable list directly:

- **Source code** — all of the above, in this repo.
- **Setup instructions** — README section covering seed script, env vars,
  running the app, running evals.
- **Working document workflow** — the seeded document + chat + brief mode.
- **Exported traces** — Braintrust project link, plus one exported JSON
  trace checked into `docs/` as a static fallback artifact (in case a
  reviewer doesn't want to create a Braintrust account).
- **Evaluation dataset and results** — `evals/dataset.ts` plus a results
  summary in the findings doc.
- **Findings report** — `docs/eval-findings.md`: what was tested, the
  before/after scores and what changed, and an honest assessment of what
  Braintrust measures well versus where it falls short for this kind of
  agent trajectory evaluation. This last section is a required deliverable
  per the job listing, not optional color — it should include genuine
  friction points encountered, not just praise.

## Out of scope

- Rewriting the agent loop onto LangChain.js or Google ADK.
- Multi-document ingestion (job spec is single-document).
- Any change to the existing chat/web-search flow beyond trace-field
  enrichment shared with brief mode.
- Real-time trace streaming to the UI (export-on-demand is sufficient).

## Risks / open questions

- NIST AI RMF as the demo document is a placeholder choice pending a final
  look at its length/structure when seeding; if it turns out to be a poor
  fit (too short, not enough checkable facts, too repetitive), swap for
  another public technical PDF of similar scope during implementation.
- Braintrust's Factuality/LLM-graded scorers cost additional OpenAI calls
  per eval run; acceptable for an 18-case dataset run occasionally, not
  meant to run on every commit.
