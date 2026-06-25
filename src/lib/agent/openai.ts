import { env, hasOpenAiConfig } from "@/lib/env";

// Minimal typed surface over the OpenAI Chat Completions API, which has the
// most reliable tool-calling semantics for a ReAct loop.

export type ChatToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
};

export type ChatTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export { hasOpenAiConfig };

const REQUEST_TIMEOUT_MS = 30000;

export async function callChatModel(messages: ChatModelMessage[], tools: ChatTool[]): Promise<ChatModelMessage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.openAiApiKey}`
      },
      body: JSON.stringify({
        model: env.openAiModel,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? "auto" : undefined,
        temperature: 0.3
      }),
      // Don't let Next.js cache model calls, and abort if the model stalls.
      cache: "no-store",
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI chat completion failed with status ${response.status}: ${detail.slice(0, 200)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: ChatModelMessage }>;
  };

  const message = data.choices?.[0]?.message;
  if (!message) {
    throw new Error("OpenAI returned no message.");
  }

  return message;
}
