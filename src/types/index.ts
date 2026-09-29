export type AppStatus = "idle" | "running" | "error";

export type Role = "user" | "assistant";

export type ToolName = "search" | "rag";

export type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
};

export type ResearchSource = {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  content?: string;
  publishedAt?: string;
  kind: "web" | "knowledge";
};

export type RetrievalChunk = {
  id: string;
  text: string;
  score: number;
  source: ResearchSource;
};

export type AgentPlan = {
  // Where the user asked Aegis to look; runs saved before modes existed lack it.
  mode?: "web" | "docs";
  useSearch: boolean;
  useRag: boolean;
  reasoning: string;
  requestedTools: ToolName[];
};

export type ResearchAnswer = {
  text: string;
  citations: ResearchSource[];
};

export type AgentStepKind = "tool" | "answer";

export type AgentStep = {
  id: string;
  kind: AgentStepKind;
  tool?: "web_search" | "search_knowledge";
  input?: string;
  summary: string;
  resultCount?: number;
  observation?: string;
  startedAt?: string;
  durationMs?: number;
};

export type BriefSectionHeading = "Overview" | "Key Findings" | "Gaps & Limitations" | "Conclusion";

export type BriefSection = {
  heading: BriefSectionHeading;
  content: string;
  citationIds: number[];
};

export type ResearchBrief = {
  title: string;
  sections: BriefSection[];
  citations: ResearchSource[];
  steps: AgentStep[];
};

export type ResearchRun = {
  id: string;
  sessionId: string;
  question: string;
  answer: string;
  plan: AgentPlan;
  citations: ResearchSource[];
  steps?: AgentStep[];
  createdAt: string;
  usedModel: string;
  brief?: ResearchBrief;
};

export type BriefRequest = {
  sessionId: string;
  topic: string;
};

export type BriefResponse = {
  sessionId: string;
  brief: ResearchBrief;
  run: ResearchRun;
};

export type ConversationSummary = {
  sessionId: string;
  title: string;
  updatedAt: string;
};

export type ChatRequest = {
  sessionId: string;
  message: string;
  useWebSearch?: boolean;
};

export type ChatResponse = {
  sessionId: string;
  answer: string;
  plan: AgentPlan;
  citations: ResearchSource[];
  messages: ChatMessage[];
  run: ResearchRun;
  // Every chat run in the conversation, newest first, so each assistant
  // message can show its own sources and steps (see runsByAssistantMessage).
  runs?: ResearchRun[];
};

// Newline-delimited JSON events streamed by POST /api/chat when the client
// sends `Accept: application/x-ndjson`.
export type AgentStreamEvent =
  | { type: "tool_start"; id: string; tool: "web_search" | "search_knowledge"; query: string }
  | { type: "tool_end"; step: AgentStep }
  | { type: "sources"; sources: ResearchSource[] }
  | { type: "delta"; text: string }
  // Text streamed so far was not the answer (a preamble before a tool call,
  // or a failed attempt before the fallback): clear it.
  | { type: "reset" }
  | { type: "done"; response: ChatResponse }
  | { type: "error"; error: string };
