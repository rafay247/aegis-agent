import { NextResponse } from "next/server";
import { enforceRateLimit, requireWorkspace } from "@/lib/api";
import { deleteKnowledgeDocument, listKnowledgeSources } from "@/lib/rag";

type RouteContext = {
  params: Promise<{
    sourceId: string;
  }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  const workspace = requireWorkspace(request);
  if ("response" in workspace) {
    return workspace.response;
  }

  const limited = await enforceRateLimit(request, "write");
  if (limited) {
    return limited;
  }

  const { sourceId } = await context.params;
  const deleted = await deleteKnowledgeDocument(sourceId, workspace.workspaceId);

  if (!deleted) {
    return NextResponse.json(
      {
        error: "Document not found."
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    deleted: true,
    sourceId,
    sources: await listKnowledgeSources(workspace.workspaceId)
  });
}
