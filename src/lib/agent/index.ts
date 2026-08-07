import { saveChatMessages, saveResearchRun } from "@/lib/db";
import { callChatModel, hasOpenAiConfig } from "@/lib/agent/openai";
import type { ChatModelMessage, ChatTool } from "@/lib/agent/openai";
import {
  appendMessages,
  appendResearchRunMemory,
  loadConversationMessages,
  loadRecentMessages,
  upsertConversationSummary
} from "@/lib/memory";
import { tracedSpan } from "@/lib/observability";
import { listKnowledgeSources, retrieveKnowledge } from "@/lib/rag";
import { searchWeb } from "@/lib/tools";
import type {
  AgentPlan,
  AgentStep,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ResearchAnswer,
  ResearchSource
} from "@/types";

export type AgentPhase = "phase-1" | "phase-2" | "phase-3";

export const agentBlueprint = {
  name: "Aegis",
  phase: "phase-3" as AgentPhase,
  capabilities: ["chat", "react-loop", "tool-use", "web-search", "knowledge-retrieval", "memory"]
};

// How many reason -> act -> observe cycles the agent may take before it must answer.
const MAX_AGENT_ITERATIONS = 5;

const AGENT_SYSTEM_PROMPT = [
  "You are Aegis, an autonomous research agent.",
  "Decide for yourself whether you need to look things up. Call web_search for anything current, factual, statistical, or that you are not fully certain about. Call search_knowledge to consult the user's own uploaded documents and notes.",
  "You may call tools more than once to refine or broaden your research. Before answering, check that the retrieved evidence actually covers every part of the question — a question with two or more parts usually needs one search per part. If a part is not covered, search again with different wording (narrower, or using the source's own terminology) instead of answering that part from memory.",
  "Ground every claim in the retrieved evidence. If, after refining, the evidence still does not cover part of the question, say plainly what you could not find rather than filling the gap from prior knowledge. Once the evidence covers the question, stop calling tools and write the answer.",
  "Write a clear, direct answer in natural prose (1-3 short paragraphs; use bullets only when they genuinely help). Put inline citations like [1] or [2] immediately after the claims they support, matching the numbered sources returned by the tools.",
  "Do not add a separate 'Sources' or 'Links' section; the interface shows the sources on its own. If you could not find reliable information, say so honestly. Never invent facts or URLs."
].join(" ");

const WEB_SEARCH_TOOL: ChatTool = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the live web for current, factual, or recent information. Returns numbered sources with titles, URLs, and snippets.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "A focused search query." }
      },
      required: ["query"]
    }
  }
};

export const KNOWLEDGE_TOOL: ChatTool = {
  type: "function",
  function: {
    name: "search_knowledge",
    description:
      "Search the user's private uploaded documents and notes (RAG). Use when the question may relate to the user's own sources.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "A focused search query." }
      },
      required: ["query"]
    }
  }
};

export function createId(prefix: string) {
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

export function cleanSourceText(text: string, maxLength = 220) {
  const cleanedText = text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "") // markdown images
    .replace(/\[\[?[^\]]*\]?\]\([^)]+\)/g, "") // markdown / footnote links
    .replace(/\[\d+\]/g, "") // bare footnote refs like [46]
    .replace(/[•·▪◦*►▶|]+/g, " ") // bullet / navigation glyphs
    .replace(/(?:\s*[.)\]·•]\s*){3,}/g, " ") // runs of stray punctuation/dots
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:)\]\-–—|]+/, "") // leading junk
    .trim();

  if (cleanedText.length <= maxLength) {
    return cleanedText;
  }

  return `${cleanedText.slice(0, maxLength).replace(/\s+\S*$/, "")}...`;
}

// Without an LLM, the best we can do is surface the cleanest, most sentence-like
// excerpt from the retrieved sources as a short text answer.
function extractLead(text: string) {
  const cleaned = cleanSourceText(text, Number.MAX_SAFE_INTEGER);
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  const readable = sentences.filter((sentence) => {
    const letters = (sentence.match(/[a-zA-Z]/g) ?? []).length;
    const words = sentence.split(/\s+/).filter(Boolean).length;
    return letters >= 20 && words >= 5;
  });

  const lead = readable.slice(0, 2).join(" ").trim();
  if (lead.length > 0) {
    return lead.length > 480 ? `${lead.slice(0, 480).replace(/\s+\S*$/, "")}...` : lead;
  }

  return cleaned.slice(0, 240).trim();
}

function synthesizeLocally(question: string, plan: AgentPlan, sources: ResearchSource[]): ResearchAnswer {
  if (sources.length === 0) {
    const nextStep = plan.useRag
      ? "Add some source content from the attach button, or turn on Smart Search for live web results."
      : "Turn on Smart Search for live web results, or attach your own sources.";

    return {
      text: `I couldn't find anything to answer that yet. ${nextStep}`,
      citations: []
    };
  }

  const topSources = sources.slice(0, 4);

  // Lead with the most informative excerpt as a plain-language answer; the UI
  // renders the source links as chips beneath it, so we don't list them here.
  // Same content-before-snippet ordering as registerSources: `content` is the
  // retrieved chunk, `snippet` is only a document-level preview.
  const leads = topSources.map((source) => extractLead(source.content || source.snippet || source.title));

  // Score prose quality: reward readable length, penalize number-heavy metadata
  // (subscriber/like/view counts, dates) so we prefer encyclopedic sources.
  function leadScore(lead: string) {
    if (lead.length < 60) {
      return -1;
    }

    const digits = (lead.match(/\d/g) ?? []).length;
    const digitRatio = digits / lead.length;
    return Math.min(lead.length, 320) - digitRatio * 800;
  }

  const bestLeadIndex = leads.reduce(
    (bestIndex, lead, index) => (leadScore(lead) > leadScore(leads[bestIndex]) ? index : bestIndex),
    0
  );
  const lead = leads[bestLeadIndex];
  const citationMark = ` [${bestLeadIndex + 1}]`;

  const text = lead.length > 0
    ? `${lead}${citationMark}`
    : `Here is what I found for "${question}". See the linked sources below for details.`;

  return {
    text,
    citations: topSources
  };
}

type AgentResult = {
  text: string;
  citations: ResearchSource[];
  steps: AgentStep[];
};

// A RAG chunk is ~1200 chars (see CHUNK_SIZE in src/lib/rag/index.ts), so the
// observation body cap has to be at least that or the model only ever sees the
// first third of each retrieved chunk. Web snippets are already capped at 420
// upstream, so this only widens the document path.
const OBSERVATION_BODY_MAX = 1200;

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

        // `content` holds the actual retrieved chunk; `snippet` is only a
        // document-level preview (the first ~150 chars of the *whole* file,
        // identical for every chunk of that document). Preferring `snippet`
        // here meant the model never saw the retrieved evidence for uploaded
        // documents and answered from parametric memory instead — see
        // docs/eval-findings.md. Web results set both to the same text, so
        // this ordering is a no-op for them.
        const body = cleanSourceText(source.content || source.snippet || source.title, OBSERVATION_BODY_MAX);
        return `[${index}] ${source.title} (${source.domain})\n${source.url}\n${body}`;
      })
      .join("\n\n");
  }

  return { sources, registerSources };
}

// The ReAct loop: the model reasons, optionally calls tools, observes the
// results, and repeats until it decides to answer (or hits the iteration cap).
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

// Deterministic fallback when no LLM is configured (or the model call fails):
// run the toggled tool and surface the cleanest excerpt.
async function runFallback(question: string, allowWeb: boolean): Promise<AgentResult> {
  const plan = buildPlan(question, allowWeb);
  const steps: AgentStep[] = [];

  const webSources = plan.useSearch ? await searchWeb(question) : [];
  if (plan.useSearch) {
    steps.push({
      id: createId("step"),
      kind: "tool",
      tool: "web_search",
      input: question,
      summary: `Searched the web for "${question}"`,
      resultCount: webSources.length
    });
  }

  const knowledgeSources = plan.useRag
    ? (await retrieveKnowledge(question)).map((chunk) => ({ ...chunk.source, content: chunk.text }))
    : [];
  if (plan.useRag) {
    steps.push({
      id: createId("step"),
      kind: "tool",
      tool: "search_knowledge",
      input: question,
      summary: `Searched your sources for "${question}"`,
      resultCount: knowledgeSources.length
    });
  }

  const allSources = dedupeSources([...webSources, ...knowledgeSources]);
  const answer = synthesizeLocally(question, plan, allSources);
  steps.push({ id: createId("step"), kind: "answer", summary: "Wrote the final answer" });
  return { text: answer.text, citations: answer.citations, steps };
}

function derivePlan(steps: AgentStep[], usedModel: string): AgentPlan {
  const useSearch = steps.some((step) => step.tool === "web_search");
  const useRag = steps.some((step) => step.tool === "search_knowledge");

  return {
    useSearch,
    useRag,
    reasoning:
      usedModel === "openai-react-agent"
        ? "The ReAct agent selected its tools autonomously."
        : "Heuristic fallback selected tools from the Smart Search toggle.",
    requestedTools: [...(useSearch ? (["search"] as const) : []), ...(useRag ? (["rag"] as const) : [])]
  };
}

export async function runAgent(request: ChatRequest): Promise<ChatResponse> {
  const sessionId = request.sessionId;
  const recentMessages = await loadRecentMessages(sessionId);
  const allowWeb = Boolean(request.useWebSearch);
  const knowledgeCount = (await listKnowledgeSources()).length;

  let result: AgentResult;
  let usedModel: string;

  if (hasOpenAiConfig()) {
    try {
      result = await runReactAgent(request.message, recentMessages, allowWeb, knowledgeCount);
      usedModel = "openai-react-agent";

      // If the model produced an empty answer, degrade to the deterministic path.
      if (!result.text) {
        result = await runFallback(request.message, allowWeb);
        usedModel = "local-fallback";
      }
    } catch {
      result = await runFallback(request.message, allowWeb);
      usedModel = "local-fallback";
    }
  } else {
    result = await runFallback(request.message, allowWeb);
    usedModel = "local-fallback";
  }

  const plan = derivePlan(result.steps, usedModel);
  const citations = result.citations.slice(0, 8);

  const userMessage = {
    id: createId("msg"),
    role: "user" as const,
    content: request.message,
    createdAt: new Date().toISOString()
  };

  const assistantMessage = {
    id: createId("msg"),
    role: "assistant" as const,
    content: result.text,
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
    answer: result.text,
    plan,
    citations,
    steps: result.steps,
    createdAt: new Date().toISOString(),
    usedModel
  });

  await appendResearchRunMemory(run);

  await upsertConversationSummary({
    sessionId,
    title: firstUserMessage.slice(0, 64),
    updatedAt: assistantMessage.createdAt
  });

  return {
    sessionId,
    answer: result.text,
    plan,
    citations,
    messages: conversationMessages,
    run
  };
}
