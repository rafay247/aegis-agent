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

export type CallChatModelOptions = {
  // When set, the reply is streamed and each piece of answer text is passed
  // here as it arrives. Tool calls are still assembled and returned whole.
  onTextDelta?: (text: string) => void;
};

type StreamDelta = {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
};

export async function callChatModel(
  messages: ChatModelMessage[],
  tools: ChatTool[],
  options: CallChatModelOptions = {}
): Promise<ChatModelMessage> {
  const stream = Boolean(options.onTextDelta);
  const controller = new AbortController();
  // An idle timeout: reset whenever data arrives, so a long streamed answer
  // is never cut off, but a stalled request still is.
  let timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const touch = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  };

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
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
        temperature: 0.3,
        stream: stream || undefined
      }),
      // Don't let Next.js cache model calls, and abort if the model stalls.
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OpenAI chat completion failed with status ${response.status}: ${detail.slice(0, 200)}`);
    }

    if (!stream || !response.body) {
      const data = (await response.json()) as {
        choices?: Array<{ message?: ChatModelMessage }>;
      };

      const message = data.choices?.[0]?.message;
      if (!message) {
        throw new Error("OpenAI returned no message.");
      }

      return message;
    }

    return await readStreamedMessage(response.body, options.onTextDelta ?? (() => {}), touch);
  } finally {
    clearTimeout(timeout);
  }
}

// Parses the server-sent-event stream into one assistant message.
export async function readStreamedMessage(
  body: ReadableStream<Uint8Array>,
  onTextDelta: (text: string) => void,
  onChunk: () => void = () => {}
): Promise<ChatModelMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const toolCalls: ChatToolCall[] = [];

  function handleLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return;
    }

    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      return;
    }

    const delta = (JSON.parse(payload) as { choices?: Array<{ delta?: StreamDelta }> }).choices?.[0]?.delta;
    if (!delta) {
      return;
    }

    if (delta.content) {
      content += delta.content;
      onTextDelta(delta.content);
    }

    for (const call of delta.tool_calls ?? []) {
      const existing = (toolCalls[call.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
      existing.id ||= call.id ?? "";
      existing.function.name += call.function?.name ?? "";
      existing.function.arguments += call.function?.arguments ?? "";
    }
  }

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    onChunk();
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handleLine);
  }

  buffer += decoder.decode();
  if (buffer) {
    handleLine(buffer);
  }

  const calls = toolCalls.filter(Boolean);
  return {
    role: "assistant",
    content: content || null,
    ...(calls.length > 0 ? { tool_calls: calls } : {})
  };
}
