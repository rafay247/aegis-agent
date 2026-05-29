import { saveChatMessages, saveResearchRun } from "@/lib/db";
import { generateAnswerWithOpenAi } from "@/lib/agent/openai";
import { appendMessages, loadRecentMessages } from "@/lib/memory";
import { retrieveKnowledge } from "@/lib/rag";
import { searchWeb } from "@/lib/tools";
import type {
  AgentPlan,
  ChatRequest,
  ChatResponse,
  ResearchAnswer,
  ResearchSource
} from "@/types";

export type AgentPhase = "phase-1" | "phase-2" | "phase-3";

export const agentBlueprint = {
  name: "Aegis",
  phase: "phase-2" as AgentPhase,
  capabilities: ["chat", "planning", "search", "knowledge-retrieval"]
};

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildPlan(question: string): AgentPlan {
  const normalized = question.toLowerCase();
  const useSearch =
    /latest|recent|today|news|trend|market|current|launch|release|2026/.test(normalized);
  const useRag =
    /agent|framework|stack|rag|retrieval|memory|pinecone|langchain|langgraph/.test(normalized);

  const requestedTools = [
    ...(useSearch ? (["search"] as const) : []),
    ...(useRag ? (["rag"] as const) : [])
  ];

  let reasoning = "This question can be answered directly with current session context.";

  if (useSearch && useRag) {
    reasoning =
      "This question needs fresh web context plus stored knowledge so the answer can compare current information with internal guidance.";
  } else if (useSearch) {
    reasoning = "This question asks for current or recent information, so web retrieval should run before synthesis.";
  } else if (useRag) {
    reasoning = "This question matches the knowledge base, so retrieval should be used before synthesis.";
  }

  return {
    useSearch,
    useRag,
    reasoning,
    requestedTools
  };
}

function dedupeSources(sources: ResearchSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    if (seen.has(source.url)) {
      return false;
    }

    seen.add(source.url);
    return true;
  });
}

function synthesizeLocally(question: string, plan: AgentPlan, sources: ResearchSource[]): ResearchAnswer {
  if (sources.length === 0) {
    return {
      text: `I do not have external retrieval enabled yet, so I answered from the current agent setup. Your question was: "${question}". The next best step is to configure OpenAI and Tavily so Aegis can expand this into a fully grounded answer.`,
      citations: []
    };
  }

  const bulletLines = sources.slice(0, 4).map((source, index) => {
    return `- [${index + 1}] ${source.title}: ${source.snippet}`;
  });

  const text = [
    `Aegis planned this as a ${plan.requestedTools.length > 0 ? plan.requestedTools.join(" + ") : "direct"} response.`,
    "",
    `Question: ${question}`,
    "",
    "What stands out from the retrieved material:",
    ...bulletLines,
    "",
    "Summary:",
    `The available evidence suggests the answer should emphasize ${sources
      .slice(0, 2)
      .map((source) => source.title.toLowerCase())
      .join(" and ")}. This Phase 2 build is already grounding responses in retrieved context and carrying recent session memory into the answer path.`
  ].join("\n");

  return {
    text,
    citations: sources.slice(0, 4)
  };
}

export async function runAgent(request: ChatRequest): Promise<ChatResponse> {
  const sessionId = request.sessionId;
  const recentMessages = await loadRecentMessages(sessionId);
  const plan = buildPlan(request.message);

  const webSources = plan.useSearch ? await searchWeb(request.message) : [];
  const knowledgeChunks = plan.useRag ? retrieveKnowledge(request.message) : [];
  const knowledgeSources = knowledgeChunks.map((chunk) => ({
    ...chunk.source,
    content: chunk.text
  }));
  const allSources = dedupeSources([...webSources, ...knowledgeSources]);

  const openAiAnswer = await generateAnswerWithOpenAi({
    question: request.message,
    memory: recentMessages,
    sources: allSources,
    instructions:
      "You are Aegis, a research intelligence agent. Answer clearly, cite sources when present, and do not fabricate facts."
  }).catch(() => null);

  const answer = openAiAnswer
    ? {
        text: openAiAnswer,
        citations: allSources.slice(0, 4)
      }
    : synthesizeLocally(request.message, plan, allSources);

  const userMessage = {
    id: createId("msg"),
    role: "user" as const,
    content: request.message,
    createdAt: new Date().toISOString()
  };

  const assistantMessage = {
    id: createId("msg"),
    role: "assistant" as const,
    content: answer.text,
    createdAt: new Date().toISOString()
  };

  await Promise.all([
    appendMessages(sessionId, [userMessage, assistantMessage]),
    saveChatMessages(sessionId, [userMessage, assistantMessage])
  ]);

  const run = await saveResearchRun({
    id: createId("run"),
    sessionId,
    question: request.message,
    answer: answer.text,
    plan,
    citations: answer.citations,
    createdAt: new Date().toISOString(),
    usedModel: openAiAnswer ? "openai-response-api" : "local-phase-2-synthesizer"
  });

  return {
    sessionId,
    answer: answer.text,
    plan,
    citations: answer.citations,
    messages: [...recentMessages, userMessage, assistantMessage].slice(-6),
    run
  };
}
