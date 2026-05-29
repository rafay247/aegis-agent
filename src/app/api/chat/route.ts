import { NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import type { ChatRequest } from "@/types";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ChatRequest>;

  if (!body.sessionId || !body.message?.trim()) {
    return NextResponse.json(
      {
        error: "Both sessionId and message are required."
      },
      { status: 400 }
    );
  }

  const response = await runAgent({
    sessionId: body.sessionId,
    message: body.message.trim()
  });

  return NextResponse.json(response);
}
