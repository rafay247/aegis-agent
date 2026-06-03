import { NextResponse } from "next/server";
import { listConversationSummaries } from "@/lib/memory";

export async function GET() {
  const conversations = await listConversationSummaries();

  return NextResponse.json({
    conversations
  });
}
