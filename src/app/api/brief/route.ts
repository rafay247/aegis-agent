import { NextResponse } from "next/server";
import { runBrief } from "@/lib/agent/brief";
import type { BriefRequest } from "@/types";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<BriefRequest>;

  if (!body.sessionId || !body.topic?.trim()) {
    return NextResponse.json(
      {
        error: "Both sessionId and topic are required."
      },
      { status: 400 }
    );
  }

  const response = await runBrief({
    sessionId: body.sessionId,
    topic: body.topic.trim()
  });

  return NextResponse.json(response);
}
