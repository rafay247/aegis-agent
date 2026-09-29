import { NextResponse } from "next/server";
import { addKnowledgeDocument, listKnowledgeSources } from "@/lib/rag";
import { extractPdfText } from "@/lib/rag/pdf";

const maxPdfSources = 3;

export async function POST(request: Request) {
  const formData = await request.formData();
  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.type === "application/pdf")
    .slice(0, maxPdfSources);

  if (files.length === 0) {
    return NextResponse.json(
      {
        error: "Select at least one PDF file."
      },
      { status: 400 }
    );
  }

  const addedSources = [];

  for (const file of files) {
    let text = "";
    try {
      text = await extractPdfText(new Uint8Array(await file.arrayBuffer()));
    } catch {
      // Earlier files in the batch may already be saved, so send the fresh list.
      return NextResponse.json(
        {
          error: `${file.name} couldn't be read. It may be damaged or password-protected.`,
          sources: await listKnowledgeSources()
        },
        { status: 422 }
      );
    }

    if (!text) {
      return NextResponse.json(
        {
          error: `${file.name} has no selectable text (it may be a scanned image).`,
          sources: await listKnowledgeSources()
        },
        { status: 400 }
      );
    }

    addedSources.push(
      await addKnowledgeDocument({
        title: file.name.replace(/\.pdf$/i, ""),
        text
      })
    );
  }

  return NextResponse.json({
    added: addedSources,
    sources: await listKnowledgeSources()
  });
}
