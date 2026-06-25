import { hasTavilyConfig, env } from "@/lib/env";
import type { ResearchSource } from "@/types";

export const toolRegistry = ["searchWeb", "retrieveKnowledge"];

function cleanSearchContent(content: string | undefined) {
  const cleanedContent = (content ?? "No snippet returned.")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "") // markdown images
    .replace(/\[\[?[^\]]*\]?\]\([^)]+\)/g, "") // markdown / footnote links
    .replace(/\[Image[^\]]*\]/gi, "")
    .replace(/\[\d+\]/g, "") // bare footnote refs like [46]
    .replace(/[•·▪◦*►▶|]+/g, " ") // bullet / navigation glyphs
    .replace(/(?:\s*[.)\]·•]\s*){3,}/g, " ") // runs of stray punctuation/dots
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:)\]\-–—|]+/, "") // leading junk
    .trim();

  return cleanedContent.length > 420
    ? `${cleanedContent.slice(0, 420).replace(/\s+\S*$/, "")}...`
    : cleanedContent;
}

async function searchWebWithTavily(query: string): Promise<ResearchSource[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      api_key: env.tavilyApiKey,
      query,
      max_results: 5,
      include_answer: false
    })
  });

  if (!response.ok) {
    throw new Error(`Tavily search failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    results?: Array<{
      title: string;
      url: string;
      content?: string;
      published_date?: string;
    }>;
  };

  return (data.results ?? []).map((result, index) => {
    const snippet = cleanSearchContent(result.content);

    return {
      id: `tavily-${index}`,
      title: result.title,
      url: result.url,
      domain: new URL(result.url).hostname,
      snippet,
      content: snippet,
      publishedAt: result.published_date,
      kind: "web"
    };
  });
}

export async function searchWeb(query: string): Promise<ResearchSource[]> {
  if (!hasTavilyConfig()) {
    return [];
  }

  try {
    return await searchWebWithTavily(query);
  } catch {
    return [];
  }
}
