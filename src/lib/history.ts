import type { ChatMessage, ConversationSummary, ResearchRun } from "@/types";

// Pure history helpers shared by the API routes and the browser UI.

// Each chat turn saves one assistant message and one run whose `answer` is that
// message's text, so pair them by answer, oldest first. Brief runs live on the
// same session but belong to the Brief panel.
export function runsByAssistantMessage(messages: ChatMessage[], runs: ResearchRun[]) {
  const unclaimed = runs
    .filter((run) => !run.brief)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const paired = new Map<string, ResearchRun>();

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    const index = unclaimed.findIndex((run) => run.answer === message.content);
    if (index !== -1) {
      paired.set(message.id, unclaimed[index]);
      unclaimed.splice(index, 1);
    }
  }

  return paired;
}

// Union of runs from two stores (Redis + Postgres), newest first.
export function mergeRuns(...sources: ResearchRun[][]) {
  const byId = new Map<string, ResearchRun>();
  for (const run of sources.flat()) {
    byId.set(run.id, run);
  }

  return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

// Union of conversation summaries by session, keeping the most recently updated copy.
export function mergeConversationSummaries(...sources: ConversationSummary[][]) {
  const bySession = new Map<string, ConversationSummary>();
  for (const summary of sources.flat()) {
    const existing = bySession.get(summary.sessionId);
    if (!existing || summary.updatedAt > existing.updatedAt) {
      bySession.set(summary.sessionId, summary);
    }
  }

  return [...bySession.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export type ConversationGroup<T extends ConversationSummary> = {
  label: "Today" | "Yesterday" | "Previous 7 days" | "Older";
  conversations: T[];
};

export function groupConversationsByDate<T extends ConversationSummary>(conversations: T[], now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const groups: ConversationGroup<T>[] = [
    { label: "Today", conversations: [] },
    { label: "Yesterday", conversations: [] },
    { label: "Previous 7 days", conversations: [] },
    { label: "Older", conversations: [] }
  ];

  for (const conversation of conversations) {
    const updated = new Date(conversation.updatedAt).getTime();
    const bucket = updated >= startOfToday ? 0 : updated >= startOfToday - day ? 1 : updated >= startOfToday - 7 * day ? 2 : 3;
    groups[bucket].conversations.push(conversation);
  }

  return groups.filter((group) => group.conversations.length > 0);
}
