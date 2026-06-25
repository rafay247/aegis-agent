# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Next.js dev server on http://localhost:3000
npm run build    # Production build
npm run start    # Serve the production build
npm run lint     # ESLint (next/core-web-vitals)
```

There is no test suite. Verify changes by running `npm run dev` and exercising the API routes (e.g. `curl localhost:3000/api/health`) or the UI.

## Environment

All external integrations are configured via `.env.local` (loaded automatically by Next.js) and centralized in [src/lib/env.ts](src/lib/env.ts). Every key is optional — see "Graceful degradation" below.

| Var | Used by | Default |
|---|---|---|
| `OPENAI_API_KEY`, `OPENAI_MODEL` | answer synthesis | model defaults to `gpt-4.1-mini` |
| `TAVILY_API_KEY` | web search tool | — |
| `REDIS_URL` | short-term memory | — |
| `DATABASE_URL` | Postgres persistence | — |
| `PINECONE_API_KEY`, `PINECONE_INDEX` | declared but **not yet wired** | — |

Import path alias: `@/*` → `./src/*`.

## Architecture

A Next.js 15 (App Router, React 19) single-page research agent. The browser UI is one large client component ([src/app/page.tsx](src/app/page.tsx), ~880 lines) talking to Route Handlers under `src/app/api/`. All agent logic lives in `src/lib/` and runs server-side only.

### Request flow

`POST /api/chat` → [runAgent()](src/lib/agent/index.ts) is the orchestrator and the file to read first. Per request it:

1. Loads recent conversation memory (`loadRecentMessages`).
2. Builds a plan ([buildPlan](src/lib/agent/index.ts)): a deliberately simple branch — `useWebSearch` flag from the client picks **web search** (Tavily); otherwise it falls back to **RAG** over user-supplied documents. They are mutually exclusive.
3. Runs the chosen retrieval tool, dedupes sources by URL.
4. Calls [generateAnswerWithOpenAi](src/lib/agent/openai.ts) (OpenAI **Responses API**, `/v1/responses`, not chat completions). If OpenAI is unconfigured or errors, falls back to [synthesizeLocally](src/lib/agent/index.ts) which formats sources into a fixed Overview/Highlights/Source Notes/Citation Links/Retrieval Path template. The OpenAI prompt is instructed to emit that same structure.
5. Persists the user+assistant messages and a `ResearchRun` to **both** memory and Postgres, then upserts a conversation summary.

### The three-layer persistence pattern (most important thing to understand)

Memory, DB, and RAG each follow the same shape: a real backend with an **in-process global fallback**. Read [src/lib/runtime-store.ts](src/lib/runtime-store.ts) first — it's a `globalThis`-backed `Map<sessionId, {messages, runs, summary}>` that survives module reloads in dev and serves as the universal fallback.

- **Memory** ([src/lib/memory/](src/lib/memory/index.ts)): Redis (lists/hashes keyed `aegis:session:*`) → falls back to the runtime store, and reads can also fall through to Postgres. Recent-message window is 5. Every Redis call is wrapped in try/catch that silently degrades.
- **Database** ([src/lib/db/](src/lib/db/index.ts)): Postgres via `pg` Pool. Schema (`aegis_sessions`, `aegis_messages`, `aegis_research_runs`) is auto-created lazily by [ensurePostgresSchema](src/lib/db/client.ts) on first query — no migration step. If no `DATABASE_URL`, every function returns the runtime-store data instead.
- **RAG** ([src/lib/rag/](src/lib/rag/index.ts)): semantic retrieval via **pgvector**. [embeddings.ts](src/lib/rag/embeddings.ts) embeds chunks with OpenAI `text-embedding-3-small` (1536-dim); [vector-store.ts](src/lib/rag/vector-store.ts) stores them in `aegis_knowledge_chunks` (`vector(1536)`, HNSW cosine index, lazily created) and queries with the `<=>` operator. Documents are added explicitly by the user (paste text or upload PDF), chunked (~1200 chars, 150 overlap), never auto-ingested. Falls back to a module-level in-memory token-overlap array when Postgres or embeddings are unavailable. `retrieveKnowledge`/`addKnowledgeDocument`/`listKnowledgeSources` are **async**.

Pools and clients are cached on `globalThis` (`__aegis*__`) to avoid exhausting connections across hot reloads.

### API surface

- `POST /api/chat` — main agent turn (requires `sessionId` + `message`).
- `GET /api/conversations` — list conversation summaries.
- `GET|DELETE /api/conversations/[sessionId]` — load full history (reconstructs a `ChatResponse` from the latest run) / delete from all stores.
- `GET|POST /api/sources` — list / add a text knowledge document.
- `POST /api/sources/pdf` — upload up to 3 PDFs; text extracted with `pdfjs-dist` legacy build (max via `maxPdfSources`).
- `GET /api/health` — liveness.

### Conventions & gotchas

- Shared types live in [src/types/index.ts](src/types/index.ts); import via `@/types`.
- Failures in external services degrade silently to fallbacks rather than throwing to the user — preserve this pattern when editing the lib layer.
- `agentBlueprint.phase`/`/api/health` report `phase-2`; `usedModel` on a run distinguishes `openai-response-api` vs `local-phase-2-synthesizer`.
- Observability ([src/lib/observability/](src/lib/observability/index.ts)) is a config stub only (`enabled: false`).
- README's recommended stack (LangChain, Pinecone, Firecrawl, Exa, Prisma) is aspirational; the actual implementation is plain `fetch` + `pg` + `redis` + in-memory RAG.
