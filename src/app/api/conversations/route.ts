import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/api";
import { listConversationSummaries } from "@/lib/memory";

export async function GET(request: Request) {
  const workspace = requireWorkspace(request);
  if ("response" in workspace) {
    return workspace.response;
  }

  const conversations = await listConversationSummaries(workspace.workspaceId);

  return NextResponse.json({
    conversations
  });
}
