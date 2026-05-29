import { listSessionMessages } from "@/lib/db";
import { getRedisClient } from "@/lib/memory/client";
import { getSessionState } from "@/lib/runtime-store";
import type { ChatMessage } from "@/types";

export const memoryConfig = {
  provider: "redis-with-in-memory-fallback",
  recentMessageWindow: 5
};

function sessionMessagesKey(sessionId: string) {
  return `aegis:session:${sessionId}:messages`;
}

export async function loadRecentMessages(sessionId: string) {
  const fallbackMessages = getSessionState(sessionId).messages.slice(-memoryConfig.recentMessageWindow);

  try {
    const redis = await getRedisClient();

    if (!redis) {
      return fallbackMessages;
    }

    const entries = await redis.lRange(sessionMessagesKey(sessionId), -memoryConfig.recentMessageWindow, -1);

    if (entries.length > 0) {
      return entries.map((entry) => JSON.parse(entry) as ChatMessage);
    }

    const persistedMessages = await listSessionMessages(sessionId, memoryConfig.recentMessageWindow);
    return persistedMessages.length > 0 ? persistedMessages : fallbackMessages;
  } catch {
    return fallbackMessages;
  }
}

export async function appendMessages(sessionId: string, messages: ChatMessage[]) {
  const state = getSessionState(sessionId);
  state.messages.push(...messages);

  try {
    const redis = await getRedisClient();

    if (!redis || messages.length === 0) {
      return;
    }

    await redis.rPush(
      sessionMessagesKey(sessionId),
      messages.map((message) => JSON.stringify(message))
    );
    await redis.lTrim(sessionMessagesKey(sessionId), -memoryConfig.recentMessageWindow, -1);
  } catch {
    // Keep the in-process fallback alive if Redis is unavailable.
  }
}
