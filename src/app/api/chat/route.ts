import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { enforceRateLimit, requireWorkspace } from "@/lib/api";
import { claimSessionForWorkspace } from "@/lib/session-access";
import type { AgentStreamEvent, ChatRequest } from "@/types";

export async function POST(request: Request) {
  const workspace = requireWorkspace(request);
  if ("response" in workspace) {
    return workspace.response;
  }

  const limited = await enforceRateLimit(request, "chat");
  if (limited) {
    return limited;
  }

  const body = (await request.json().catch(() => ({}))) as Partial<ChatRequest>;

  if (!body.sessionId || !body.message?.trim()) {
    return NextResponse.json(
      {
        error: "Both sessionId and message are required."
      },
      { status: 400 }
    );
  }

  if (!(await claimSessionForWorkspace(body.sessionId, workspace.workspaceId))) {
    return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  }

  const chatRequest: ChatRequest = {
    sessionId: body.sessionId,
    message: body.message.trim(),
    useWebSearch: Boolean(body.useWebSearch)
  };

  // Plain JSON for scripts and older clients; streamed progress for the UI.
  if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
    return NextResponse.json(await runAgent(chatRequest, workspace.workspaceId));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AgentStreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const response = await runAgent(chatRequest, workspace.workspaceId, send);
        send({ type: "done", response });
      } catch {
        send({ type: "error", error: "Aegis could not complete the request. Please try again." });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}
