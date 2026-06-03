import { NextResponse } from "next/server";
import { deleteSessionData, listResearchRuns } from "@/lib/db";
import { deleteConversationMemory, loadConversationMessages, loadConversationRuns } from "@/lib/memory";
import type { AgentPlan, ChatResponse } from "@/types";

const emptyPlan: AgentPlan = {
  useSearch: false,
  useRag: false,
  reasoning: "Loaded from conversation history.",
  requestedTools: []
};

type RouteContext = {
  params: Promise<{
    sessionId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;
  const messages = await loadConversationMessages(sessionId);
  const memoryRuns = await loadConversationRuns(sessionId);
  const runs = memoryRuns.length > 0 ? memoryRuns : await listResearchRuns(sessionId);
  const latestRun = runs[0] ?? null;

  if (messages.length === 0 && !latestRun) {
    return NextResponse.json(
      {
        error: "Conversation not found."
      },
      { status: 404 }
    );
  }

  const response: ChatResponse = {
    sessionId,
    answer: latestRun?.answer ?? "",
    plan: latestRun?.plan ?? emptyPlan,
    citations: latestRun?.citations ?? [],
    messages,
    run:
      latestRun ??
      {
        id: `run-history-${sessionId}`,
        sessionId,
        question: messages.find((message) => message.role === "user")?.content ?? "",
        answer: "",
        plan: emptyPlan,
        citations: [],
        createdAt: messages.at(-1)?.createdAt ?? new Date().toISOString(),
        usedModel: "history-loader"
      }
  };

  return NextResponse.json(response);
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { sessionId } = await context.params;

  await Promise.all([
    deleteConversationMemory(sessionId),
    deleteSessionData(sessionId)
  ]);

  return NextResponse.json({
    deleted: true,
    sessionId
  });
}
