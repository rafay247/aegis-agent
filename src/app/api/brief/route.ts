import { NextResponse } from "next/server";
import { enforceRateLimit, requireWorkspace } from "@/lib/api";
import { claimSessionForWorkspace } from "@/lib/session-access";
import { runBrief } from "@/lib/agent/brief";
import type { BriefRequest } from "@/types";

export async function POST(request: Request) {
  const workspace = requireWorkspace(request);
  if ("response" in workspace) {
    return workspace.response;
  }

  const limited = await enforceRateLimit(request, "chat");
  if (limited) {
    return limited;
  }

  const body = (await request.json().catch(() => ({}))) as Partial<BriefRequest>;

  if (!body.sessionId || !body.topic?.trim()) {
    return NextResponse.json(
      {
        error: "Both sessionId and topic are required."
      },
      { status: 400 }
    );
  }

  if (!(await claimSessionForWorkspace(body.sessionId, workspace.workspaceId))) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const response = await runBrief(
    {
      sessionId: body.sessionId,
      topic: body.topic.trim()
    },
    workspace.workspaceId
  );

  return NextResponse.json(response);
}
