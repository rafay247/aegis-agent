import { NextResponse } from "next/server";
import { enforceRateLimit, requireWorkspace } from "@/lib/api";
import { deleteSessionData, listResearchRuns } from "@/lib/db";
import { deleteConversationMemory, loadConversationMessages, loadConversationRuns } from "@/lib/memory";
import { mergeRuns } from "@/lib/history";
import { sessionBelongsToWorkspace } from "@/lib/session-access";
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

const notFound = () => NextResponse.json({ error: "Conversation not found." }, { status: 404 });

export async function GET(request: Request, context: RouteContext) {
  const workspace = requireWorkspace(request);
  if ("response" in workspace) {
    return workspace.response;
  }

  const { sessionId } = await context.params;
  if (!(await sessionBelongsToWorkspace(sessionId, workspace.workspaceId))) {
    return notFound();
  }

  const messages = await loadConversationMessages(sessionId);
  // Redis and Postgres can each be missing runs the other saved.
  const [memoryRuns, databaseRuns] = await Promise.all([loadConversationRuns(sessionId), listResearchRuns(sessionId)]);
  const runs = mergeRuns(memoryRuns, databaseRuns);
  // Brief runs (`POST /api/brief`) are stored on the same session's run list as
  // chat runs, but they belong to the Brief panel, not the chat transcript.
  // Reconstruct the chat response from the most recent *chat* run so a brief
  // generated mid-conversation doesn't attach its citations/steps to the last
  // chat message on reload.
  const latestRun = runs.find((run) => !run.brief) ?? null;

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
    runs: runs.filter((run) => !run.brief),
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

export async function DELETE(request: Request, context: RouteContext) {
  const workspace = requireWorkspace(request);
  if ("response" in workspace) {
    return workspace.response;
  }

  const limited = await enforceRateLimit(request, "write");
  if (limited) {
    return limited;
  }

  const { sessionId } = await context.params;
  if (!(await sessionBelongsToWorkspace(sessionId, workspace.workspaceId))) {
    return notFound();
  }

  await Promise.all([
    deleteConversationMemory(sessionId, workspace.workspaceId),
    deleteSessionData(sessionId)
  ]);

  return NextResponse.json({
    deleted: true,
    sessionId
  });
}
