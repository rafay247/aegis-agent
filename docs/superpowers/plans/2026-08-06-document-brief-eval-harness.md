# Document Brief + Braintrust Evaluation Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Aegis Agent with a single-document "Brief" workflow (iterative search refinement + structured, cited report generation) and a Braintrust-based evaluation harness (18-case dataset, 5 scorers, before/after regression story, findings report) — a portfolio piece demonstrating the exact skillset described in a target Upwork job listing.

**Architecture:** A sibling agent path (`runBriefAgent`) reuses the existing hand-rolled ReAct loop's model/tool-calling primitives but is scoped to `search_knowledge` only, with a higher iteration cap and a prompt that forces explicit evidence-gap self-checks and query refinement. Both the existing chat path and the new brief path get enriched trace fields and optional Braintrust `traced()` spans (gated behind an env var, same graceful-degradation pattern as every other integration in this codebase). A standalone `evals/` directory calls these agent functions directly (no HTTP) and runs them through Braintrust's `Eval()` against a real, document-grounded dataset.

**Tech Stack:** Next.js 15 / TypeScript (existing), `braintrust` + `autoevals` (new), `tsx` + Node's built-in `node:test` for the handful of pure-logic unit tests (no test framework existed before this).

## Global Constraints

- Do **not** introduce LangChain.js, Google ADK, or any agent framework — the hand-rolled ReAct loop is being extended, not replaced (explicit project decision; see `docs/superpowers/specs/2026-08-06-document-brief-eval-design.md`).
- Every new external integration (Braintrust) must degrade silently when unconfigured — wrap in a `hasBraintrustConfig()` check and a try/catch, exactly like the existing Redis/Postgres/Tavily/pgvector integrations. Tracing must never throw or block the agent.
- `BRAINTRUST_API_KEY` and `BRAINTRUST_PROJECT` are already present in `.env.local` (gitignored) — do not print, log, or commit them.
- Import path alias `@/*` → `./src/*` applies inside `src/`; files under `evals/` and `scripts/` are outside the Next.js build and must use relative imports instead (verify `tsx` path resolution before relying on `@/*` there).
- Demo document: NIST AI Risk Management Framework 1.0 (`https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf`), ~106,500 characters of normalized text. All eval dataset facts in this plan were extracted directly from that PDF's real text (via `pdftotext -layout`) — they are real, checkable facts, not invented placeholders.
- No pre-existing test suite. New unit tests use Node's built-in test runner (`node --test`) via `tsx`, reserved for pure functions only (parsers, scorers, chunking). Agent/API-level behavior is still verified by running `npm run dev` and exercising routes, per existing project convention.
- Follow existing code conventions throughout: `cleanSourceText`-style defensive text cleanup, `createId(prefix)` for IDs, JSONB columns with `ADD COLUMN IF NOT EXISTS` for schema changes, no ORM.

---

### Task 1: Braintrust environment config

**Files:**
- Modify: `src/lib/env.ts`

**Interfaces:**
- Produces: `env.braintrustApiKey: string | undefined`, `env.braintrustProject: string`, `hasBraintrustConfig(): boolean` — consumed by Task 5 (observability) and Task 15 (eval suite).

- [ ] **Step 1: Add the Braintrust fields to `env` and a `hasBraintrustConfig` guard**

Edit `src/lib/env.ts`:

```ts
export const env = {
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  tavilyApiKey: process.env.TAVILY_API_KEY,
  pineconeApiKey: process.env.PINECONE_API_KEY,
  pineconeIndex: process.env.PINECONE_INDEX,
  redisUrl: process.env.REDIS_URL,
  databaseUrl: process.env.DATABASE_URL,
  braintrustApiKey: process.env.BRAINTRUST_API_KEY,
  braintrustProject: process.env.BRAINTRUST_PROJECT ?? "aegis-agent-eval"
};

export function hasOpenAiConfig() {
  return Boolean(env.openAiApiKey);
}

export function hasTavilyConfig() {
  return Boolean(env.tavilyApiKey);
}

export function hasRedisConfig() {
  return Boolean(env.redisUrl);
}

export function hasDatabaseConfig() {
  return Boolean(env.databaseUrl);
}

export function hasBraintrustConfig() {
  return Boolean(env.braintrustApiKey);
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/env.ts
git commit -m "Add Braintrust env config with graceful-degradation guard"
```

---

### Task 2: Eval tooling dependencies and scripts

**Files:**
- Modify: `package.json`

**Interfaces:**
- Produces: `braintrust` and `autoevals` importable from app/eval code; `npm run test`, `npm run eval`, `npm run seed:knowledge` scripts consumed by Tasks 6, 11, 15.

- [ ] **Step 1: Add dependencies**

Edit `package.json` — add `braintrust` to `dependencies` (it's used at runtime in `src/lib/observability`, not just in evals) and `autoevals` + `tsx` to `devDependencies`, keeping alphabetical order:

```json
{
  "name": "aegis",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "node --import tsx --test src/lib/agent/brief-sections.test.ts src/lib/rag/index.test.ts evals/scorers.test.ts",
    "eval": "npx braintrust eval evals/agent.eval.ts",
    "seed:knowledge": "node --import tsx scripts/seed-knowledge.ts"
  },
  "dependencies": {
    "braintrust": "^3.27.0",
    "next": "15.3.2",
    "pg": "^8.20.0",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "redis": "^5.12.1"
  },
  "devDependencies": {
    "@types/node": "22.15.29",
    "@types/pg": "^8.20.0",
    "@types/react": "19.1.6",
    "@types/react-dom": "19.1.5",
    "autoevals": "^0.3.0",
    "eslint": "9.27.0",
    "eslint-config-next": "15.3.2",
    "pdfjs-dist": "^6.0.227",
    "tailwindcss": "3.4.17",
    "tsx": "^4.23.9",
    "typescript": "5.8.3"
  }
}
```

Note: the `test` script lists explicit files rather than a glob, since this repo has only a handful of pure-logic test files and Node's glob support in `--test` varies by version — explicit paths are more portable. Add new test files to this list as they're created in later tasks (Tasks 6 and 4 add the two `src/` ones; Task 13 adds the `evals/` one).

- [ ] **Step 2: Install**

Run: `npm install`
Expected: installs succeed, `package-lock.json` updates, no peer-dependency errors.

- [ ] **Step 3: Verify the test script runs (even with no test files yet, this should fail clearly rather than silently)**

Run: `npm test`
Expected: FAIL — Node reports the listed files don't exist yet (`ENOENT` or "not found"). That's expected at this point in the plan; later tasks create them.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add braintrust, autoevals, and tsx for the eval harness"
```

---

### Task 3: Shared types for the Brief workflow

**Files:**
- Modify: `src/types/index.ts`

**Interfaces:**
- Produces: `BriefSectionHeading`, `BriefSection`, `ResearchBrief`, `BriefRequest`, `BriefResponse` types; extends `AgentStep` with `observation?`, `startedAt?`, `durationMs?`; extends `ResearchRun` with `brief?: ResearchBrief`. Consumed by every subsequent task.

- [ ] **Step 1: Extend `AgentStep` with full-trace fields**

In `src/types/index.ts`, replace:

```ts
export type AgentStep = {
  id: string;
  kind: AgentStepKind;
  tool?: "web_search" | "search_knowledge";
  input?: string;
  summary: string;
  resultCount?: number;
};
```

with:

```ts
export type AgentStep = {
  id: string;
  kind: AgentStepKind;
  tool?: "web_search" | "search_knowledge";
  input?: string;
  summary: string;
  resultCount?: number;
  observation?: string;
  startedAt?: string;
  durationMs?: number;
};
```

- [ ] **Step 2: Add the Brief types and extend `ResearchRun`**

In the same file, replace:

```ts
export type ResearchRun = {
  id: string;
  sessionId: string;
  question: string;
  answer: string;
  plan: AgentPlan;
  citations: ResearchSource[];
  steps?: AgentStep[];
  createdAt: string;
  usedModel: string;
};
```

with:

```ts
export type BriefSectionHeading = "Overview" | "Key Findings" | "Gaps & Limitations" | "Conclusion";

export type BriefSection = {
  heading: BriefSectionHeading;
  content: string;
  citationIds: number[];
};

export type ResearchBrief = {
  title: string;
  sections: BriefSection[];
  citations: ResearchSource[];
  steps: AgentStep[];
};

export type ResearchRun = {
  id: string;
  sessionId: string;
  question: string;
  answer: string;
  plan: AgentPlan;
  citations: ResearchSource[];
  steps?: AgentStep[];
  createdAt: string;
  usedModel: string;
  brief?: ResearchBrief;
};

export type BriefRequest = {
  sessionId: string;
  topic: string;
};

export type BriefResponse = {
  sessionId: string;
  brief: ResearchBrief;
  run: ResearchRun;
};
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new type errors (existing code that builds `AgentStep`/`ResearchRun` object literals only sets a subset of fields, which is fine since the new fields are all optional).

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts
git commit -m "Add ResearchBrief types and extend AgentStep/ResearchRun for full traces"
```

---

### Task 4: RAG ingestion capacity fix + shared PDF extraction

The current `MAX_CHUNKS = 50` cap in `src/lib/rag/index.ts` was sized for short pastes. The demo document (~106,500 normalized characters) needs ~102 chunks at the existing 1200-char/150-overlap settings — at the current cap, roughly the back half of the document (Measure, Manage, appendices) would silently never make it into the knowledge base, which would break several of the eval dataset's multi-hop and brief cases. This task also extracts the existing PDF-route's text-extraction logic into a shared module so the seed script (Task 11) can reuse the exact same extraction path instead of duplicating it.

**Files:**
- Modify: `src/lib/rag/index.ts`
- Test: `src/lib/rag/index.test.ts`
- Create: `src/lib/rag/pdf.ts`
- Modify: `src/app/api/sources/pdf/route.ts`

**Interfaces:**
- Produces: `chunkText(text: string): string[]` (now exported), `extractPdfText(data: Uint8Array): Promise<string>` — consumed by Task 11 (seed script).

- [ ] **Step 1: Write the failing test for chunking capacity**

Create `src/lib/rag/index.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test src/lib/rag/index.test.ts`
Expected: FAIL — `chunkText` is not exported from `./index` yet.

- [ ] **Step 3: Export `chunkText` and raise `MAX_CHUNKS`**

In `src/lib/rag/index.ts`, change:

```ts
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS = 50;
```

to:

```ts
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;
// 200 chunks comfortably covers a large single document (e.g. a 40-50 page PDF)
// without truncating the back half of it — see src/lib/rag/index.test.ts.
const MAX_CHUNKS = 200;
```

and change:

```ts
function chunkText(text: string): string[] {
```

to:

```ts
export function chunkText(text: string): string[] {
```

- [ ] **Step 4: Run the test again to verify it passes**

Run: `node --import tsx --test src/lib/rag/index.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Extract shared PDF text extraction**

Create `src/lib/rag/pdf.ts`:

```ts
type PdfTextItem = {
  str?: string;
};

// Shared by the PDF upload route and the demo-document seed script, so both
// paths extract text identically.
export async function extractPdfText(data: Uint8Array): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data }).promise;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => (item as PdfTextItem).str ?? "")
      .filter(Boolean)
      .join(" ");

    if (pageText.trim()) {
      pageTexts.push(pageText);
    }
  }

  return pageTexts.join("\n\n").trim();
}
```

- [ ] **Step 6: Update the PDF route to use the shared extractor**

In `src/app/api/sources/pdf/route.ts`, replace the whole file with:

```ts
import { NextResponse } from "next/server";
import { addKnowledgeDocument, listKnowledgeSources } from "@/lib/rag";
import { extractPdfText } from "@/lib/rag/pdf";

const maxPdfSources = 3;

export async function POST(request: Request) {
  const formData = await request.formData();
  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.type === "application/pdf")
    .slice(0, maxPdfSources);

  if (files.length === 0) {
    return NextResponse.json(
      {
        error: "Select at least one PDF file."
      },
      { status: 400 }
    );
  }

  const addedSources = [];

  for (const file of files) {
    const text = await extractPdfText(new Uint8Array(await file.arrayBuffer()));

    if (!text) {
      return NextResponse.json(
        {
          error: `${file.name} did not contain extractable text.`
        },
        { status: 400 }
      );
    }

    addedSources.push(
      await addKnowledgeDocument({
        title: file.name.replace(/\.pdf$/i, ""),
        text
      })
    );
  }

  return NextResponse.json({
    added: addedSources,
    sources: await listKnowledgeSources()
  });
}
```

- [ ] **Step 7: Manually verify PDF upload still works**

Run: `npm run dev`, open `http://localhost:3000`, attach a small PDF via the source panel.
Expected: upload succeeds and the source appears in the source list (same behavior as before this task).

- [ ] **Step 8: Add the new test file to the `test` script and commit**

Confirm `src/lib/rag/index.test.ts` is already listed in `package.json`'s `test` script from Task 2. Then:

```bash
git add src/lib/rag/index.ts src/lib/rag/index.test.ts src/lib/rag/pdf.ts src/app/api/sources/pdf/route.ts
git commit -m "Raise RAG chunk cap for large documents; share PDF extraction logic"
```

---

### Task 5: Real Braintrust tracing in observability

**Files:**
- Modify: `src/lib/observability/index.ts`

**Interfaces:**
- Consumes: `hasBraintrustConfig()`, `env.braintrustApiKey`, `env.braintrustProject` (Task 1).
- Produces: `tracedSpan<T>(name: string, fn: () => Promise<T>, metadata?: Record<string, unknown>): Promise<T>` — consumed by Task 7 (`runReactAgent`/`runFallback`) and Task 8 (`runBriefAgent`).

- [ ] **Step 1: Replace the observability stub with a real, gracefully-degrading tracer**

Replace the full contents of `src/lib/observability/index.ts` with:

```ts
import { env, hasBraintrustConfig } from "@/lib/env";

export const observabilityConfig = {
  provider: "braintrust",
  enabled: hasBraintrustConfig()
};

// Wraps a unit of agent work (a model call or tool call) in a Braintrust trace
// span. When Braintrust isn't configured, or the SDK call fails for any
// reason, this degrades to just running fn() — tracing must never break the
// agent, matching every other optional integration in this codebase.
export async function tracedSpan<T>(
  name: string,
  fn: () => Promise<T>,
  metadata?: Record<string, unknown>
): Promise<T> {
  if (!hasBraintrustConfig()) {
    return fn();
  }

  try {
    const { initLogger, traced } = await import("braintrust");
    initLogger({ projectName: env.braintrustProject, apiKey: env.braintrustApiKey });
    return await traced((span) => fn(), { name, event: metadata ? { metadata } : undefined });
  } catch {
    return fn();
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new type errors. If the `traced()` call signature doesn't match what's installed (Braintrust's TS API can shift between versions), check `node_modules/braintrust/dist/index.d.ts` for the current `traced` signature and adjust the call to match — the important invariant to preserve is "unconfigured or erroring → just run `fn()`".

- [ ] **Step 3: Manually verify graceful degradation with no key configured**

Temporarily rename `BRAINTRUST_API_KEY` in `.env.local` to `BRAINTRUST_API_KEY_DISABLED`, run `npm run dev`, and send a chat message via the UI.
Expected: the app responds normally (tracing silently no-ops). Restore the env var name afterward.

- [ ] **Step 4: Commit**

```bash
git add src/lib/observability/index.ts
git commit -m "Wire real Braintrust tracing into observability, gated on config"
```

---

### Task 6: Brief section parser (pure, tested)

**Files:**
- Create: `src/lib/agent/brief-sections.ts`
- Test: `src/lib/agent/brief-sections.test.ts`

**Interfaces:**
- Consumes: `BriefSection`, `BriefSectionHeading` from `@/types` (Task 3).
- Produces: `REQUIRED_BRIEF_SECTIONS: BriefSectionHeading[]`, `parseBriefSections(rawText: string): BriefSection[]` — consumed by Task 8 (`runBriefAgent`) and Task 13 (`scoreCompleteness`'s expected shape).

- [ ] **Step 1: Write the failing tests**

Create `src/lib/agent/brief-sections.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBriefSections, REQUIRED_BRIEF_SECTIONS } from "./brief-sections";

test("parses all four required sections with their content and citation ids", () => {
  const raw = [
    "## Overview",
    "This is the overview [1].",
    "## Key Findings",
    "Finding one [1]. Finding two [2].",
    "## Gaps & Limitations",
    "No major gaps found.",
    "## Conclusion",
    "In summary [2]."
  ].join("\n\n");

  const sections = parseBriefSections(raw);

  assert.equal(sections.length, 4);
  assert.deepEqual(sections.map((s) => s.heading), REQUIRED_BRIEF_SECTIONS);
  assert.equal(sections[0].content, "This is the overview [1].");
  assert.deepEqual(sections[0].citationIds, [1]);
  assert.deepEqual(sections[1].citationIds, [1, 2]);
  assert.equal(sections[3].content, "In summary [2].");
});

test("returns empty content and no citation ids for a required section missing from the raw text", () => {
  const raw = "## Overview\n\nJust an overview, no other sections.";
  const sections = parseBriefSections(raw);
  const gaps = sections.find((s) => s.heading === "Gaps & Limitations");
  assert.equal(gaps?.content, "");
  assert.deepEqual(gaps?.citationIds, []);
});

test("ignores headings that are not in the required set", () => {
  const raw = "## Random Aside\n\nIrrelevant text.\n\n## Overview\n\nReal content [3].";
  const sections = parseBriefSections(raw);
  const overview = sections.find((s) => s.heading === "Overview");
  assert.equal(overview?.content, "Real content [3].");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test src/lib/agent/brief-sections.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement the parser**

Create `src/lib/agent/brief-sections.ts`:

```ts
import type { BriefSection, BriefSectionHeading } from "@/types";

export const REQUIRED_BRIEF_SECTIONS: BriefSectionHeading[] = [
  "Overview",
  "Key Findings",
  "Gaps & Limitations",
  "Conclusion"
];

function extractCitationIds(text: string): number[] {
  const ids = new Set<number>();
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    ids.add(Number(match[1]));
  }
  return Array.from(ids).sort((a, b) => a - b);
}

// Splits the model's raw "## Heading" markdown brief into the four required
// sections. A heading not in REQUIRED_BRIEF_SECTIONS is dropped; a required
// section missing from the raw text comes back with empty content so
// completeness scoring can detect the gap instead of the parser crashing.
export function parseBriefSections(rawText: string): BriefSection[] {
  const headingPattern = /^##\s+(.+?)\s*$/gm;
  const matches = Array.from(rawText.matchAll(headingPattern));

  const found = new Map<string, string>();
  for (let i = 0; i < matches.length; i += 1) {
    const heading = matches[i][1].trim();
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? rawText.length : rawText.length;
    found.set(heading, rawText.slice(start, end).trim());
  }

  return REQUIRED_BRIEF_SECTIONS.map((heading) => {
    const content = found.get(heading) ?? "";
    return {
      heading,
      content,
      citationIds: extractCitationIds(content)
    };
  });
}
```

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `node --import tsx --test src/lib/agent/brief-sections.test.ts`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent/brief-sections.ts src/lib/agent/brief-sections.test.ts
git commit -m "Add pure parser for structured brief sections"
```

---

### Task 7: Agent core enrichment — exports, full trace fields, tracing

Enrich `runReactAgent`/`runFallback` with full trace data (query, observation, timing) and wrap model/tool calls in `tracedSpan`. Also export three pieces this task's sibling (`runBriefAgent`, Task 8) needs to reuse rather than duplicate: `createId`, `cleanSourceText`, `KNOWLEDGE_TOOL`, and a new `createSourceRegistry()` helper factored out of the source-registration logic that both `runReactAgent` and `runBriefAgent` need identically.

**Files:**
- Modify: `src/lib/agent/index.ts`

**Interfaces:**
- Consumes: `tracedSpan` (Task 5).
- Produces: `export function createId(prefix: string): string`, `export function cleanSourceText(text: string, maxLength?: number): string`, `export const KNOWLEDGE_TOOL: ChatTool`, `export function createSourceRegistry(): { sources: ResearchSource[]; registerSources: (found: ResearchSource[]) => string }`, `export async function runReactAgent(question: string, memory: ChatMessage[], allowWeb: boolean, knowledgeCount: number): Promise<AgentResult>` — consumed by Task 8 (`brief.ts`) and Task 15 (`agent.eval.ts`).

- [ ] **Step 1: Export `createId`, `cleanSourceText`, and add `KNOWLEDGE_TOOL` export**

In `src/lib/agent/index.ts`, change:

```ts
function createId(prefix: string) {
```
to:
```ts
export function createId(prefix: string) {
```

Change:
```ts
function cleanSourceText(text: string, maxLength = 220) {
```
to:
```ts
export function cleanSourceText(text: string, maxLength = 220) {
```

Change:
```ts
const KNOWLEDGE_TOOL: ChatTool = {
```
to:
```ts
export const KNOWLEDGE_TOOL: ChatTool = {
```

- [ ] **Step 2: Extract `createSourceRegistry` and use it in `runReactAgent`**

Add this new exported function directly above `runReactAgent` (after the `AgentResult` type definition, before the `async function runReactAgent(` line):

```ts
// Tracks unique sources across a run and formats them into numbered [n]
// observation text for the model. Shared by runReactAgent and runBriefAgent
// so both produce identically-numbered citations.
export function createSourceRegistry() {
  const sources: ResearchSource[] = [];
  const sourceIndex = new Map<string, number>();

  function registerSources(found: ResearchSource[]) {
    if (found.length === 0) {
      return "No results found for that query.";
    }

    return found
      .map((source) => {
        let index = sourceIndex.get(source.url);
        if (!index) {
          sources.push(source);
          index = sources.length;
          sourceIndex.set(source.url, index);
        }

        const body = cleanSourceText(source.snippet || source.content || source.title, 420);
        return `[${index}] ${source.title} (${source.domain})\n${source.url}\n${body}`;
      })
      .join("\n\n");
  }

  return { sources, registerSources };
}
```

- [ ] **Step 3: Rewrite `runReactAgent` to use the registry, export it, and enrich steps**

Replace the entire `runReactAgent` function (from `async function runReactAgent(` through its closing `}` before `// Deterministic fallback`) with:

```ts
export async function runReactAgent(
  question: string,
  memory: ChatMessage[],
  allowWeb: boolean,
  knowledgeCount: number
): Promise<AgentResult> {
  const { sources, registerSources } = createSourceRegistry();
  const steps: AgentStep[] = [];

  const tools: ChatTool[] = allowWeb ? [WEB_SEARCH_TOOL, KNOWLEDGE_TOOL] : [KNOWLEDGE_TOOL];

  const knowledgeHint =
    knowledgeCount > 0
      ? ` The user has ${knowledgeCount} document(s) in their private knowledge base. If the question could relate to their own notes, products, or uploads — including vague references like "it" or "this" — call search_knowledge before answering.`
      : " The user has no documents in their knowledge base yet, so search_knowledge will return nothing.";

  const messages: ChatModelMessage[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT + knowledgeHint },
    ...memory.map((message) => ({ role: message.role, content: message.content })),
    { role: "user", content: question }
  ];

  for (let iteration = 0; iteration < MAX_AGENT_ITERATIONS; iteration += 1) {
    const reply = await tracedSpan("agent.model_call", () => callChatModel(messages, tools), { iteration });
    messages.push(reply);

    const toolCalls = reply.tool_calls ?? [];
    if (toolCalls.length === 0) {
      steps.push({ id: createId("step"), kind: "answer", summary: "Wrote the final answer" });
      return { text: (reply.content ?? "").trim(), citations: sources, steps };
    }

    for (const call of toolCalls) {
      let query = "";
      try {
        query = (JSON.parse(call.function.arguments) as { query?: string }).query ?? "";
      } catch {
        query = "";
      }

      const startedAt = new Date();

      if (call.function.name === "web_search") {
        const found = allowWeb ? await tracedSpan("tool.web_search", () => searchWeb(query), { query }) : [];
        const observation = registerSources(found);
        steps.push({
          id: createId("step"),
          kind: "tool",
          tool: "web_search",
          input: query,
          summary: `Searched the web for "${query}"`,
          resultCount: found.length,
          observation,
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime()
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: observation });
      } else if (call.function.name === "search_knowledge") {
        const chunks = await tracedSpan("tool.search_knowledge", () => retrieveKnowledge(query), { query });
        const found = chunks.map((chunk) => ({ ...chunk.source, content: chunk.text }));
        const observation = registerSources(found);
        steps.push({
          id: createId("step"),
          kind: "tool",
          tool: "search_knowledge",
          input: query,
          summary: `Searched your sources for "${query}"`,
          resultCount: found.length,
          observation,
          startedAt: startedAt.toISOString(),
          durationMs: Date.now() - startedAt.getTime()
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: observation });
      } else {
        messages.push({ role: "tool", tool_call_id: call.id, content: "No results found for that query." });
      }
    }
  }

  messages.push({
    role: "user",
    content: "Give your best final answer now using what you have gathered, with inline [n] citations."
  });
  const finalReply = await tracedSpan("agent.model_call", () => callChatModel(messages, []), { iteration: MAX_AGENT_ITERATIONS });
  steps.push({ id: createId("step"), kind: "answer", summary: "Wrote the final answer" });
  return { text: (finalReply.content ?? "").trim(), citations: sources, steps };
}
```

- [ ] **Step 4: Add the `tracedSpan` import**

At the top of `src/lib/agent/index.ts`, add:

```ts
import { tracedSpan } from "@/lib/observability";
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 6: Manually verify chat still works and steps now carry richer data**

Run: `npm run dev`, send a chat message (with a knowledge source attached so `search_knowledge` fires), then `curl -s http://localhost:3000/api/conversations/<sessionId> | node -e "process.stdin.resume(); process.stdin.on('data', d => console.log(JSON.parse(d).run.steps))"` (or just inspect the Network tab response).
Expected: each tool step now has non-empty `observation`, `startedAt`, and `durationMs` fields.

- [ ] **Step 7: Commit**

```bash
git add src/lib/agent/index.ts
git commit -m "Export agent internals for reuse; enrich trace steps; wire tracing"
```

---

### Task 8: Brief agent and orchestrator

**Files:**
- Create: `src/lib/agent/brief.ts`

**Interfaces:**
- Consumes: `createId`, `cleanSourceText`, `KNOWLEDGE_TOOL`, `createSourceRegistry` (Task 7); `parseBriefSections`, `REQUIRED_BRIEF_SECTIONS` (Task 6); `tracedSpan` (Task 5); `callChatModel`, `hasOpenAiConfig`, `ChatModelMessage`, `ChatTool` (`@/lib/agent/openai`); `retrieveKnowledge` (`@/lib/rag`); `saveResearchRun` (`@/lib/db`); `appendResearchRunMemory` (`@/lib/memory`); `ResearchBrief`, `BriefSection`, `BriefRequest`, `BriefResponse`, `AgentStep`, `RetrievalChunk` (`@/types`, Task 3).
- Produces: `export async function runBriefAgent(topic: string): Promise<{ title: string; sections: BriefSection[]; citations: ResearchSource[]; steps: AgentStep[] }>`, `export async function runBrief(request: BriefRequest): Promise<BriefResponse>` — consumed by Task 10 (API route) and Task 15 (eval suite).

Scope note: brief runs persist as a `ResearchRun` (for trace export and Braintrust tracing) but are **not** added to the session's chat message thread — this is a separate, single-shot workflow from the chat conversation, matching the design spec.

- [ ] **Step 1: Write `src/lib/agent/brief.ts`**

```ts
import { saveResearchRun } from "@/lib/db";
import { callChatModel, hasOpenAiConfig } from "@/lib/agent/openai";
import type { ChatModelMessage, ChatTool } from "@/lib/agent/openai";
import { appendResearchRunMemory } from "@/lib/memory";
import { retrieveKnowledge } from "@/lib/rag";
import { tracedSpan } from "@/lib/observability";
import { createId, cleanSourceText, KNOWLEDGE_TOOL, createSourceRegistry } from "@/lib/agent";
import { parseBriefSections, REQUIRED_BRIEF_SECTIONS } from "@/lib/agent/brief-sections";
import type {
  AgentStep,
  BriefRequest,
  BriefResponse,
  BriefSection,
  ResearchBrief,
  ResearchSource,
  RetrievalChunk
} from "@/types";

// Report generation legitimately needs more retrieval passes than a chat
// answer — a brief with four sections may need 2-3 refined searches.
const MAX_BRIEF_ITERATIONS = 8;

const BRIEF_SYSTEM_PROMPT = [
  "You are Aegis, an autonomous research agent producing a structured brief from the user's private document knowledge base.",
  "Use the search_knowledge tool to gather evidence. You may call it more than once: after each search, assess whether you have enough evidence to write EVERY section below. If a section would be weakly supported, issue a refined follow-up search with different wording (narrower, or reframed with different terms) before writing that section.",
  "When you have enough evidence, write the final brief as Markdown using exactly these four '##' headings, in this order, and no others: Overview, Key Findings, Gaps & Limitations, Conclusion.",
  "Overview: 2-3 sentences framing the topic as covered by the document.",
  "Key Findings: the concrete, cited claims that answer the topic, as a bulleted list. Put inline citations like [1] or [2] immediately after each claim, matching the numbered sources returned by search_knowledge.",
  "Gaps & Limitations: what the document does not cover or leaves ambiguous with respect to the topic. If nothing is missing, say so explicitly rather than omitting the section.",
  "Conclusion: 1-2 sentences summarizing the brief.",
  "Never invent facts, section content, or citations. If the knowledge base has nothing relevant, say so plainly in Overview and leave the other sections minimal but present."
].join(" ");

type BriefAgentResult = {
  title: string;
  sections: BriefSection[];
  citations: ResearchSource[];
  steps: AgentStep[];
};

export async function runBriefAgent(topic: string): Promise<BriefAgentResult> {
  const { sources, registerSources } = createSourceRegistry();
  const steps: AgentStep[] = [];
  const tools: ChatTool[] = [KNOWLEDGE_TOOL];

  const messages: ChatModelMessage[] = [
    { role: "system", content: BRIEF_SYSTEM_PROMPT },
    { role: "user", content: `Produce a structured brief on: ${topic}` }
  ];

  let rawBrief = "";

  for (let iteration = 0; iteration < MAX_BRIEF_ITERATIONS; iteration += 1) {
    const reply = await tracedSpan("brief.model_call", () => callChatModel(messages, tools), { iteration });
    messages.push(reply);

    const toolCalls = reply.tool_calls ?? [];
    if (toolCalls.length === 0) {
      rawBrief = (reply.content ?? "").trim();
      steps.push({ id: createId("step"), kind: "answer", summary: "Wrote the final brief" });
      break;
    }

    for (const call of toolCalls) {
      let query = "";
      try {
        query = (JSON.parse(call.function.arguments) as { query?: string }).query ?? "";
      } catch {
        query = "";
      }

      const startedAt = new Date();
      const chunks = await tracedSpan("brief.tool_call", () => retrieveKnowledge(query), { query });
      const found = chunks.map((chunk) => ({ ...chunk.source, content: chunk.text }));
      const observation = registerSources(found);

      steps.push({
        id: createId("step"),
        kind: "tool",
        tool: "search_knowledge",
        input: query,
        summary: `Searched your sources for "${query}"`,
        resultCount: found.length,
        observation,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime()
      });

      messages.push({ role: "tool", tool_call_id: call.id, content: observation });
    }
  }

  if (!rawBrief) {
    messages.push({
      role: "user",
      content: "Give your best final brief now using what you have gathered, following the exact section format."
    });
    const finalReply = await tracedSpan(
      "brief.model_call",
      () => callChatModel(messages, []),
      { iteration: MAX_BRIEF_ITERATIONS }
    );
    rawBrief = (finalReply.content ?? "").trim();
    steps.push({ id: createId("step"), kind: "answer", summary: "Wrote the final brief" });
  }

  return { title: topic, sections: parseBriefSections(rawBrief), citations: sources, steps };
}

// Deterministic fallback when no LLM is configured (or the brief agent
// errors): surface raw retrieved excerpts instead of a synthesized report,
// mirroring runFallback's pattern in src/lib/agent/index.ts.
function synthesizeBriefLocally(topic: string, chunks: RetrievalChunk[]): { sections: BriefSection[]; citations: ResearchSource[] } {
  const citations = chunks.map((chunk) => chunk.source);

  if (citations.length === 0) {
    const emptyContent = `No knowledge base content was found for "${topic}". Add a source, or configure OpenAI for full brief generation.`;
    return {
      sections: REQUIRED_BRIEF_SECTIONS.map((heading) => ({ heading, content: emptyContent, citationIds: [] })),
      citations: []
    };
  }

  const excerpts = citations.map(
    (source, index) => `${cleanSourceText(source.snippet || source.content || source.title, 300)} [${index + 1}]`
  );

  return {
    sections: [
      { heading: "Overview", content: `Excerpts retrieved for "${topic}" from your knowledge base.`, citationIds: [] },
      {
        heading: "Key Findings",
        content: excerpts.join(" "),
        citationIds: citations.map((_, index) => index + 1)
      },
      {
        heading: "Gaps & Limitations",
        content: "This deterministic fallback lists raw excerpts only; configure OPENAI_API_KEY for synthesized, gap-aware analysis.",
        citationIds: []
      },
      { heading: "Conclusion", content: "See Key Findings above for the retrieved evidence.", citationIds: [] }
    ],
    citations
  };
}

async function runBriefFallback(topic: string): Promise<BriefAgentResult> {
  const chunks = await retrieveKnowledge(topic, 5);
  const fallback = synthesizeBriefLocally(topic, chunks);
  return { title: topic, sections: fallback.sections, citations: fallback.citations, steps: [] };
}

export async function runBrief(request: BriefRequest): Promise<BriefResponse> {
  const { sessionId, topic } = request;

  let result: BriefAgentResult;
  let usedModel: string;

  if (hasOpenAiConfig()) {
    try {
      result = await runBriefAgent(topic);
      usedModel = "openai-brief-agent";

      if (result.sections.every((section) => !section.content)) {
        throw new Error("Brief agent produced no content.");
      }
    } catch {
      result = await runBriefFallback(topic);
      usedModel = "local-brief-fallback";
    }
  } else {
    result = await runBriefFallback(topic);
    usedModel = "local-brief-fallback";
  }

  const brief: ResearchBrief = {
    title: result.title,
    sections: result.sections,
    citations: result.citations,
    steps: result.steps
  };

  const flattenedAnswer = brief.sections.map((section) => `## ${section.heading}\n${section.content}`).join("\n\n");

  const run = await saveResearchRun({
    id: createId("run"),
    sessionId,
    question: topic,
    answer: flattenedAnswer,
    plan: {
      useSearch: false,
      useRag: true,
      reasoning: "Brief mode always searches the document knowledge base.",
      requestedTools: ["rag"]
    },
    citations: brief.citations.slice(0, 12),
    steps: brief.steps,
    createdAt: new Date().toISOString(),
    usedModel,
    brief
  });

  await appendResearchRunMemory(run);

  return { sessionId, brief, run };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new type errors. If `@/lib/agent` doesn't resolve `createId`/`cleanSourceText`/`KNOWLEDGE_TOOL`/`createSourceRegistry` as named exports, confirm Task 7's Step 1-2 edits landed (all four must be `export`ed from `src/lib/agent/index.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent/brief.ts
git commit -m "Add Brief agent: scoped search_knowledge loop with refinement + fallback"
```

---

### Task 9: Persist `brief` on `ResearchRun`

**Files:**
- Modify: `src/lib/db/client.ts`
- Modify: `src/lib/db/index.ts`

**Interfaces:**
- Consumes: `ResearchRun.brief?: ResearchBrief` (Task 3).
- Produces: `saveResearchRun`/`listResearchRuns` now round-trip the `brief` field through Postgres when configured (runtime-store fallback already round-trips it with no changes needed, since it stores the object directly).

- [ ] **Step 1: Add the `brief` column**

In `src/lib/db/client.ts`, immediately after the existing:

```ts
      // Keep older databases compatible with the agent-trace column.
      await pool.query(`
        ALTER TABLE aegis_research_runs
        ADD COLUMN IF NOT EXISTS steps JSONB NOT NULL DEFAULT '[]'::jsonb;
      `);
```

add:

```ts
      // Keep older databases compatible with the structured-brief column.
      await pool.query(`
        ALTER TABLE aegis_research_runs
        ADD COLUMN IF NOT EXISTS brief JSONB;
      `);
```

- [ ] **Step 2: Update `saveResearchRun` to write `brief`**

In `src/lib/db/index.ts`, replace the `saveResearchRun` function body's query with:

```ts
export async function saveResearchRun(run: ResearchRun) {
  const pool = getPostgresPool();

  if (!pool) {
    return run;
  }

  try {
    await ensurePostgresSchema();
    await touchSession(run.sessionId);
    await pool.query(
      `
        INSERT INTO aegis_research_runs (
          id,
          session_id,
          question,
          answer,
          plan,
          citations,
          steps,
          created_at,
          used_model,
          brief
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10::jsonb)
        ON CONFLICT (id) DO NOTHING;
      `,
      [
        run.id,
        run.sessionId,
        run.question,
        run.answer,
        JSON.stringify(run.plan),
        JSON.stringify(run.citations),
        JSON.stringify(run.steps ?? []),
        run.createdAt,
        run.usedModel,
        run.brief ? JSON.stringify(run.brief) : null
      ]
    );

    databaseStatus.connected = true;
  } catch {
    databaseStatus.connected = false;
  }

  return run;
}
```

- [ ] **Step 3: Update `listResearchRuns` to read `brief`**

In the same file, in `listResearchRuns`, update the row type and query/mapping:

```ts
export async function listResearchRuns(sessionId: string) {
  const pool = getPostgresPool();

  if (!pool) {
    return getSessionState(sessionId).runs;
  }

  try {
    await ensurePostgresSchema();
    const result = await pool.query<{
      id: string;
      session_id: string;
      question: string;
      answer: string;
      plan: ResearchRun["plan"];
      citations: ResearchRun["citations"];
      steps: ResearchRun["steps"];
      created_at: string;
      used_model: string;
      brief: ResearchRun["brief"];
    }>(
      `
        SELECT id, session_id, question, answer, plan, citations, steps, created_at, used_model, brief
        FROM aegis_research_runs
        WHERE session_id = $1
        ORDER BY created_at DESC;
      `,
      [sessionId]
    );

    databaseStatus.connected = true;

    return result.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      question: row.question,
      answer: row.answer,
      plan: row.plan,
      citations: row.citations,
      steps: row.steps ?? [],
      createdAt: new Date(row.created_at).toISOString(),
      usedModel: row.used_model,
      brief: row.brief ?? undefined
    }));
  } catch {
    databaseStatus.connected = false;
    return getSessionState(sessionId).runs;
  }
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 5: Manually verify against a real Postgres (if `DATABASE_URL` is configured)**

Run: `npm run dev`, then once Task 10's route exists, POST to `/api/brief` and confirm via `psql "$DATABASE_URL" -c "SELECT id, used_model, brief IS NOT NULL AS has_brief FROM aegis_research_runs ORDER BY created_at DESC LIMIT 1;"` that `has_brief` is `t`. (If this step runs before Task 10 lands, skip and revisit after Task 10.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/client.ts src/lib/db/index.ts
git commit -m "Persist structured brief data on aegis_research_runs"
```

---

### Task 10: `POST /api/brief` route

**Files:**
- Create: `src/app/api/brief/route.ts`

**Interfaces:**
- Consumes: `runBrief` (Task 8), `BriefRequest` (Task 3).
- Produces: `POST /api/brief` HTTP endpoint — consumed by Task 12 (UI).

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from "next/server";
import { runBrief } from "@/lib/agent/brief";
import type { BriefRequest } from "@/types";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<BriefRequest>;

  if (!body.sessionId || !body.topic?.trim()) {
    return NextResponse.json(
      {
        error: "Both sessionId and topic are required."
      },
      { status: 400 }
    );
  }

  const response = await runBrief({
    sessionId: body.sessionId,
    topic: body.topic.trim()
  });

  return NextResponse.json(response);
}
```

- [ ] **Step 2: Manually verify with curl**

Run: `npm run dev`, then in another terminal:

```bash
curl -s -X POST http://localhost:3000/api/brief \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test-session","topic":"What does the document say about trustworthy AI characteristics?"}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"
```

Expected: a JSON response with `brief.sections` containing all four headings (content may be the "no knowledge base content" fallback message if no document has been seeded yet — that's expected before Task 11 runs).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/brief/route.ts
git commit -m "Add POST /api/brief route"
```

---

### Task 11: Seed script for the demo document

**Files:**
- Create: `scripts/seed-knowledge.ts`

**Interfaces:**
- Consumes: `extractPdfText` (Task 4), `addKnowledgeDocument` (`src/lib/rag/index.ts`, pre-existing).
- Produces: `npm run seed:knowledge` — populates the knowledge base with the NIST AI RMF 1.0 document, which the Task 14 dataset and Task 15 eval suite depend on.

- [ ] **Step 1: Write the script**

Create `scripts/seed-knowledge.ts` (uses relative imports since it runs outside the Next.js `@/*` alias resolution):

```ts
import { extractPdfText } from "../src/lib/rag/pdf";
import { addKnowledgeDocument } from "../src/lib/rag";

const DEMO_DOCUMENT_URL = "https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf";
const DEMO_DOCUMENT_TITLE = "NIST AI Risk Management Framework 1.0";

async function main() {
  console.log(`Fetching ${DEMO_DOCUMENT_URL} ...`);
  const response = await fetch(DEMO_DOCUMENT_URL);
  if (!response.ok) {
    throw new Error(`Failed to download demo document: HTTP ${response.status}`);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  console.log("Extracting text...");
  const text = await extractPdfText(data);

  if (!text) {
    throw new Error("Extracted PDF text was empty.");
  }

  console.log(`Extracted ${text.length} characters. Ingesting into the knowledge base...`);
  const source = await addKnowledgeDocument({ title: DEMO_DOCUMENT_TITLE, text });
  console.log(`Seeded knowledge source: ${source.id} (${source.title})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `npm run seed:knowledge`
Expected: logs the fetch, extraction character count (should be roughly 100,000-110,000), and a successful "Seeded knowledge source" line. Requires `DATABASE_URL` and `OPENAI_API_KEY` to be configured for the pgvector path; without them it still ingests into the in-memory fallback store (which won't persist across a server restart — note this in Task 16's setup instructions).

- [ ] **Step 3: Verify ingestion coverage**

Run: `curl -s http://localhost:3000/api/sources | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).sources.map(s=>s.title)))"` (with `npm run dev` running).
Expected: `"NIST AI Risk Management Framework 1.0"` appears in the list.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-knowledge.ts
git commit -m "Add seed script for the NIST AI RMF demo document"
```

---

### Task 12: UI — Brief mode and trace export

**Files:**
- Create: `src/app/components/BriefPanel.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `POST /api/brief` (Task 10), `ResearchBrief`, `BriefResponse`, `AgentStep` (Task 3).
- Produces: a "Brief" composer mode toggle and rendered structured brief with a trace-export button, additive to the existing chat UI.

- [ ] **Step 1: Create the brief rendering component**

Create `src/app/components/BriefPanel.tsx`:

```tsx
import type { AgentStep, ResearchBrief } from "@/types";

function downloadTrace(steps: AgentStep[], filename: string) {
  const blob = new Blob([JSON.stringify(steps, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function BriefPanel({ brief }: { brief: ResearchBrief }) {
  return (
    <div className="brief-panel" aria-label="Structured brief">
      <div className="brief-panel-header">
        <h3>{brief.title}</h3>
        <button
          type="button"
          className="composer-icon-button brief-export-button"
          onClick={() => downloadTrace(brief.steps, `aegis-brief-trace-${Date.now()}.json`)}
        >
          Export trace
        </button>
      </div>
      {brief.sections.map((section) => (
        <section key={section.heading} className="brief-section">
          <h4>{section.heading}</h4>
          <p>{section.content || "—"}</p>
        </section>
      ))}
      {brief.citations.length > 0 ? (
        <div className="source-strip" aria-label="Sources">
          {brief.citations.map((source, index) => (
            <span key={source.id} className="source-chip" title={source.title}>
              <span className="source-chip-index">{index + 1}</span>
              {source.domain}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Add brief state, import, and the submit handler in `page.tsx`**

In `src/app/page.tsx`, update the type import line (currently `import type { AgentStep, ChatResponse, ConversationSummary, ResearchSource } from "@/types";`) to also include `BriefResponse`:

```ts
import type { AgentStep, BriefResponse, ChatResponse, ConversationSummary, ResearchSource } from "@/types";
```

Add the component import near the other local imports at the top of the file:

```ts
import { BriefPanel } from "@/app/components/BriefPanel";
```

In the `Home` component, immediately after this existing line:

```tsx
  const [useWebSearch, setUseWebSearch] = useState(false);
```

add:

```tsx
  const [briefMode, setBriefMode] = useState(false);
  const [briefResult, setBriefResult] = useState<BriefResponse | null>(null);
  const [isBriefLoading, setIsBriefLoading] = useState(false);
```

Immediately after the existing `submitPrompt` function's closing brace (the `}` that ends the function containing the `/api/chat` fetch), add:

```tsx
  async function submitBrief(topic: string) {
    const trimmedTopic = topic.trim();
    if (!sessionId || isBriefLoading || !trimmedTopic) {
      return;
    }

    setIsBriefLoading(true);
    setError("");
    setPrompt("");

    try {
      const apiResponse = await fetch("/api/brief", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ sessionId, topic: trimmedTopic })
      });

      if (!apiResponse.ok) {
        const body = (await apiResponse.json()) as { error?: string };
        throw new Error(body.error ?? "Aegis could not generate the brief.");
      }

      const data = (await apiResponse.json()) as BriefResponse;
      setBriefResult(data);
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Something went wrong while generating the brief."
      );
    } finally {
      setIsBriefLoading(false);
    }
  }
```

- [ ] **Step 3: Branch `handleSubmit` on `briefMode`**

Replace:

```tsx
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitPrompt(prompt);
  }
```

with:

```tsx
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (briefMode) {
      await submitBrief(prompt);
    } else {
      await submitPrompt(prompt);
    }
  }
```

- [ ] **Step 4: Add the Brief mode toggle pill**

Immediately after the existing Smart Search button's closing `</button>` (inside `.composer-mode-pills`, right before the closing `</div>` of that container), add:

```tsx
                <button
                  type="button"
                  className={`composer-mode-pill ${briefMode ? "active" : ""}`}
                  aria-pressed={briefMode}
                  onClick={() => setBriefMode((current) => !current)}
                >
                  <DocStepIcon />
                  <span>Brief</span>
                </button>
```

(`DocStepIcon` is already defined earlier in this file and used by `AgentSteps`.)

- [ ] **Step 5: Update the composer textarea placeholder and send-button disabled state**

Replace:

```tsx
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={1}
              placeholder="Message Aegis"
            />
```

with:

```tsx
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={1}
              placeholder={briefMode ? "Brief topic (e.g. \"summarize the risk framework\")" : "Message Aegis"}
            />
```

Replace:

```tsx
                <button type="submit" className="composer-send-button" disabled={isLoading || !prompt.trim()} aria-label="Send message">
```

with:

```tsx
                <button type="submit" className="composer-send-button" disabled={isLoading || isBriefLoading || !prompt.trim()} aria-label="Send message">
```

- [ ] **Step 6: Render the brief panel above the composer**

Immediately after `<div ref={conversationEndRef} />` and before `{error ? <div className="error-banner">{error}</div> : null}`, add:

```tsx
          {briefResult ? (
            <div className="brief-panel-wrapper">
              <BriefPanel brief={briefResult.brief} />
            </div>
          ) : null}

          {isBriefLoading ? (
            <div className="chat-empty-state">
              <p>Generating brief…</p>
            </div>
          ) : null}
```

- [ ] **Step 7: Add CSS for the brief panel**

In `src/app/globals.css`, after the existing `.agent-steps` block (find the section that ends with the last `.step-icon`-related rule before source chips or the next unrelated block), add:

```css
/* Brief panel */
.brief-panel-wrapper {
  margin: 0 0 16px;
}

.brief-panel {
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--hover);
}

.brief-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.brief-panel-header h3 {
  margin: 0;
  font-size: 0.95rem;
  color: var(--text-strong);
}

.brief-export-button {
  font-size: 0.72rem;
  width: auto;
  padding: 0 12px;
  height: 28px;
  border-radius: 999px;
  border: 1px solid var(--border);
}

.brief-section {
  margin-bottom: 14px;
}

.brief-section:last-of-type {
  margin-bottom: 8px;
}

.brief-section h4 {
  margin: 0 0 4px;
  font-size: 0.78rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--muted);
}

.brief-section p {
  margin: 0;
  color: var(--text);
  font-size: 0.88rem;
  line-height: 1.55;
  white-space: pre-wrap;
}
```

- [ ] **Step 8: Manually verify in the browser**

Run: `npm run dev`, open `http://localhost:3000`, click the "Brief" pill, type a topic, submit.
Expected: the composer placeholder changes when Brief mode is toggled on; submitting shows "Generating brief…" then renders four sections with an "Export trace" button that downloads a JSON file of the step trace; toggling Brief mode off and sending a normal message still works as before.

- [ ] **Step 9: Commit**

```bash
git add src/app/components/BriefPanel.tsx src/app/page.tsx src/app/globals.css
git commit -m "Add Brief mode UI: structured report view and trace export"
```

---

### Task 13: Eval scorers (pure, tested)

**Files:**
- Create: `evals/scorers.ts`
- Test: `evals/scorers.test.ts`

**Interfaces:**
- Consumes: `AgentStep`, `ResearchSource` (`@/types`, via relative import from `evals/`).
- Produces: `scoreCitationValidity`, `scoreCompleteness`, `scoreSearchTrajectory` — consumed by Task 15 (`evals/agent.eval.ts`).

- [ ] **Step 1: Write the failing tests**

Create `evals/scorers.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCitationValidity, scoreCompleteness, scoreSearchTrajectory } from "./scorers";

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test evals/scorers.test.ts`
Expected: FAIL — the module doesn't exist yet.

- [ ] **Step 3: Implement the scorers**

Create `evals/scorers.ts`:

```ts
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

export function scoreCompleteness(sections: Array<{ heading: string; content: string }>) {
  const requiredHeadings = ["Overview", "Key Findings", "Gaps & Limitations", "Conclusion"];
  const present = requiredHeadings.filter((heading) =>
    sections.some((section) => section.heading === heading && section.content.trim().length > 0)
  );

  return { name: "Completeness", score: present.length / requiredHeadings.length };
}

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
```

- [ ] **Step 4: Run the tests again to verify they pass**

Run: `node --import tsx --test evals/scorers.test.ts`
Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

```bash
git add evals/scorers.ts evals/scorers.test.ts
git commit -m "Add pure eval scorers: citation validity, completeness, search trajectory"
```

---

### Task 14: Eval dataset (18 real, document-grounded cases)

**Files:**
- Create: `evals/dataset.ts`

**Interfaces:**
- Produces: `EvalCase` type, `chatCases: EvalCase[]` (14 cases), `briefCases: EvalCase[]` (4 cases) — consumed by Task 15 (`evals/agent.eval.ts`).

All facts below were extracted directly from the real NIST AI RMF 1.0 PDF text (see Global Constraints) — not invented.

- [ ] **Step 1: Create `evals/dataset.ts`**

```ts
export type EvalCase = {
  input: string;
  expected: string;
  tags: string[];
};

export const chatCases: EvalCase[] = [
  // Direct factual (6) — answerable from a single section.
  {
    input: "What are the four functions that make up the AI RMF Core?",
    expected: "The AI RMF Core is organized into four functions: GOVERN, MAP, MEASURE, and MANAGE.",
    tags: ["direct"]
  },
  {
    input: "According to the AI RMF, what does 'Reliability' mean for an AI system?",
    expected:
      "Reliability is defined (adapted from ISO/IEC TS 5723:2022) as the ability of an item to perform as required, without failure, for a given time interval, under given conditions.",
    tags: ["direct"]
  },
  {
    input: "List the seven characteristics of a trustworthy AI system as defined in the AI RMF.",
    expected:
      "Valid and Reliable; Safe; Secure and Resilient; Accountable and Transparent; Explainable and Interpretable; Privacy-Enhanced; and Fair - with Harmful Bias Managed.",
    tags: ["direct"]
  },
  {
    input: "Is the AI RMF mandatory for organizations to follow?",
    expected: "No. The AI RMF is explicitly voluntary, rights-preserving, non-sector-specific, and use-case agnostic.",
    tags: ["direct"]
  },
  {
    input: "What law directed NIST to create the AI RMF?",
    expected: "The National Artificial Intelligence Initiative Act of 2020 (P.L. 116-283).",
    tags: ["direct"]
  },
  {
    input: "What does GOVERN 1.1 require?",
    expected: "GOVERN 1.1 requires that legal and regulatory requirements involving AI are understood, managed, and documented.",
    tags: ["direct"]
  },

  // Multi-hop (5) — evidence lives in two or more sections, so a good answer
  // requires more than one retrieval pass.
  {
    input:
      "After completing the GOVERN function, which function do most users of the AI RMF start with next, and what do its first two categories or subcategories cover?",
    expected:
      "Most users start with MAP after GOVERN, before continuing to MEASURE or MANAGE. MAP 1.1 covers understanding and documenting the AI system's intended purposes, beneficial uses, context-specific laws/norms, and deployment settings; MAP 1.2 covers ensuring interdisciplinary AI actors with demographic diversity and broad domain expertise participate in establishing that context.",
    tags: ["multi-hop"]
  },
  {
    input: "How does the AI RMF define both 'Accuracy' and 'Robustness', and which trustworthiness characteristic do they fall under?",
    expected:
      "Both fall under 'Valid and Reliable'. Accuracy is defined (via ISO/IEC TS 5723:2022) as the closeness of results of observations, computations, or estimates to the true or accepted-true values. Robustness (or generalizability) is defined as the ability of a system to maintain its level of performance under a variety of circumstances, including uses not initially anticipated.",
    tags: ["multi-hop"]
  },
  {
    input: "The AI RMF says it does not prescribe risk tolerance. Which section discusses this, and what does it say organizations should do instead?",
    expected:
      "Section 1.2.2, Risk Tolerance. It says the AI RMF can be used to prioritize risk but does not prescribe risk tolerance; organizations should follow existing regulations/guidelines for risk criteria and tolerance from their sector, and where no guidelines exist, define a reasonable risk tolerance themselves before using the AI RMF to manage and document risk.",
    tags: ["multi-hop"]
  },
  {
    input: "What do GOVERN 1.2 and GOVERN 1.3 each require, and how does GOVERN 1.3 connect to risk tolerance?",
    expected:
      "GOVERN 1.2 requires that the characteristics of trustworthy AI are integrated into organizational policies, processes, procedures, and practices. GOVERN 1.3 requires that processes, procedures, and practices are in place to determine the needed level of risk management activities based on the organization's risk tolerance - directly connecting governance to the risk tolerance concept discussed in section 1.2.2.",
    tags: ["multi-hop"]
  },
  {
    input: "What is the NIST AI RMF Playbook, and how does its voluntary nature compare to the Framework's own voluntary nature?",
    expected:
      "The Playbook is an online companion resource to the AI RMF that helps organizations navigate it via suggested tactical actions. Like the Framework itself, the Playbook is voluntary - organizations can use its suggestions according to their own needs and interests, and even create their own tailored guidance from it.",
    tags: ["multi-hop"]
  },

  // Not in the document (3) — the agent should decline rather than fabricate.
  {
    input: "What is the maximum fine NIST can impose on a company that fails to comply with the AI RMF?",
    expected:
      "The AI RMF does not define any fines or enforcement penalties for non-compliance - it is an explicitly voluntary, non-regulatory framework, not a law or regulation with penalties attached.",
    tags: ["not-in-doc"]
  },
  {
    input: "What specific AI governance committee team size does the AI RMF require organizations to adopt?",
    expected:
      "The AI RMF does not specify a required governance committee team size. It explicitly leaves implementation flexible: organizations may select from among the categories and subcategories based on their own resources and capabilities rather than following a mandated structure.",
    tags: ["not-in-doc"]
  },
  {
    input: "According to the AI RMF, what is the deadline by which all US federal agencies must be fully AI RMF-compliant?",
    expected:
      "The AI RMF does not set any federal agency compliance deadline. The only related timeline in the document is NIST's own commitment to review and potentially update the Framework itself no later than 2028 - that is about updating the Framework, not agency compliance.",
    tags: ["not-in-doc"]
  }
];

export const briefCases: EvalCase[] = [
  {
    input: "Produce a structured brief on how the AI RMF defines and organizes AI risk management functions.",
    expected:
      "Should describe all four Core functions - GOVERN, MAP, MEASURE, MANAGE - with citations, and note that GOVERN is cross-cutting while most users proceed GOVERN then MAP then MEASURE/MANAGE.",
    tags: ["brief"]
  },
  {
    input: "Produce a structured brief summarizing the trustworthiness characteristics an AI system should have per the AI RMF.",
    expected:
      "Should enumerate all seven characteristics (Valid and Reliable, Safe, Secure and Resilient, Accountable and Transparent, Explainable and Interpretable, Privacy-Enhanced, Fair - with Harmful Bias Managed) with citations back to section 3.",
    tags: ["brief"]
  },
  {
    input:
      "Produce a structured brief on what the AI RMF explicitly says about its own scope and limitations - voluntary vs. mandatory, and what it does not prescribe.",
    expected:
      "Should cover: the Framework is voluntary, rights-preserving, non-sector-specific, use-case agnostic; it does not prescribe risk tolerance (section 1.2.2); and it does not prescribe profile templates.",
    tags: ["brief"]
  },
  {
    input: "Produce a structured brief comparing the GOVERN and MAP functions: their purpose and their first couple of categories.",
    expected:
      "Should contrast GOVERN's cross-cutting, culture/policy-setting role (e.g. GOVERN 1.1, 1.2) against MAP's role of establishing and understanding context (e.g. MAP 1.1, 1.2), with citations to Table 1 and Table 2 content.",
    tags: ["brief"]
  }
];
```

- [ ] **Step 2: Sanity-check the file loads**

Run: `node --import tsx -e "const d = require('./evals/dataset.ts'); console.log(d.chatCases.length, d.briefCases.length)"`
Expected: prints `14 4`.

- [ ] **Step 3: Commit**

```bash
git add evals/dataset.ts
git commit -m "Add 18-case eval dataset grounded in the real NIST AI RMF text"
```

---

### Task 15: Eval suite and baseline run

**Files:**
- Create: `evals/agent.eval.ts`

**Interfaces:**
- Consumes: `runReactAgent` (Task 7), `runBriefAgent` (Task 8), `chatCases`/`briefCases` (Task 14), `scoreCitationValidity`/`scoreCompleteness`/`scoreSearchTrajectory` (Task 13), `listKnowledgeSources` (`src/lib/rag/index.ts`, pre-existing).
- Produces: a runnable `npx braintrust eval evals/agent.eval.ts` suite, and a recorded baseline score set (captured in this task's Step 5, consumed by Task 16's before/after comparison).

- [ ] **Step 1: Confirm the seed script (Task 11) has been run**

Run: `curl -s http://localhost:3000/api/sources | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).sources.length))"` (with `npm run dev` running).
Expected: `1` or more. If `0`, run `npm run seed:knowledge` first — the eval suite calls the agent functions directly against whatever is currently in the knowledge base.

- [ ] **Step 2: Write `evals/agent.eval.ts`**

```ts
import { Eval } from "braintrust";
import { Factuality } from "autoevals";
import { runReactAgent } from "../src/lib/agent";
import { runBriefAgent } from "../src/lib/agent/brief";
import { listKnowledgeSources } from "../src/lib/rag";
import { chatCases, briefCases } from "./dataset";
import { scoreCitationValidity, scoreCompleteness, scoreSearchTrajectory } from "./scorers";

Eval("aegis-agent-eval", {
  data: () => chatCases.map((testCase) => ({
    input: testCase.input,
    expected: testCase.expected,
    metadata: { tags: testCase.tags }
  })),
  task: async (input: string) => {
    const knowledgeCount = (await listKnowledgeSources()).length;
    const result = await runReactAgent(input, [], false, knowledgeCount);
    return { text: result.text, citations: result.citations, steps: result.steps };
  },
  scores: [
    async (args: any) => Factuality({ output: args.output.text, expected: args.expected, input: args.input }),
    (args: any) => scoreCitationValidity({ text: args.output.text, citations: args.output.citations }),
    (args: any) => scoreSearchTrajectory(args.output.steps, args.metadata?.tags ?? [])
  ]
});

Eval("aegis-agent-eval-briefs", {
  data: () => briefCases.map((testCase) => ({
    input: testCase.input,
    expected: testCase.expected,
    metadata: { tags: testCase.tags }
  })),
  task: async (input: string) => {
    return runBriefAgent(input);
  },
  scores: [
    async (args: any) =>
      Factuality({
        output: args.output.sections.map((section: any) => `${section.heading}: ${section.content}`).join("\n"),
        expected: args.expected,
        input: args.input
      }),
    (args: any) =>
      scoreCitationValidity({
        text: args.output.sections.map((section: any) => section.content).join(" "),
        citations: args.output.citations
      }),
    (args: any) => scoreCompleteness(args.output.sections),
    (args: any) => scoreSearchTrajectory(args.output.steps, args.metadata?.tags ?? [])
  ]
});
```

Note: this uses `any` on the scorer argument objects because the exact `Eval`/score-function generic signature can differ slightly across `braintrust` SDK versions. Before running, check `node_modules/braintrust/dist/index.d.ts` (search for `export declare function Eval` and the `Score` type) and tighten these types / adjust the destructured field names (`output`, `expected`, `input`, `metadata`) if the installed version's shape differs from what's assumed here. The one thing that must not change is the scoring logic itself.

- [ ] **Step 3: Add the file to the test-running mental model (it is not a `node:test` file — it runs via the Braintrust CLI, not `npm test`)**

No action needed; this is a note, not a step. `evals/agent.eval.ts` is picked up by `npm run eval` (Task 2's script), not by `npm test`.

- [ ] **Step 4: Run the baseline eval**

Run: `npm run eval`
Expected: the Braintrust CLI runs both `Eval()` blocks, prints a summary table of scores per scorer, and prints a link to the results in the Braintrust UI (`https://www.braintrust.dev/app/...`). If it fails with an auth error, confirm `.env.local` has `BRAINTRUST_API_KEY` set and that the process picks up `.env.local` (the `braintrust eval` CLI reads `process.env` directly; if it doesn't auto-load `.env.local`, run `node --env-file=.env.local $(npm bin)/braintrust eval evals/agent.eval.ts` instead, or export the vars in-shell for this run).

- [ ] **Step 5: Record the baseline scores**

Copy the printed summary table (or the Braintrust experiment URL) into a scratch note — Task 16 needs these exact numbers to demonstrate a before/after delta. Do not commit this scratch note; it's intermediate working data, not a deliverable (the deliverable is Task 16's findings report, which will contain the real before/after numbers this run produces).

- [ ] **Step 6: Commit**

```bash
git add evals/agent.eval.ts
git commit -m "Add Braintrust eval suite covering chat and brief workflows"
```

---

### Task 16: Find and fix a real failure, add a regression test, re-run, write findings

This task is inherently investigative — Steps 1-2 depend on what the Task 15 baseline run actually shows. Follow the structure below, but the specific failure and fix will be whatever the real run surfaces (most likely candidate given the current design: a multi-hop case where the brief/chat agent answers from a single search instead of refining, since nothing before this point has been eval-tested against real model behavior).

**Files:**
- Modify: whichever of `src/lib/agent/index.ts` / `src/lib/agent/brief.ts` the real failure points to (most likely the system prompt or iteration logic)
- Modify: `evals/dataset.ts` (add the regression case)
- Create: `docs/eval-findings.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: the Task 15 baseline results.
- Produces: `docs/eval-findings.md` (required deliverable), an updated dataset with a pinned regression case, and README setup instructions covering the whole workflow end to end.

- [ ] **Step 1: Inspect the baseline results in the Braintrust UI**

Open the experiment URL printed by Task 15's `npm run eval`. Sort/filter by the lowest-scoring cases across `SearchTrajectory`, `CitationValidity`, `Completeness`, and `Factuality`. Identify the single most instructive real failure — a case where the score is clearly wrong and the root cause is inspectable from the trace (e.g. a multi-hop case where only one `search_knowledge` call happened, or a brief case missing a required section, or a citation index that doesn't resolve).

- [ ] **Step 2: Root-cause it**

Use the exported trace (Braintrust's span view, or the `steps` array in the eval's logged output) to determine why. Do not guess — read the actual query the agent issued and the actual observation text it received.

- [ ] **Step 3: Apply a targeted fix**

Depending on what Step 2 finds, this is likely one of:
- Strengthen the refinement instruction in `BRIEF_SYSTEM_PROMPT` (`src/lib/agent/brief.ts`) or `AGENT_SYSTEM_PROMPT` (`src/lib/agent/index.ts`) — e.g. making the "assess evidence coverage" instruction more directive rather than advisory.
- Fix `parseBriefSections` (`src/lib/agent/brief-sections.ts`) if the model's heading formatting isn't matching the parser's expectations (e.g. the model uses `**Overview**` instead of `## Overview` — tighten the prompt's formatting instruction rather than loosening the parser, to keep the output contract strict).
- Fix `retrieveKnowledge`'s `limit` (`src/lib/rag/index.ts`, currently defaults to 3) if too few chunks are being returned per search to give the model enough evidence to know it needs to refine.

Make the change, and re-run the specific failing case's unit test if the fix touched a pure function (Task 6's or Task 13's test files); otherwise proceed to Step 4 directly since this is agent-behavior-level, not unit-level.

- [ ] **Step 4: Add the failing case as a pinned regression test**

Add a new entry to `evals/dataset.ts` (`chatCases` or `briefCases`, matching where the failure was) with a `"regression"` tag alongside its existing tags, e.g. `tags: ["multi-hop", "regression"]`. If the failing case already existed in the dataset, just add the `"regression"` tag to it rather than duplicating it.

- [ ] **Step 5: Re-run the eval suite**

Run: `npm run eval`
Expected: the regression-tagged case's score improves versus the Task 15 baseline. Record the new summary table / experiment URL.

- [ ] **Step 6: Write the findings report**

Create `docs/eval-findings.md` using the real before/after numbers from Steps 4-5 (not placeholder numbers — fill in what the actual runs produced):

```markdown
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

## Before / after: [fill in the specific case and root cause found in Step 2]

**Baseline** ([Braintrust experiment link from Task 15 Step 5]):
[paste the actual baseline summary numbers here]

**Root cause:** [what Step 2 found]

**Fix:** [what Step 3 changed, and why]

**After fix** ([Braintrust experiment link from Step 5 above]):
[paste the actual post-fix summary numbers here]

## What Braintrust measures well

[Fill in honestly based on hands-on use during this task — e.g. trace/span
visualization for debugging exactly which search query caused a bad answer,
side-by-side experiment diffing, LLM-graded scorer ergonomics via autoevals.]

## Where Braintrust falls short for this kind of eval

[Fill in honestly — e.g. anything that was awkward about scoring agent
trajectories specifically (as opposed to single-turn Q&A), any friction in
the TypeScript SDK's types encountered in Task 15 Step 2, any gaps in how
well "did the agent refine its search" maps onto Braintrust's built-in
scorer primitives versus needing the custom heuristic scorer written here.]

## Running this yourself

1. `npm install`
2. Add `OPENAI_API_KEY`, `DATABASE_URL` (optional, else in-memory fallback), and `BRAINTRUST_API_KEY` to `.env.local`
3. `npm run seed:knowledge` — ingests the demo document
4. `npm run dev` — try the chat and Brief mode in the browser
5. `npm test` — pure-logic unit tests (parser, scorers, chunking)
6. `npm run eval` — full Braintrust evaluation run
```

- [ ] **Step 7: Update the README**

In `README.md`, add a new section (after the existing "Getting started" section, before "Roadmap") documenting the Brief workflow and eval harness at a high level, and update the "Roadmap" section's `Tracing/observability (Langfuse) and a small evaluation harness` line to reflect that this is now done with Braintrust rather than Langfuse — replace that roadmap bullet with a link to `docs/eval-findings.md`.

- [ ] **Step 8: Verify everything still compiles and the full local suite passes**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all unit tests pass.

- [ ] **Step 9: Commit**

```bash
git add evals/dataset.ts docs/eval-findings.md README.md src/lib/agent/index.ts src/lib/agent/brief.ts src/lib/agent/brief-sections.ts src/lib/rag/index.ts
git commit -m "Fix search-refinement failure found in baseline eval; add regression test and findings report"
```

(Adjust the file list in this final `git add` to whatever Step 3 actually touched.)
