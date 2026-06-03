import type { ResearchSource, RetrievalChunk } from "@/types";

export const ragConfig = {
  provider: "explicit-user-content",
  embeddingModel: "text-embedding-3-small"
};

const userKnowledgeBase: RetrievalChunk[] = [];

function slugifyTitle(title: string) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function createSnippet(text: string) {
  const compactText = text.replace(/\s+/g, " ").trim();
  return compactText.length > 150 ? `${compactText.slice(0, 147)}...` : compactText;
}

export function addKnowledgeDocument({ title, text }: { title: string; text: string }) {
  const normalizedTitle = title.trim() || "Untitled source";
  const normalizedText = text.trim();
  const idSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const sourceSlug = slugifyTitle(normalizedTitle) || "custom-source";
  const source: ResearchSource = {
    id: `source-custom-${idSuffix}`,
    title: normalizedTitle,
    url: `user-content://${sourceSlug}-${idSuffix}`,
    domain: "explicit-content",
    snippet: createSnippet(normalizedText),
    content: normalizedText,
    kind: "knowledge"
  };

  const chunk: RetrievalChunk = {
    id: `custom-${idSuffix}`,
    score: 0,
    text: normalizedText,
    source
  };

  userKnowledgeBase.unshift(chunk);
  return source;
}

export function listKnowledgeSources() {
  return userKnowledgeBase.map((chunk) => chunk.source);
}

function scoreText(query: string, text: string) {
  const normalizedQuery = query.toLowerCase();
  const tokens = normalizedQuery.split(/\W+/).filter((token) => token.length > 2);
  const normalizedText = text.toLowerCase();

  return tokens.reduce((score, token) => {
    return score + (normalizedText.includes(token) ? 1 : 0);
  }, 0);
}

export function retrieveKnowledge(query: string, limit = 3) {
  const scoredChunks = userKnowledgeBase
    .map((chunk) => ({
      ...chunk,
      score: scoreText(query, `${chunk.text} ${chunk.source.title} ${chunk.source.snippet}`)
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  if (scoredChunks.some((chunk) => chunk.score > 0)) {
    return scoredChunks.filter((chunk) => chunk.score > 0);
  }

  return userKnowledgeBase.slice(0, limit);
}
