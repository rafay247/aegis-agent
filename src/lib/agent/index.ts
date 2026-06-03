import { saveChatMessages, saveResearchRun } from "@/lib/db";
import { generateAnswerWithOpenAi } from "@/lib/agent/openai";
import {
  appendMessages,
  appendResearchRunMemory,
  loadConversationMessages,
  loadRecentMessages,
  upsertConversationSummary
} from "@/lib/memory";
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

function buildPlan(question: string, useWebSearch: boolean): AgentPlan {
  const useSearch = useWebSearch;
  const useRag = !useWebSearch && question.trim().length > 0;

  const requestedTools = [
    ...(useSearch ? (["search"] as const) : []),
    ...(useRag ? (["rag"] as const) : [])
  ];

  let reasoning = "Web search is off, so this question should search stored RAG sources before synthesis.";

  if (useSearch) {
    reasoning = "Web search is on, so live web retrieval should run before synthesis.";
  } else if (useRag) {
    reasoning = "Web search is off, so the knowledge base should be used before synthesis.";
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

function cleanSourceText(text: string, maxLength = 220) {
  const cleanedText = text
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleanedText.length <= maxLength) {
    return cleanedText;
  }

  return `${cleanedText.slice(0, maxLength).replace(/\s+\S*$/, "")}...`;
}

function sourceLabel(source: ResearchSource, index: number) {
  return `[${index + 1}] ${source.title}`;
}

function synthesizeLocally(question: string, plan: AgentPlan, sources: ResearchSource[]): ResearchAnswer {
  if (sources.length === 0) {
    const nextStep = plan.useRag
      ? "Paste source content into the RAG sources panel or turn on web search for live web citations."
      : "Turn on web search or paste source content into the RAG sources panel for grounded citations.";

    return {
      text: `I could not find any retrieved sources for this request. Your question was: "${question}". ${nextStep}`,
      citations: []
    };
  }

  const topSources = sources.slice(0, 4);
  const sourceNames = topSources
    .slice(0, 2)
    .map((source, index) => sourceLabel(source, index))
    .join(" and ");
  const highlightLines = topSources.map((source, index) => {
    const note = cleanSourceText(source.snippet || source.content || source.title, 190);
    return `- ${sourceLabel(source, index)}: ${note}`;
  });
  const sourceNoteLines = topSources.map((source, index) => {
    return `- [${index + 1}] ${source.domain}${source.publishedAt ? `, ${source.publishedAt}` : ""}`;
  });

  const text = [
    "Overview",
    `For "${question}", Aegis found ${topSources.length} relevant source${topSources.length === 1 ? "" : "s"}. The strongest signals come from ${sourceNames}.`,
    "",
    "Highlights",
    ...highlightLines,
    "",
    "Source Notes",
    ...sourceNoteLines,
    "",
    "Citation Links",
    ...topSources.map((source, index) => `- [${index + 1}] ${source.title} - ${source.url}`),
    "",
    "Retrieval Path",
    `Aegis used ${plan.requestedTools.length > 0 ? plan.requestedTools.join(" + ") : "direct synthesis"} and grounded this response in the active citation cards.`
  ].join("\n");

  return {
    text,
    citations: sources.slice(0, 4)
  };
}

export async function runAgent(request: ChatRequest): Promise<ChatResponse> {
  const sessionId = request.sessionId;
  const recentMessages = await loadRecentMessages(sessionId);
  const plan = buildPlan(request.message, Boolean(request.useWebSearch));

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
      [
        "You are Aegis, a research intelligence agent. Answer clearly, cite sources when present, and do not fabricate facts.",
        "Use this exact readable structure when sources are available: Overview, Highlights, Source Notes, Citation Links, Retrieval Path.",
        "Keep Overview to 1-2 short sentences.",
        "Use 3-5 concise hyphen bullets under Highlights. Each bullet should synthesize a finding in your own words and include inline references like [1].",
        "Do not paste raw snippets, menus, image alt text, scraped navigation, or long page excerpts into the answer.",
        "Under Citation Links, list each cited source as '- [n] Title - URL'."
      ].join(" ")
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

  const conversationMessages = await loadConversationMessages(sessionId);
  const firstUserMessage = conversationMessages.find((message) => message.role === "user")?.content ?? request.message;

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

  await appendResearchRunMemory(run);

  await upsertConversationSummary({
    sessionId,
    title: firstUserMessage.slice(0, 64),
    updatedAt: assistantMessage.createdAt
  });

  return {
    sessionId,
    answer: answer.text,
    plan,
    citations: answer.citations,
    messages: conversationMessages,
    run
  };
}
