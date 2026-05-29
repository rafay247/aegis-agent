import { env, hasOpenAiConfig } from "@/lib/env";
import type { ChatMessage, ResearchSource } from "@/types";

type GenerateAnswerParams = {
  question: string;
  memory: ChatMessage[];
  sources: ResearchSource[];
  instructions: string;
};

export async function generateAnswerWithOpenAi({
  question,
  memory,
  sources,
  instructions
}: GenerateAnswerParams) {
  if (!hasOpenAiConfig()) {
    return null;
  }

  const memoryBlock =
    memory.length > 0
      ? memory.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n")
      : "No recent memory.";

  const sourceBlock =
    sources.length > 0
      ? sources
          .map(
            (source, index) =>
              `[${index + 1}] ${source.title}\nURL: ${source.url}\nSnippet: ${source.snippet}\nContent: ${
                source.content ?? "No extracted content."
              }`
          )
          .join("\n\n")
      : "No sources available.";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.openAiApiKey}`
    },
    body: JSON.stringify({
      model: env.openAiModel,
      instructions,
      input: `User question:\n${question}\n\nRecent memory:\n${memoryBlock}\n\nSources:\n${sourceBlock}\n\nWrite a grounded research answer with inline [1], [2] style references when sources are available.`
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with status ${response.status}`);
  }

  const data = (await response.json()) as {
    output_text?: string;
  };

  return data.output_text?.trim() ?? null;
}
