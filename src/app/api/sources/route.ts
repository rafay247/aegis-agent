import { NextResponse } from "next/server";
import { enforceRateLimit, requireWorkspace } from "@/lib/api";
import { addKnowledgeDocument, listKnowledgeSources } from "@/lib/rag";

export async function GET(request: Request) {
  const workspace = requireWorkspace(request);
  if ("response" in workspace) {
    return workspace.response;
  }

  return NextResponse.json({
    sources: await listKnowledgeSources(workspace.workspaceId)
  });
}

export async function POST(request: Request) {
  const workspace = requireWorkspace(request);
  if ("response" in workspace) {
    return workspace.response;
  }

  const limited = await enforceRateLimit(request, "upload");
  if (limited) {
    return limited;
  }

  const body = (await request.json().catch(() => ({}))) as Partial<{
    title: string;
    text: string;
  }>;

  if (!body.text?.trim()) {
    return NextResponse.json(
      {
        error: "Document text is required."
      },
      { status: 400 }
    );
  }

  const source = await addKnowledgeDocument({
    title: body.title?.trim() || "Untitled source",
    text: body.text,
    workspaceId: workspace.workspaceId
  });

  return NextResponse.json({
    source,
    sources: await listKnowledgeSources(workspace.workspaceId)
  });
}
