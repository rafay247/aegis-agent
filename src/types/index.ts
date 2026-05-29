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
  useSearch: boolean;
  useRag: boolean;
  reasoning: string;
  requestedTools: ToolName[];
};

export type ResearchAnswer = {
  text: string;
  citations: ResearchSource[];
};

export type ResearchRun = {
  id: string;
  sessionId: string;
  question: string;
  answer: string;
  plan: AgentPlan;
  citations: ResearchSource[];
  createdAt: string;
  usedModel: string;
};

export type ChatRequest = {
  sessionId: string;
  message: string;
};

export type ChatResponse = {
  sessionId: string;
  answer: string;
  plan: AgentPlan;
  citations: ResearchSource[];
  messages: ChatMessage[];
  run: ResearchRun;
};
