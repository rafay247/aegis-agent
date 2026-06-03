import { NextResponse } from "next/server";
import { addKnowledgeDocument, listKnowledgeSources } from "@/lib/rag";

const maxPdfSources = 3;

type PdfTextItem = {
  str?: string;
};

async function extractPdfText(file: File) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({
    data
  }).promise;
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => (item as PdfTextItem).str ?? "")
      .filter(Boolean)
      .join(" ");

    if (pageText.trim()) {
      pageTexts.push(pageText);
    }
  }

  return pageTexts.join("\n\n").trim();
}

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
    const text = await extractPdfText(file);

    if (!text) {
      return NextResponse.json(
        {
          error: `${file.name} did not contain extractable text.`
        },
        { status: 400 }
      );
    }

    addedSources.push(
      addKnowledgeDocument({
        title: file.name.replace(/\.pdf$/i, ""),
        text
      })
    );
  }

  return NextResponse.json({
    added: addedSources,
    sources: listKnowledgeSources()
  });
}
