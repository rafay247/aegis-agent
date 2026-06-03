import type { ChatMessage, ConversationSummary, ResearchRun } from "@/types";

type SessionState = {
  messages: ChatMessage[];
  runs: ResearchRun[];
  summary?: ConversationSummary;
};

declare global {
  var __aegisStore__: Map<string, SessionState> | undefined;
}

function getStore() {
  if (!globalThis.__aegisStore__) {
    globalThis.__aegisStore__ = new Map<string, SessionState>();
  }

  return globalThis.__aegisStore__;
}

export function getSessionState(sessionId: string): SessionState {
  const store = getStore();
  const existing = store.get(sessionId);

  if (existing) {
    return existing;
  }

  const created: SessionState = {
    messages: [],
    runs: []
  };

  store.set(sessionId, created);
  return created;
}

export function listSessionStates() {
  return Array.from(getStore().values());
}

export function deleteSessionState(sessionId: string) {
  getStore().delete(sessionId);
}
