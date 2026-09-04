# Aegis Agent

Aegis is a **ReAct research agent**: it answers questions that need fresh information by autonomously deciding which tools to use, calling them in a multi-step reason → act → observe loop, and synthesizing a grounded, cited answer.

Ask it something and turn on **Smart Search** — the model itself decides what to search, runs the searches (often several, refining as it goes), reads the results, and writes a clear answer with inline `[1]` citations. The UI shows the agent's actual steps as it works.

## Demo

![Aegis Agent demo](docs/media/aegis-demo.gif)

*Silent GIF preview above — for the full-quality video with sound, see [docs/media/aegis-demo.mp4](docs/media/aegis-demo.mp4).*

> The clip above shows two flows back to back: pasting a document into RAG and asking a question answered straight from that source, then switching on Smart Search and asking a live question that Aegis researches on the web with cited sources.

### Screenshots

| Home | Answer with citations |
|---|---|
| ![Home](docs/screenshots/01-home.png) | ![Cited answer with agent steps and source chips](docs/screenshots/03-answer-cited.png) |

| Agent researching | Light theme |
|---|---|
| ![Agent researching indicator](docs/screenshots/02-researching.png) | ![Light theme](docs/screenshots/04-light-theme.png) |

## Highlights

- **Autonomous agent loop** — a true ReAct cycle over OpenAI function-calling. The model picks tools, can call them multiple times, observes results, and stops when it has enough to answer (capped at 5 iterations).
- **Tools** — `web_search` (live web via Tavily) and `search_knowledge` (RAG over the user's own documents).
- **Grounded synthesis** — answers are natural prose with inline citations, never a dump of raw snippets. Every tool call is recorded as a step trace.
- **Tiered memory** — recent-conversation buffer with a Redis → Postgres → in-memory degradation chain.
- **Graceful degradation** — every external service is optional. No key or a failed call falls back to a deterministic search-and-synthesize path; the app never hard-crashes on a missing integration.
- **Clean UI** — ChatGPT-style single-column chat with light/dark themes, a live "researching…" indicator, an agent-steps timeline, and source chips.

## Architecture

A Next.js 15 (App Router, React 19) single-page app. The browser talks to Route Handlers under `src/app/api/`; all agent logic runs server-side in `src/lib/`.

**Request flow** (`POST /api/chat` → [`runAgent`](src/lib/agent/index.ts)):

1. Load recent conversation memory.
2. Run the **ReAct loop** ([`runReactAgent`](src/lib/agent/index.ts)): the model reasons, calls tools, and observes numbered results until it writes a cited answer.
3. If OpenAI is unconfigured or errors, fall back to the deterministic path ([`runFallback`](src/lib/agent/index.ts) + `synthesizeLocally`).
4. Persist messages, the run (with its step trace and citations), and a conversation summary.

**Three-layer persistence pattern** — Memory, DB, and RAG each pair a real backend with an in-process `globalThis` fallback ([runtime-store.ts](src/lib/runtime-store.ts)):

- **Memory** ([src/lib/memory](src/lib/memory/index.ts)) — Redis (`aegis:session:*`), falling back to the runtime store, with reads able to fall through to Postgres. Recent window: 5 messages.
- **Database** ([src/lib/db](src/lib/db/index.ts)) — Postgres via `pg`; schema is auto-created lazily (no migration step). No `DATABASE_URL` → returns runtime-store data.
- **RAG** ([src/lib/rag](src/lib/rag/index.ts)) — semantic retrieval with **pgvector**: documents (text/PDF) are chunked, embedded with OpenAI `text-embedding-3-small`, stored as `vector(1536)` in Postgres, and queried by cosine similarity (HNSW index). Falls back to in-memory token-overlap scoring when Postgres or embeddings are unavailable.

## API

| Route | Purpose |
|---|---|
| `POST /api/chat` | Main agent turn (needs `sessionId` + `message`; `useWebSearch` toggles the web tool) |
| `GET /api/conversations` | List conversation summaries |
| `GET\|DELETE /api/conversations/[sessionId]` | Load full history / delete from all stores |
| `GET\|POST /api/sources` | List / add a text knowledge document |
| `POST /api/sources/pdf` | Upload up to 3 PDFs (text extracted via `pdfjs-dist`) |
| `GET /api/health` | Liveness |

## Tech stack

TypeScript · Next.js 15 · React 19 · Tailwind CSS · OpenAI (Chat Completions function-calling) · Tavily · Redis · PostgreSQL (`pg`) · `pdfjs-dist`.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
```

Other commands: `npm run build`, `npm run start`, `npm run lint`, `npm run typecheck:tools` (type-checks `evals/` and `scripts/`, which are excluded from the Next build so a production install without devDependencies still builds).

### Environment

All integrations are optional and read from `.env.local` (centralized in [src/lib/env.ts](src/lib/env.ts)). Without them, Aegis runs on its in-memory fallbacks.

| Variable | Used by | Default |
|---|---|---|
| `OPENAI_API_KEY` | the ReAct agent (required for true agent behavior) | — |
| `OPENAI_MODEL` | model selection | `gpt-4.1-mini` |
| `TAVILY_API_KEY` | `web_search` tool | — |
| `REDIS_URL` | short-term memory | — |
| `DATABASE_URL` | Postgres persistence | — |
| `BRAINTRUST_API_KEY` | agent trace spans and the eval harness | — |
| `BRAINTRUST_PROJECT` | Braintrust project name for traces | `aegis-agent-eval` |

> Without a valid `OPENAI_API_KEY`, Aegis still responds — but via the deterministic fallback, not the autonomous ReAct loop.

## Document briefs and evaluation

Beyond single-turn chat, Aegis can turn an uploaded document into a **structured
brief**, and the whole document workflow is covered by a **Braintrust evaluation
harness**.

### Brief mode

`POST /api/brief` runs [`runBriefAgent`](src/lib/agent/brief.ts) — the same ReAct
loop, but with a stricter output contract. The agent searches the knowledge base
(refining across up to 8 iterations), then writes Markdown with exactly four
`##` sections: **Overview**, **Key Findings**, **Gaps & Limitations**,
**Conclusion**. [`parseBriefSections`](src/lib/agent/brief-sections.ts) parses
that back into typed sections, so a missing or renamed heading is a detectable
failure rather than silently-degraded prose. The UI renders the brief alongside
its citations and a downloadable step trace.

### Eval harness

```bash
npm run seed:knowledge   # ingest the demo document (NIST AI RMF 1.0 PDF)
npm test                 # pure-logic unit tests: parser, scorers, chunking
npm run eval             # full Braintrust run (needs BRAINTRUST_API_KEY)
```

- **Dataset** ([evals/dataset.ts](evals/dataset.ts)) — 18 cases against the real
  NIST AI Risk Management Framework 1.0 PDF: 6 direct factual, 5 multi-hop,
  3 "not in the document" (should be declined, not hallucinated), and 4 brief
  requests. Cases pinned from a real past failure carry a `"regression"` tag.
- **Scorers** ([evals/scorers.ts](evals/scorers.ts)) — two LLM-graded:
  `Factuality` (via `autoevals`) and `NoHallucination` (on the "not in the
  document" cases: did the agent decline, or fabricate?); plus three
  programmatic: `CitationValidity` (every `[n]` resolves to a retrieved source),
  `Completeness` (all four brief sections present), and `SearchTrajectory`
  (multi-hop cases should show real search refinement — see the findings write-up
  for why this one is a weak signal).
- **Suite** ([evals/agent.eval.ts](evals/agent.eval.ts)) — two Braintrust
  experiments, one per workflow, calling `runReactAgent` / `runBriefAgent`
  directly.

**[docs/eval-findings.md](docs/eval-findings.md)** writes up what the baseline
run actually surfaced: a retrieval bug that fed the model a document title page
instead of the retrieved chunks (chat Factuality 37.14% → 58.57%), why
`CitationValidity` stayed at a perfect 100% the whole time it was broken, and
why the `SearchTrajectory` scorer *dropped* once retrieval started working.

## Roadmap

- Streaming the agent's steps and answer token-by-token
- Evaluation harness — **done**, built on Braintrust; see [docs/eval-findings.md](docs/eval-findings.md)
- Reranking retrieved chunks and richer chunking (sentence-aware)
