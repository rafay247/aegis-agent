import { NextResponse } from "next/server";
import { addKnowledgeDocument, listKnowledgeSources } from "@/lib/rag";

export async function GET() {
  return NextResponse.json({
    sources: await listKnowledgeSources()
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<{
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
    text: body.text
  });

  return NextResponse.json({
    source,
    sources: await listKnowledgeSources()
  });
}
