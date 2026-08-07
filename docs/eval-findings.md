# Aegis Agent — Evaluation Findings

## What was built

A document Q&A + structured "Brief" report workflow on top of Aegis Agent's
existing ReAct loop, evaluated with Braintrust against an 18-case dataset
grounded in the NIST AI Risk Management Framework 1.0 (a real, public ~46-page
PDF ingested via the app's own PDF pipeline).

## Dataset

18 cases across four categories (`evals/dataset.ts`):

- 6 direct factual questions (single-section answers)
- 5 multi-hop questions (require combining evidence from 2+ sections)
- 3 "not in the document" questions (should be declined, not hallucinated)
- 4 structured brief-generation requests

## Scorers

- **Factuality** (autoevals, LLM-graded) — correctness against the expected answer
- **CitationValidity** (programmatic) — every `[n]` citation must resolve to an actually-retrieved source
- **Completeness** (programmatic, brief cases only) — all four required sections present with content
- **SearchTrajectory** (heuristic) — multi-hop cases should show ≥2 distinct, non-duplicate search queries

## Before / after: the retriever returned the right chunks, but the agent never saw them

**Baseline** (experiments
[`aegis-agent-eval` / worktree-document-brief-eval-1786098054](https://www.braintrust.dev/app/codestair/p/aegis-agent-eval/experiments/worktree-document-brief-eval-1786098054)
and
[`aegis-agent-eval-briefs` / worktree-document-brief-eval-1786098054](https://www.braintrust.dev/app/codestair/p/aegis-agent-eval-briefs/experiments/worktree-document-brief-eval-1786098054),
`errors: 0` in both):

| Experiment | CitationValidity | Completeness | Factuality | SearchTrajectory |
|---|---|---|---|---|
| `aegis-agent-eval` (14 chat cases) | 100.00% | — | **37.14%** | 92.86% |
| `aegis-agent-eval-briefs` (4 brief cases) | 100.00% | 100.00% | **55.00%** | 100.00% |

Every scorer except Factuality was at or near ceiling. Citations always
resolved, briefs always had all four sections, and the trajectory heuristic
said the agent was searching plenty. Only the LLM grader disagreed — which is
the shape of a system that *looks* well-plumbed and is quietly wrong.

### Root cause

Neither the experiment summary nor the recorded spans carry the raw tool
observations (see "Where Braintrust falls short" below), so the investigation
was done programmatically instead: a throwaway script looped over
all 18 dataset cases, called `runReactAgent` / `runBriefAgent` directly (exactly
as `evals/agent.eval.ts` does), graded each result with the same `Factuality`
scorer, and dumped the case input, the agent's answer, every search query, the
**raw observation text handed back to the model**, and the grader's
`metadata.rationale`.

Three chat cases scored a hard 0 (autoevals' choice `"D"` — outright
disagreement). The worst was the simplest question in the whole dataset:

> **Q:** List the seven characteristics of a trustworthy AI system as defined in the AI RMF.
>
> **Agent:** "1. Accuracy 2. Explainability 3. Privacy 4. Robustness 5. Safety 6. Security 7. Transparency"
>
> **Grader rationale:** *"Missing from submission: Accountable and Fair - with Harmful Bias Managed explicitly are absent or merged … there is some disagreement in content."*

That is not the document's list — it is the model's own prior about "trustworthy
AI" in general. The reason became obvious from the dumped observation text. Here
is the *entire* body of what `search_knowledge` handed back for that query:

```
[1] NIST AI Risk Management Framework 1.0 (explicit-content)
user-content://nist-ai-risk-management-framework-1-0-1786031382522-2btytu
NIST AI 100-1 Artificial Intelligence Risk Management Framework (AI RMF 1.0) NIST AI 100-1 Artificial Intelligence Risk Management Framework (AI RM
```

The same ~140 characters of the PDF's **title page** came back for *every*
query in *every* case — "GOVERN 1.1 requirements", "Robustness definition AI
RMF", "next function after GOVERN", all of them. pgvector was doing its job and
returning the right chunks; the agent simply never saw them.

The bug was one line in `createSourceRegistry` (`src/lib/agent/index.ts`), which
formats retrieved sources into the observation text:

```ts
const body = cleanSourceText(source.snippet || source.content || source.title, 420);
```

`ResearchSource` carries both fields, and for a knowledge chunk they mean
different things:

- `content` — the retrieved chunk (~1200 chars, set from `chunk.text`)
- `snippet` — a **document-level preview** written once at ingest time by
  `createSnippet(normalizedText)` in `src/lib/rag/index.ts`, i.e. the first 147
  characters of the *whole file*, stored identically on all 102 chunk rows

Preferring `snippet` meant the observation was always the document's first
sentence. The agent had no retrieved evidence to reason over, so on every
document question it fell back to parametric memory. That single precedence
error explains all three zero-scoring cases, and it also explains why
`CitationValidity` stayed at a perfect 100% throughout: the citations pointed at
real retrieved sources, they just had nothing to do with the sentences they were
attached to. **A programmatic citation check verifies the plumbing, not the
grounding.**

Two contributing factors surfaced from the same dump:

1. **The observation body was capped at 420 chars** while chunks are 1200, so
   even after fixing the precedence the model would only see the first third of
   each chunk.
2. **The seeded document is ingested twice.** Querying `aegis_knowledge_chunks`
   showed two source IDs with 102 identical chunks each
   (`source-custom-1786031382522-2btytu` and `source-custom-1786093390847-lbi7rd`).
   With `retrieveKnowledge`'s default `limit = 3`, a top-3 search therefore
   returned roughly 1.5 *distinct* chunks. The app allows re-uploading the same
   file, so this is a realistic production condition, not just a dirty fixture.

### Fix

Three targeted changes, each measured separately:

1. **`src/lib/agent/index.ts` — prefer `content` over `snippet`** in
   `createSourceRegistry`, and raise the observation body cap from 420 to 1200
   (`OBSERVATION_BODY_MAX`) so a retrieved chunk isn't truncated to a third.
   Web results set `snippet === content` upstream, so the reordering is a no-op
   for `web_search`. The same precedence bug was fixed in the two deterministic
   no-LLM fallbacks (`synthesizeLocally` in `src/lib/agent/index.ts`,
   `synthesizeBriefLocally` in `src/lib/agent/brief.ts`), which are not exercised
   by the eval but had the identical defect.
2. **`src/lib/agent/index.ts` — a grounding instruction in `AGENT_SYSTEM_PROMPT`.**
   The refinement guidance was advisory ("You may call tools more than once");
   it now directs the agent to check that retrieved evidence covers every part
   of a multi-part question, to re-search with different wording if not, and —
   critically — to *say what it could not find rather than fill the gap from
   prior knowledge*.
3. **`src/lib/rag/index.ts` — `retrieveKnowledge`'s default `limit` 3 → 6**, so a
   multi-part question over a long document gets enough evidence even when
   duplicate ingestions eat half the slots.

None of these tell the model anything about the expected answers' wording; the
fix is to actually deliver retrieved evidence to the model, not to shape the
prose toward the reference text.

Measured on the local investigation harness (all 18 cases, same grader), the
distribution of autoevals' Factuality *choices* is the clearest read:

| Change set | Chat Factuality | Grader choices across all 18 cases |
|---|---|---|
| Baseline | 0.486 | **D×3**, A×2, B×12, E×1 |
| + fix 1 (content over snippet, 1200-char body) | 0.557 | **D×1**, B×17 |
| + fix 2 (grounding prompt) | 0.557 | **D×1**, A×2, B×14, C×1 |
| + fix 3 (retrieval depth 6) | 0.614 | **D×0**, A×2, B×15, C×1 |

`D` is "disagreement" — the grader's label for a hallucination. The baseline had
three; the final build has none. The residual `A`s ("subset") are cases where
the agent now *declines* a sub-question it could not retrieve evidence for
(e.g. "the first two categories of MAP are not explicitly detailed in the
excerpts I found") instead of inventing an answer. That is better behavior that
Factuality's rubric scores *lower* (0.4) than a confident superset (0.6).

**After fix** (experiments
[`aegis-agent-eval` / worktree-document-brief-eval-1786099973](https://www.braintrust.dev/app/codestair/p/aegis-agent-eval/experiments/worktree-document-brief-eval-1786099973)
and
[`aegis-agent-eval-briefs` / worktree-document-brief-eval-1786099973](https://www.braintrust.dev/app/codestair/p/aegis-agent-eval-briefs/experiments/worktree-document-brief-eval-1786099973),
`errors: 0` in both):

| Experiment | CitationValidity | Completeness | Factuality | SearchTrajectory |
|---|---|---|---|---|
| `aegis-agent-eval` (14 chat cases) | 100.00% (=) | — | **58.57%** (+21.43) | 64.29% (−28.57) |
| `aegis-agent-eval-briefs` (4 brief cases) | 100.00% (=) | 100.00% (=) | 55.00% (=) | 100.00% (=) |

The immediately preceding run
([worktree-document-brief-eval-1786099906](https://www.braintrust.dev/app/codestair/p/aegis-agent-eval/experiments/worktree-document-brief-eval-1786099906))
produced the same chat numbers (Factuality 58.57%, SearchTrajectory 64.29%), so
the chat result is stable across runs rather than a lucky sample.

### Regression cases

The two clearest baseline hallucinations are pinned in `evals/dataset.ts` with a
`"regression"` tag alongside their original tags:

- `["direct", "regression"]` — *"List the seven characteristics of a trustworthy AI system…"*, baseline Factuality **0** (`D`, wrong seven-item list from memory) → **1.0** (`C`, exact match, all seven of the document's terms).
- `["multi-hop", "regression"]` — *"How does the AI RMF define both 'Accuracy' and 'Robustness'…"*, baseline Factuality **0** (`D`; paraphrased definitions, filed under "Reliability" instead of the document's "Valid and Reliable") → **0.6** (`B`; now quotes the ISO/IEC TS 5723:2022 definitions verbatim and names "Valid and Reliable").

The `"regression"` tag is inert for scoring — `scoreSearchTrajectory` only
branches on `"multi-hop"` and `"not-in-doc"` — so it labels the cases without
changing how they are graded.

### The honest part: SearchTrajectory got *worse*

`SearchTrajectory` dropped from 92.86% to 64.29%, four multi-hop cases
regressing. That is a real number and it is not a bug in the fix — it is the
scorer measuring the wrong thing.

The heuristic scores a multi-hop case 1.0 only if the agent issued ≥2 distinct
searches. In the baseline, the "which function comes after GOVERN" case issued
**five**:

```
GOVERN function next function AI RMF first two categories or subcategories
GOVERN function next function AI RMF
next function after GOVERN AI RMF
functions sequence AI RMF after GOVERN
functions after GOVERN AI RMF
```

Five distinct strings, a perfect 1.0 — and every one of them returned the same
title-page text, so the agent was flailing, not refining. It then answered from
memory and scored Factuality 0. After the fix the first search returns real
evidence, the agent answers in one pass, and the trajectory heuristic marks it
0. **The scorer was rewarding failure-driven retries.** Query count and
distinctness are cheap to compute and correlate with refinement only while
retrieval is broken; once it works, they invert. A scorer that actually captures
the intent would have to check whether the retrieved evidence covers each part
of the question — closer to a per-claim groundedness check than a trajectory
count.

## What Braintrust measures well

- **Experiment diffing is the product.** Every run automatically diffs against
  the previous experiment and reports per-scorer deltas *with improvement and
  regression counts* (`Factuality +21.43% / 6 improvements / 0 regressions`).
  The `SearchTrajectory −28.57% / 4 regressions` line is what surfaced the
  scorer-inversion finding above; a bare "58.57%" wouldn't have.
- **Mixing programmatic and LLM-graded scorers is frictionless.** `Factuality`
  from `autoevals` and three hand-written pure functions sit in the same
  `scores: []` array, return the same `{ name, score }` shape, and get the same
  treatment in the summary. Writing a custom scorer is just writing a function.
- **Errors are first-class.** `errors` / `llm_errors` / `tool_errors` are
  reported alongside scores, which is what caught the grader flake described
  below (`errors: 0.25` on one brief run) rather than letting it silently skew
  an average.
- **The TypeScript generics are real.** `Eval<Input, Output, Expected, Metadata>`
  types `args.output`, `args.expected`, and `args.metadata.tags` end to end, so
  scorers type-check against the agent's actual return shape.
- **Zero-config git integration.** Experiments are auto-named from the branch
  (`worktree-document-brief-eval-<ts>`), so every run is traceable to a commit
  without any setup.

## Where Braintrust falls short for this kind of eval

- **Nothing pushes you to trace what the agent actually saw.** The single most
  important artifact in this investigation was the raw observation string
  returned by `search_knowledge` — and it was in neither the experiment summary
  nor the spans. This repo wraps every tool call in `traced()`
  ([src/lib/observability](../src/lib/observability/index.ts)) and passes the
  *query* as span metadata, but `traced()` does not capture a plain function's
  return value as span output, so the observation was silently absent; recording
  it requires an explicit `span.log({ output })` that nothing in the API shape
  prompts you to write. The entire root-cause analysis therefore ran on a
  throwaway local script that called the agent directly and printed the
  observations. For single-turn Q&A the input/output pair is the whole story;
  for an agent, the tool observations *are* the story, and the ergonomics should
  make capturing them the default rather than an opt-in you only discover you
  needed after a bad run.
- **Scores are per-case aggregates, so a trajectory has no shape.** Braintrust
  gives one number per scorer per case. "Did the agent refine its search
  usefully?" is a property of a *sequence* of steps, and the only way to express
  it here was to flatten the sequence into a scalar heuristic — which, as shown
  above, inverted the moment retrieval started working. There is no built-in
  primitive for scoring a step sequence.
- **`autoevals`' `Factuality` rubric is a poor fit for cited document answers.**
  Its five buckets cap a correct, well-grounded, appropriately-detailed answer at
  **0.6** ("submission is a superset of the expert answer"), because a good RAG
  answer is almost always longer than a one-line reference. 15 of 18 final cases
  landed on that bucket, which compresses the entire dynamic range of the metric
  into 0.4/0.6/1.0 and makes the headline percentage more a measure of verbosity
  than of correctness. Worse, it is *anti-aligned* on one axis that matters here:
  an agent that honestly says "the document doesn't cover this" scores 0.4
  (subset), below a confident superset at 0.6 — the metric mildly penalizes
  exactly the behavior a document-grounded agent should have. The choice
  distribution (`D` counts) turned out to be far more informative than the mean,
  and reading it required going outside the dashboard.
- **`Factuality`'s default model routing is a trap.** It defaults to
  `gpt-5-mini` and, whenever `BRAINTRUST_API_KEY` is set, silently routes
  through Braintrust's AI proxy instead of OpenAI. If that model isn't enabled
  under the org's *Settings → AI Providers*, every grader call 404s with
  `no provider configured for 'gpt-5-mini'` — and the scorer simply **doesn't
  appear** in the summary table rather than failing loudly. The first baseline
  run looked complete apart from a quiet `errors: 2 / llm_errors: 1`. The fix is
  to pass an explicit `client` and `model` to every `Factuality(...)` call
  (see `evals/agent.eval.ts`), but the failure mode is a missing row, which is
  easy to miss.
- **The LLM grader is flaky and the flake is silent-ish.** Across six full runs,
  `Factuality` intermittently threw `Unknown score choice undefined` — its
  response parser failing on a grader reply that didn't contain a parseable
  choice. It hit roughly 1 case in 18, non-deterministically, and dropped that
  case from the average (`errors: 0.25` on one brief experiment). There is no
  built-in retry for a scorer that fails to parse.
- **Small-N noise is unguarded.** With 4 brief cases, one case moving one
  Factuality bucket swings the experiment average by 5 percentage points, and
  Braintrust reports that as a coloured regression indistinguishable from a real
  one. Nothing in the tooling flags a delta as within-noise, so distinguishing
  signal from sampling required re-running the suite and comparing two
  consecutive experiments by hand.

## Running this yourself

1. `npm install`
2. Add `OPENAI_API_KEY`, `DATABASE_URL` (optional, else in-memory fallback), and `BRAINTRUST_API_KEY` to `.env.local`
3. `npm run seed:knowledge` — ingests the demo document
4. `npm run dev` — try the chat and Brief mode in the browser
5. `npm test` — pure-logic unit tests (parser, scorers, chunking)
6. `npm run eval` — full Braintrust evaluation run
