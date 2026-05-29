import type { RetrievalChunk } from "@/types";

export const ragConfig = {
  provider: "pinecone-ready-in-memory-fallback",
  embeddingModel: "text-embedding-3-small"
};

const knowledgeBase: RetrievalChunk[] = [
  {
    id: "kb-1",
    score: 0,
    text:
      "LangChain is a high-level framework for building LLM applications with tools, retrieval, prompts, and agents. It is useful for fast MVP development, especially when the workflow is still simple.",
    source: {
      id: "source-kb-1",
      title: "Internal Note: LangChain Positioning",
      url: "memory://langchain-positioning",
      domain: "internal-memory",
      snippet: "LangChain is useful for quick MVP agent workflows and tool integrations.",
      kind: "knowledge"
    }
  },
  {
    id: "kb-2",
    score: 0,
    text:
      "LangGraph is better suited to durable, stateful, and controlled agent workflows. It becomes especially valuable when the system needs checkpoints, retries, branching, or human review.",
    source: {
      id: "source-kb-2",
      title: "Internal Note: LangGraph Positioning",
      url: "memory://langgraph-positioning",
      domain: "internal-memory",
      snippet: "LangGraph is stronger for explicit workflow control and durable execution.",
      kind: "knowledge"
    }
  },
  {
    id: "kb-3",
    score: 0,
    text:
      "Pinecone is a production-ready managed vector database with strong support for semantic retrieval, metadata filters, and scalable hosted search.",
    source: {
      id: "source-kb-3",
      title: "Internal Note: Pinecone Positioning",
      url: "memory://pinecone-positioning",
      domain: "internal-memory",
      snippet: "Pinecone is preferred for production-grade RAG infrastructure.",
      kind: "knowledge"
    }
  },
  {
    id: "kb-4",
    score: 0,
    text:
      "A research agent should prioritize source quality, citation clarity, and trustworthy synthesis over flashy autonomy. Users need to understand where each important claim came from.",
    source: {
      id: "source-kb-4",
      title: "Internal Note: Research Agent Principles",
      url: "memory://research-agent-principles",
      domain: "internal-memory",
      snippet: "Trustworthy research agents emphasize source quality and citation clarity.",
      kind: "knowledge"
    }
  }
];

function scoreText(query: string, text: string) {
  const normalizedQuery = query.toLowerCase();
  const tokens = normalizedQuery.split(/\W+/).filter(Boolean);

  return tokens.reduce((score, token) => {
    return score + (text.toLowerCase().includes(token) ? 1 : 0);
  }, 0);
}

export function retrieveKnowledge(query: string, limit = 3) {
  return knowledgeBase
    .map((chunk) => ({
      ...chunk,
      score: scoreText(query, `${chunk.text} ${chunk.source.title} ${chunk.source.snippet}`)
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
