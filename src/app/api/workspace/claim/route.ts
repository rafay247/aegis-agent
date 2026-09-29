import { NextResponse } from "next/server";
import { enforceRateLimit, requireWorkspace } from "@/lib/api";
import { claimUnownedSessions } from "@/lib/db";

// One-time migration for browsers that chatted before workspaces existed:
// moves the listed sessions into this browser's workspace, but only ones
// nobody owns yet.
export async function POST(request: Request) {
  const workspace = requireWorkspace(request);
  if ("response" in workspace) {
    return workspace.response;
  }

  const limited = await enforceRateLimit(request, "write");
  if (limited) {
    return limited;
  }

  const body = (await request.json().catch(() => ({}))) as { sessionIds?: unknown };
  const sessionIds = Array.isArray(body.sessionIds)
    ? body.sessionIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 100).slice(0, 200)
    : [];

  const claimed = await claimUnownedSessions(workspace.workspaceId, sessionIds);
  return NextResponse.json({ claimed });
}
