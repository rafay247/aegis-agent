import { hasTavilyConfig, env } from "@/lib/env";
import type { ResearchSource } from "@/types";

export const toolRegistry = ["searchWeb", "retrieveKnowledge"];

const mockSearchCorpus: ResearchSource[] = [
  {
    id: "web-1",
    title: "Building Research Agents That Users Trust",
    url: "https://example.com/research-agents-trust",
    domain: "example.com",
    snippet:
      "High-trust research agents rely on grounded retrieval, visible citations, and clear separation between source facts and model synthesis.",
    content:
      "Grounded research agents perform better when they use a planner, retrieve a small set of relevant sources, and explain the evidence behind major claims.",
    kind: "web",
    publishedAt: "2026-05-01"
  },
  {
    id: "web-2",
    title: "LangChain Versus LangGraph for Production Agents",
    url: "https://example.com/langchain-vs-langgraph",
    domain: "example.com",
    snippet:
      "LangChain is faster for MVPs, while LangGraph is better when a workflow needs explicit state, retries, and branching.",
    content:
      "Teams often start with LangChain for speed, then move more complex orchestration into LangGraph once they need reliability and control over multi-step agent behavior.",
    kind: "web",
    publishedAt: "2026-04-26"
  },
  {
    id: "web-3",
    title: "Vector Databases for Research RAG",
    url: "https://example.com/vector-databases-rag",
    domain: "example.com",
    snippet:
      "Pinecone remains a strong hosted choice for production RAG, especially when metadata filtering and scalable retrieval matter.",
    content:
      "For production research systems, hosted vector infrastructure can simplify operations while keeping search quality and metadata controls strong enough for iterative RAG work.",
    kind: "web",
    publishedAt: "2026-05-05"
  }
];

function scoreQuery(query: string, source: ResearchSource) {
  const tokens = query.toLowerCase().split(/\W+/).filter(Boolean);
  const haystack = `${source.title} ${source.snippet} ${source.content ?? ""}`.toLowerCase();

  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

async function searchWebWithTavily(query: string): Promise<ResearchSource[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      api_key: env.tavilyApiKey,
      query,
      max_results: 5,
      include_answer: false
    })
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    results?: Array<{
      title: string;
      url: string;
      content?: string;
      published_date?: string;
    }>;
  };

  return (data.results ?? []).map((result, index) => ({
    id: `tavily-${index}`,
    title: result.title,
    url: result.url,
    domain: new URL(result.url).hostname,
    snippet: result.content ?? "No snippet returned.",
    content: result.content,
    publishedAt: result.published_date,
    kind: "web"
  }));
}

function searchMockCorpus(query: string) {
  return mockSearchCorpus
    .map((source) => ({
      source,
      score: scoreQuery(query, source)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.source);
}

export async function searchWeb(query: string): Promise<ResearchSource[]> {
  if (hasTavilyConfig()) {
    try {
      const liveResults = await searchWebWithTavily(query);
      if (liveResults.length > 0) {
        return liveResults;
      }
    } catch {
      // Fall back to the mock corpus so the app remains useful without external services.
    }
  }

  const mockResults = searchMockCorpus(query);
  return mockResults.length > 0 ? mockResults : mockSearchCorpus.slice(0, 2);
}
