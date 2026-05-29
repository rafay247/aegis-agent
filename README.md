# Aegis Agent

Aegis Agent is a Research AI Agent designed to answer questions that require fresh information, retrieved knowledge, short-term memory, and high-quality synthesis.

The core idea is simple:

1. A user asks something like "Summarize the latest AI news."
2. The agent decides what it needs to do.
3. It searches the web and its knowledge base.
4. It retrieves relevant chunks from storage.
5. It combines the findings with recent conversation context.
6. It writes a grounded answer with citations.

This project is designed as a serious, production-capable agent rather than a toy chatbot.

## What This Agent Does

Ultra Agent is optimized for research tasks such as:

- Summarizing current news or recent developments
- Comparing frameworks, companies, tools, or technologies
- Answering questions using both private documents and live web data
- Producing structured research reports with citations
- Remembering recent conversation context to support follow-up questions

Examples:

- "Summarize the latest AI agent frameworks."
- "Compare LangChain, LangGraph, and LlamaIndex."
- "Read our internal notes and compare them to current market trends."
- "Give me a research brief on vector databases for RAG."

## Recommended Stack

This is the recommended stack for the first real version of the agent.

| Layer | Technology | Why |
|---|---|---|
| Language | TypeScript | One language for frontend and backend, strong product velocity |
| Frontend | Next.js + React + Tailwind CSS | Fast UI iteration, good deployment story, excellent developer experience |
| Backend API | Next.js Route Handlers or a small Hono API | Keeps the first version simple and colocated with the app |
| Agent Layer | LangChain JS | Faster MVP with strong tool and retrieval integrations |
| Future Orchestration Upgrade | LangGraph JS | Add explicit workflows, retries, checkpoints, and more control later |
| LLM | OpenAI GPT-4.1 or GPT-4o | Strong reasoning, tool use, summarization |
| Search | Exa + Tavily | Exa for semantic discovery, Tavily for practical search results |
| Scraping | Firecrawl | Clean page extraction for LLM-friendly content |
| Vector DB | Pinecone | Production-ready vector retrieval and metadata filtering |
| Embeddings | OpenAI `text-embedding-3-small` | Good quality at MVP cost |
| Structured Data | PostgreSQL + Prisma | Durable app data, research history, citations, users, sessions |
| Cache / Short-Term Memory | Redis | Fast recent-context lookup and session support |
| Observability | LangSmith or Langfuse | Traces, failures, latency, prompts, token usage |
| Deployment | Vercel + Pinecone + Neon/Supabase + Upstash Redis | Clean hosted setup for a TypeScript product |

## Why This Stack

This stack is the best fit if the goal is to build a useful Research Agent that can become a real product.

TypeScript keeps the system easier to manage because the app, API, and agent layer can all live in the same ecosystem. Pinecone gives the RAG layer room to grow beyond a demo. LangChain JS gets the MVP moving quickly, and LangGraph JS remains available when the agent needs more controlled workflows.

If this were a pure research lab project, Python would be more attractive. For a web-first agent product, the TypeScript path is the better tradeoff.

## Agent Architecture

The architecture has seven main layers:

1. User interface
2. API and session handling
3. Agent planning and tool use
4. Web retrieval
5. Knowledge retrieval
6. LLM synthesis
7. Memory and persistence

### 1. User Interface

The UI provides:

- Chat input
- Response rendering
- Citation cards
- Tool activity indicators
- Conversation history
- Research run history

The user should be able to see both the answer and where it came from.

### 2. API and Session Handling

The backend receives the user query and loads session state:

- Current conversation
- Recent messages
- User preferences if available
- Prior research context if relevant

This layer also validates requests and prepares the agent input.

### 3. Agent Planning and Tool Use

This is the decision layer.

The agent determines:

- Whether it can answer directly
- Whether it needs web search
- Whether it should query the vector database
- Whether it should use both
- Whether it should ask a clarification question

Example:

For "Summarize the latest AI news," the plan would likely be:

1. Search current web sources
2. Scrape top results
3. Filter or rank relevant sources
4. Summarize with citations

For "Compare our internal notes with the latest agent frameworks," the plan would likely be:

1. Search internal knowledge via Pinecone
2. Search the web for current framework data
3. Merge both result sets
4. Write a comparison

### 4. Web Retrieval Layer

This layer fetches current external information.

Recommended tools:

- Exa for semantic and research-oriented discovery
- Tavily for practical web results
- Firecrawl for extracting readable content from URLs

The web retrieval layer should return:

- URL
- Title
- Snippet
- Published date if available
- Extracted content
- Domain
- Retrieval timestamp

### 5. Knowledge Retrieval Layer

This is the RAG system.

Documents are ingested, chunked, embedded, stored, and retrieved later when relevant to a query.

Recommended setup:

- Vector DB: Pinecone
- Embeddings: OpenAI `text-embedding-3-small`
- Chunking: token-aware chunking with overlap
- Metadata filters: source, date, author, topic, document type, trust score

Each stored chunk should include:

- `chunk_text`
- `source_id`
- `source_title`
- `source_url`
- `author`
- `published_date`
- `domain`
- `tags`
- `embedding_model`
- `created_at`
- `credibility_score`

### 6. LLM Synthesis Layer

This is where the agent produces the final answer.

Inputs to the LLM:

- User question
- Recent conversation memory
- Current tool outputs
- Retrieved vector chunks
- Citation metadata
- System instructions

Outputs from the LLM:

- Final answer
- Structured summary if requested
- Citations
- Confidence notes or uncertainty when needed

The LLM should be instructed to:

- Prefer primary or official sources when possible
- Avoid inventing citations
- Be explicit when information is uncertain or conflicting
- Separate known facts from inferences

### 7. Memory and Persistence

Memory should be split into two types.

Short-term memory:

- Last few messages
- Current task context
- Temporary reasoning context

Recommended technology:

- Redis for active sessions

Long-term memory:

- Saved research runs
- User preferences
- Reusable summaries
- Indexed project notes

Recommended technology:

- PostgreSQL for structured records
- Pinecone for semantic retrieval of longer-term knowledge

## Agent Flow

This is the intended end-to-end flow.

### Step 1: User Input

Example input:

`"Summarize the latest AI news"`

The UI sends the question and session information to the backend.

### Step 2: Planning

The agent checks the query and decides:

- Is this a current-events question?
- Does it need web search?
- Does it need private knowledge?
- Is recent conversation context important?

For this example, it decides:

- Search the web first
- Retrieve the top relevant pages
- Summarize the findings

### Step 3: RAG and Tools

The agent calls:

- Search tool for fresh results
- Scraper for page content
- Vector retrieval if internal context is relevant

It gathers the most relevant chunks, documents, and web results.

### Step 4: Memory

The system loads the recent conversation window.

For example:

- The user previously asked about AI agents
- The current answer should preserve that context

### Step 5: LLM

The LLM receives:

- The user question
- Retrieved web content
- RAG results
- Recent memory
- Citation data

It then synthesizes a clean answer.

### Step 6: Output

The response is returned to the user with:

- Final answer
- Source links
- Summary structure
- Possibly follow-up suggestions

## Each Layer Defined Separately

### Frontend Layer

Purpose:

- User interaction
- Display of answers and citations
- Session continuity

Technology:

- Next.js
- React
- Tailwind CSS

### API Layer

Purpose:

- Receive requests
- Load memory
- Start agent runs
- Return responses

Technology:

- Next.js Route Handlers or Hono
- Zod for validation

### Agent Layer

Purpose:

- Choose what to do next
- Decide when to call tools
- Coordinate retrieval and answer generation

Technology:

- LangChain JS
- Future upgrade path to LangGraph JS

### LLM Layer

Purpose:

- Planning
- Reasoning
- Summarization
- Final response generation

Technology:

- OpenAI GPT-4.1 or GPT-4o

### Search Layer

Purpose:

- Retrieve current information from the web

Technology:

- Exa
- Tavily

### Scraping Layer

Purpose:

- Turn web pages into clean text or markdown

Technology:

- Firecrawl

### RAG Layer

Purpose:

- Retrieve relevant stored knowledge

Technology:

- Pinecone
- OpenAI embeddings

Retrieval criteria:

- Semantic similarity
- Recency when needed
- Source quality
- Domain filtering
- Metadata relevance

### Embedding Layer

Purpose:

- Convert queries and text chunks into vectors

Technology:

- OpenAI `text-embedding-3-small`

Why this choice:

- Lower cost
- Good enough for MVP
- Easy upgrade path later

### Database Layer

Purpose:

- Store users, sessions, runs, citations, saved reports

Technology:

- PostgreSQL
- Prisma

### Cache and Memory Layer

Purpose:

- Store last messages and fast session context

Technology:

- Redis

### Observability Layer

Purpose:

- Understand what the agent did
- Trace failures
- Track cost and latency

Technology:

- LangSmith or Langfuse

## RAG Design Details

The RAG pipeline should work like this:

1. Ingest documents or scraped content
2. Clean and normalize text
3. Split into chunks
4. Generate embeddings
5. Store vectors with metadata in Pinecone
6. Retrieve relevant chunks at question time
7. Rerank if necessary
8. Pass top chunks into the LLM

### Chunking Strategy

Recommended starting point:

- Chunk size: 600 to 1000 tokens
- Overlap: 100 to 150 tokens

Goals:

- Preserve context
- Avoid giant chunks
- Keep retrieval precise

### Retrieval Strategy

Recommended initial behavior:

- Top K retrieval: 8 to 12 chunks
- Rerank final context down to 4 to 6 chunks
- Apply metadata filtering when possible

Useful filters:

- Date range
- Domain
- Source type
- Topic
- Project or collection name

## Important Concepts and Terminology

### Agent

An AI system that can reason, choose tools, retrieve data, and take multiple steps before answering.

### Planning

The step where the agent decides what actions are needed before it responds.

### Tool Calling

Allowing the model to use functions such as search, scrape, retrieve, or save.

### RAG

Retrieval-Augmented Generation. The model retrieves relevant information first, then uses it to answer.

### Embeddings

Vector representations of text used for semantic similarity search.

### Vector Database

A system that stores embeddings and retrieves the most semantically similar chunks.

### Hybrid Search

A mix of keyword search and vector search.

### Reranking

A second pass that improves the order of retrieved documents or chunks.

### Short-Term Memory

Recent conversation state needed for the current task.

### Long-Term Memory

Stored knowledge or preferences that remain useful across sessions.

### Guardrails

Rules and validation used to keep the agent safe, predictable, and grounded.

### Observability

The ability to inspect prompts, tool calls, timings, failures, and outputs.

### Evaluation

Systematic testing of answer quality, retrieval quality, faithfulness, and citations.

## Main Challenges

These are the important engineering and product challenges.

### Hallucinations

The agent may invent facts or sources if retrieval is weak or prompts are careless.

### Citation Accuracy

The answer must not claim support from a source that does not actually support it.

### Tool Overuse

The agent may call too many tools and waste time or money.

### Weak Retrieval

If chunking, metadata, or embeddings are poor, the LLM will synthesize weak answers.

### Contradictory Sources

The agent must handle disagreement between sources gracefully.

### Cost Control

Web tools, embeddings, and LLM calls can add up quickly.

### Latency

Users will notice if each answer requires too many slow steps.

### Memory Pollution

Not everything should be stored forever. Bad memory can reduce answer quality.

### Trust and UX

A useful research agent should show where claims came from and where uncertainty remains.

## MVP Scope

The first version should include:

- Chat UI
- Session handling
- Web search
- Web scraping
- Pinecone RAG
- Recent-memory support
- Final answer with citations
- Basic observability

The first version should not include:

- Autonomous browser control
- Email sending
- Scheduling
- Multi-agent coordination
- Full enterprise auth
- Complex workflow automation

## Future Extensions

After the MVP works well, the project can expand into:

- Deep research mode for long-running reports
- Multi-agent reviewer and verifier loops
- Team workspaces
- Uploaded files and ingestion pipelines
- Scheduled briefings
- User memory profiles
- Source trust scoring
- Custom domain-specific research modes

## Suggested Project Structure

One reasonable future structure is:

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
  server/
  types/
```

## Success Criteria

The system is successful when:

- It answers current research questions with citations
- It uses web search when freshness matters
- It uses RAG when stored knowledge is relevant
- It preserves recent conversational context
- It avoids obvious hallucinations
- It returns useful, readable responses with trustworthy sources

## Final Recommendation

If you want the strongest balance of usability, scalability, and product momentum, build Ultra Agent with:

- TypeScript
- Next.js
- LangChain JS
- Pinecone
- OpenAI embeddings
- OpenAI GPT-4.1 or GPT-4o
- Exa + Tavily
- Firecrawl
- PostgreSQL
- Redis
- LangSmith or Langfuse

That gives you a practical Research Agent MVP with a clean path to becoming a serious agent platform later.
