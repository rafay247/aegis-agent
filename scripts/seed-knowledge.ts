import { extractPdfText } from "../src/lib/rag/pdf";
import { addKnowledgeDocument } from "../src/lib/rag";

const DEMO_DOCUMENT_URL = "https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf";
const DEMO_DOCUMENT_TITLE = "NIST AI Risk Management Framework 1.0";

async function main() {
  console.log(`Fetching ${DEMO_DOCUMENT_URL} ...`);
  const response = await fetch(DEMO_DOCUMENT_URL);
  if (!response.ok) {
    throw new Error(`Failed to download demo document: HTTP ${response.status}`);
  }

  const data = new Uint8Array(await response.arrayBuffer());
  console.log("Extracting text...");
  const text = await extractPdfText(data);

  if (!text) {
    throw new Error("Extracted PDF text was empty.");
  }

  console.log(`Extracted ${text.length} characters. Ingesting into the knowledge base...`);
  const source = await addKnowledgeDocument({ title: DEMO_DOCUMENT_TITLE, text });
  console.log(`Seeded knowledge source: ${source.id} (${source.title})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
