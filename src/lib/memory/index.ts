import { listSessionMessages, listSessionSummaries } from "@/lib/db";
import { mergeConversationSummaries } from "@/lib/history";
import { getRedisClient } from "@/lib/memory/client";
import { deleteSessionState, getSessionState, listSessionStates } from "@/lib/runtime-store";
import type { ChatMessage, ConversationSummary, ResearchRun } from "@/types";

export const memoryConfig = {
  provider: "redis-with-in-memory-fallback",
  recentMessageWindow: 5
};

function sessionMessagesKey(sessionId: string) {
  return `aegis:session:${sessionId}:messages`;
}

function sessionRunsKey(sessionId: string) {
  return `aegis:session:${sessionId}:runs`;
}

function conversationSummariesKey() {
  return "aegis:conversations:summaries";
}

function parseMessage(entry: string) {
  return JSON.parse(entry) as ChatMessage;
}

function parseConversationSummary(entry: string) {
  return JSON.parse(entry) as ConversationSummary;
}

function parseResearchRun(entry: string) {
  return JSON.parse(entry) as ResearchRun;
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
      return entries.map(parseMessage);
    }

    const persistedMessages = await listSessionMessages(sessionId, memoryConfig.recentMessageWindow);
    return persistedMessages.length > 0 ? persistedMessages : fallbackMessages;
  } catch {
    return fallbackMessages;
  }
}

export async function loadConversationMessages(sessionId: string) {
  const fallbackMessages = getSessionState(sessionId).messages;

  try {
    const redis = await getRedisClient();

    if (!redis) {
      const persistedMessages = await listSessionMessages(sessionId, 200);
      return persistedMessages.length > 0 ? persistedMessages : fallbackMessages;
    }

    const entries = await redis.lRange(sessionMessagesKey(sessionId), 0, -1);

    if (entries.length > 0) {
      return entries.map(parseMessage);
    }

    const persistedMessages = await listSessionMessages(sessionId, 200);
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
  } catch {
    // Keep the in-process fallback alive if Redis is unavailable.
  }
}

export async function upsertConversationSummary(summary: ConversationSummary) {
  getSessionState(summary.sessionId).summary = summary;

  try {
    const redis = await getRedisClient();

    if (!redis) {
      return;
    }

    await redis.hSet(conversationSummariesKey(), summary.sessionId, JSON.stringify(summary));
  } catch {
    // Conversation history remains available from the in-process fallback.
  }
}

export async function appendResearchRunMemory(run: ResearchRun) {
  getSessionState(run.sessionId).runs.unshift(run);

  try {
    const redis = await getRedisClient();

    if (!redis) {
      return;
    }

    await redis.lPush(sessionRunsKey(run.sessionId), JSON.stringify(run));
  } catch {
    // Research runs remain available from the in-process fallback.
  }
}

export async function loadConversationRuns(sessionId: string) {
  const fallbackRuns = getSessionState(sessionId).runs;

  try {
    const redis = await getRedisClient();

    if (!redis) {
      return fallbackRuns;
    }

    const entries = await redis.lRange(sessionRunsKey(sessionId), 0, -1);
    return entries.length > 0 ? entries.map(parseResearchRun) : fallbackRuns;
  } catch {
    return fallbackRuns;
  }
}

async function loadRedisSummaries() {
  try {
    const redis = await getRedisClient();
    return redis ? (await redis.hVals(conversationSummariesKey())).map(parseConversationSummary) : [];
  } catch {
    return [];
  }
}

// Redis, Postgres, and this process can each be missing sessions the others
// saved (a write can silently fall back), so the list is their union.
export async function listConversationSummaries() {
  const fallbackSummaries = listSessionStates()
    .map((state) => state.summary)
    .filter(Boolean) as ConversationSummary[];
  const [redisSummaries, postgresSummaries] = await Promise.all([loadRedisSummaries(), listSessionSummaries()]);

  return mergeConversationSummaries(redisSummaries, postgresSummaries, fallbackSummaries);
}

export async function deleteConversationMemory(sessionId: string) {
  deleteSessionState(sessionId);

  try {
    const redis = await getRedisClient();

    if (!redis) {
      return;
    }

    await Promise.all([
      redis.del(sessionMessagesKey(sessionId)),
      redis.del(sessionRunsKey(sessionId)),
      redis.hDel(conversationSummariesKey(), sessionId)
    ]);
  } catch {
    // Deleting from the fallback store already removes it from the current process.
  }
}
