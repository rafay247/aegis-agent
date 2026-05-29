# Ultra Agent Implementation Plan

This document explains how to build Ultra Agent step by step.

The goal is to move from an empty repository to a working Research AI Agent without guessing what comes next.

## Three-Phase Delivery

The full project is intentionally split into three equal build phases.

### Phase 1: 33.3 percent

Build the architecture and startup app only.

This phase should deliver:

- runnable Next.js app
- Aegis branding
- base folders and project structure
- starter API route
- startup screen
- placeholders for agent, tools, RAG, memory, database, and observability layers

### Phase 2: 33.3 percent

Add the main working features.

This phase should deliver:

- LLM integration
- search tools
- scraping
- PostgreSQL and Redis
- Pinecone retrieval
- basic conversation flow
- source display

Phase 2 implementation status:

- basic chat route added
- session memory added with in-memory fallback
- planning logic added
- search and knowledge retrieval added with demo corpus fallback
- optional OpenAI synthesis path added
- answer and source display added to the UI

### Phase 3: 33.3 percent

Complete the agent and harden it.

This phase should deliver:

- better planning logic
- stronger citations
- evaluation and tracing
- retries, timeouts, and validation
- improved UI and production readiness

## Build Strategy

We will build the project in layers:

1. Project foundation
2. Database and memory
3. Agent skeleton
4. Tooling
5. RAG pipeline
6. UI
7. Observability and evaluation
8. Hardening and production readiness

Each phase should leave the project in a working state.

## Phase 1: Project Foundation

Goal:

Create the app shell and core project structure.

### Step 1.1

Initialize the application with:

- Next.js
- TypeScript
- Tailwind CSS
- ESLint
- Prisma

### Step 1.2

Set up the base folders:

```text
src/
  app/
  components/
  lib/
    agent/
    tools/
    rag/
    db/
    memory/
    observability/
  types/
```

### Step 1.3

Add environment configuration for:

- `OPENAI_API_KEY`
- `EXA_API_KEY`
- `TAVILY_API_KEY`
- `FIRECRAWL_API_KEY`
- `PINECONE_API_KEY`
- `DATABASE_URL`
- `REDIS_URL`
- `LANGSMITH_API_KEY` or `LANGFUSE` variables

### Step 1.4

Set up basic app pages:

- Home page
- Chat screen
- Placeholder history view

Deliverable:

- App runs locally
- Environment variables are wired
- Base folder structure exists

## Phase 2: Database and Memory

Goal:

Create durable storage and recent session memory.

### Step 2.1

Design the PostgreSQL schema.

Recommended initial tables:

- `users`
- `sessions`
- `messages`
- `research_runs`
- `citations`
- `saved_documents`

Each `research_run` should track:

- user question
- final answer
- timestamps
- model used
- tools used
- token usage if available
- status

### Step 2.2

Add Prisma models and migrations.

### Step 2.3

Set up Redis for:

- active session memory
- recent message window
- request caching if useful

### Step 2.4

Define memory behavior.

Recommended first behavior:

- Load last 5 to 10 relevant messages
- Keep long-term memory out of the core loop until retrieval is useful

Deliverable:

- PostgreSQL schema exists
- Redis client is working
- Session and message storage are functional

## Phase 3: Agent Skeleton

Goal:

Build the first agent loop without external tools.

### Step 3.1

Create an agent service that accepts:

- user message
- session ID
- optional user ID

### Step 3.2

Load recent session memory from Redis or PostgreSQL.

### Step 3.3

Call the LLM directly with:

- system prompt
- recent memory
- user message

### Step 3.4

Return a normal answer even before tools are added.

This gives the project a working baseline before tool orchestration.

Deliverable:

- User can chat with a simple non-tool agent

## Phase 4: Add Tooling

Goal:

Give the agent access to current information.

### Step 4.1

Implement the search tools.

Recommended tools:

- `searchWebExa(query)`
- `searchWebTavily(query)`

Each should return structured results with:

- title
- url
- snippet
- date if available

### Step 4.2

Implement the scraping tool.

Recommended function:

- `scrapeUrl(url)`

It should return:

- page title
- cleaned markdown or text
- metadata

### Step 4.3

Wire the agent so it chooses when to use tools.

First routing rules:

- Use web search for "latest", "recent", "today", "news", and current-events style questions
- Skip search when the question is purely conversational
- Combine multiple searches only when the first result set is weak

### Step 4.4

Save tool outputs for traceability.

Deliverable:

- Agent can search and scrape before answering

## Phase 5: Build The RAG Pipeline

Goal:

Add private knowledge retrieval.

### Step 5.1

Create a document ingestion flow.

Pipeline:

1. Receive source content
2. Normalize text
3. Chunk the content
4. Generate embeddings
5. Store chunks in Pinecone
6. Store metadata in PostgreSQL

### Step 5.2

Define chunking behavior.

Recommended start:

- 600 to 1000 token chunks
- 100 to 150 token overlap

### Step 5.3

Create the retrieval function.

Recommended function:

- `retrieveRelevantChunks(query, filters?)`

Filters may include:

- domain
- topic
- document type
- project
- date range

### Step 5.4

Add reranking if retrieval quality is noisy.

### Step 5.5

Update the agent planner:

- Query Pinecone when internal documents or saved knowledge are relevant
- Merge RAG results with web results when both are needed

Deliverable:

- Agent can answer using stored knowledge plus live web data

## Phase 6: Build The UI

Goal:

Make the agent usable and understandable.

### Step 6.1

Create the main chat interface.

Required UI elements:

- input box
- send button
- streaming or progressive response display
- loading states

### Step 6.2

Add source cards below answers.

Each source card should show:

- title
- domain
- URL
- short relevance note if available

### Step 6.3

Add research history.

Show:

- past prompts
- saved answers
- timestamps

### Step 6.4

Expose tool activity.

Examples:

- "Searching web"
- "Reading sources"
- "Retrieving knowledge"

Deliverable:

- User can ask questions and inspect sources from the UI

## Phase 7: Observability and Evaluation

Goal:

Make the system debuggable and measurable.

### Step 7.1

Integrate LangSmith or Langfuse.

Track:

- prompts
- tool calls
- retrieval results
- latency
- failures
- token cost

### Step 7.2

Create a small evaluation set.

Include test prompts such as:

- latest AI news
- compare two frameworks
- answer from private docs only
- answer using both docs and live search
- ambiguous question requiring clarification

### Step 7.3

Define quality checks:

- citation exists for sourced claims
- answer follows instructions
- retrieved sources are relevant
- no unsupported factual claims

Deliverable:

- You can trace and evaluate agent runs

## Phase 8: Hardening and Production Readiness

Goal:

Make the system reliable enough for real users.

### Step 8.1

Add rate limiting and input validation.

### Step 8.2

Add retry logic for flaky external tools.

### Step 8.3

Add timeouts and failure fallbacks.

If search fails:

- the agent should explain the limitation
- it should avoid pretending it searched successfully

### Step 8.4

Add caching where useful:

- repeated searches
- scraped content
- embeddings for unchanged content

### Step 8.5

Improve prompting and answer formatting.

### Step 8.6

Consider upgrading orchestration from LangChain JS to LangGraph JS when:

- the workflow becomes complex
- retries matter
- checkpoints are needed
- multiple branches or verification steps are introduced

Deliverable:

- Stable and explainable system behavior

## Detailed Responsibilities By Layer

### Frontend

Build:

- chat page
- answer cards
- citation list
- history list

Tech:

- Next.js
- React
- Tailwind CSS

### Backend API

Build:

- chat request endpoint
- history endpoint
- ingestion endpoint later

Tech:

- Next.js Route Handlers or Hono
- Zod

### Agent Layer

Build:

- planning logic
- tool selection
- response synthesis

Tech:

- LangChain JS first
- LangGraph JS later if needed

### Search Layer

Build:

- Exa search wrapper
- Tavily search wrapper

### Scraping Layer

Build:

- Firecrawl wrapper
- content normalization

### RAG Layer

Build:

- ingestion service
- embedding generation
- Pinecone storage
- retrieval service

### Memory Layer

Build:

- session memory loader
- message window selection
- save conversation turns

### Database Layer

Build:

- Prisma schema
- repositories or data-access helpers

### Observability Layer

Build:

- trace integration
- cost and latency logging

## Suggested Order Of Real Work

This is the most practical build order:

1. Initialize the Next.js app
2. Add Prisma and PostgreSQL
3. Add Redis session memory
4. Build the basic chat endpoint
5. Connect the LLM for direct responses
6. Add web search tools
7. Add Firecrawl scraping
8. Add Pinecone ingestion and retrieval
9. Merge RAG with web results
10. Add citations UI
11. Add observability
12. Add evaluations and hardening

## Acceptance Criteria

The MVP is complete when:

- The user can ask a research question in the UI
- The agent can decide whether to use search
- The agent can retrieve stored knowledge from Pinecone
- The answer includes meaningful citations
- The last messages affect follow-up answers
- Research runs are saved
- Tracing shows the full execution path

## Risks To Watch Early

- Overcomplicating the agent before the simple loop works
- Storing too much memory too early
- Weak chunking causing low retrieval quality
- Slow response times from too many tools
- Unclear citations that reduce trust
- Building fancy UI before the agent is grounded

## Recommended Principle

Build the thinnest useful version first:

- simple chat
- simple planning
- search
- scrape
- retrieve
- synthesize
- cite

Then improve workflow sophistication after the core loop proves useful.
