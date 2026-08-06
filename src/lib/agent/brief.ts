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
