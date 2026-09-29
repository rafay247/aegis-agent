import { NextResponse } from "next/server";
import { deleteKnowledgeDocument, listKnowledgeSources } from "@/lib/rag";

type RouteContext = {
  params: Promise<{
    sourceId: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  const { sourceId } = await context.params;
  const deleted = await deleteKnowledgeDocument(sourceId);

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
    sources: await listKnowledgeSources()
  });
}
