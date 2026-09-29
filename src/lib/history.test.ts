import { test } from "node:test";
import assert from "node:assert/strict";
import { groupConversationsByDate, mergeConversationSummaries, mergeRuns, runsByAssistantMessage } from "./history";
import type { ChatMessage, ConversationSummary, ResearchRun } from "../types";

function message(id: string, role: ChatMessage["role"], content: string): ChatMessage {
  return { id, role, content, createdAt: "2026-09-29T10:00:00.000Z" };
}

function run(id: string, answer: string, createdAt: string, brief = false): ResearchRun {
  return {
    id,
    sessionId: "s1",
    question: "q",
    answer,
    plan: { useSearch: false, useRag: true, reasoning: "", requestedTools: ["rag"] },
    citations: [],
    createdAt,
    usedModel: "openai-react-agent",
    ...(brief ? { brief: { title: "b", sections: [], citations: [], steps: [] } } : {})
  };
}

test("runsByAssistantMessage gives every assistant answer its own run, not just the latest", () => {
  const messages = [
    message("u1", "user", "first?"),
    message("a1", "assistant", "first answer [1]"),
    message("u2", "user", "second?"),
    message("a2", "assistant", "second answer [1]")
  ];
  const runs = [
    run("r2", "second answer [1]", "2026-09-29T10:02:00.000Z"),
    run("r1", "first answer [1]", "2026-09-29T10:01:00.000Z")
  ];

  const byMessage = runsByAssistantMessage(messages, runs);

  assert.equal(byMessage.get("a1")?.id, "r1");
  assert.equal(byMessage.get("a2")?.id, "r2");
  assert.equal(byMessage.has("u1"), false);
});

test("runsByAssistantMessage ignores brief runs and pairs repeated identical answers in order", () => {
  const messages = [
    message("a1", "assistant", "same"),
    message("a2", "assistant", "same")
  ];
  const runs = [
    run("brief", "same", "2026-09-29T10:03:00.000Z", true),
    run("r2", "same", "2026-09-29T10:02:00.000Z"),
    run("r1", "same", "2026-09-29T10:01:00.000Z")
  ];

  const byMessage = runsByAssistantMessage(messages, runs);

  assert.equal(byMessage.get("a1")?.id, "r1");
  assert.equal(byMessage.get("a2")?.id, "r2");
});

test("mergeRuns unions two stores by id, newest first", () => {
  const merged = mergeRuns(
    [run("r2", "b", "2026-09-29T10:02:00.000Z")],
    [run("r1", "a", "2026-09-29T10:01:00.000Z"), run("r2", "b", "2026-09-29T10:02:00.000Z")]
  );

  assert.deepEqual(merged.map((entry) => entry.id), ["r2", "r1"]);
});

test("mergeConversationSummaries keeps sessions missing from Redis and prefers the newest copy", () => {
  const redis: ConversationSummary[] = [{ sessionId: "a", title: "A", updatedAt: "2026-09-29T09:00:00.000Z" }];
  const postgres: ConversationSummary[] = [
    { sessionId: "a", title: "A", updatedAt: "2026-09-29T11:00:00.000Z" },
    { sessionId: "b", title: "B", updatedAt: "2026-09-29T10:00:00.000Z" }
  ];

  const merged = mergeConversationSummaries(redis, postgres);

  assert.deepEqual(
    merged.map((summary) => [summary.sessionId, summary.updatedAt]),
    [
      ["a", "2026-09-29T11:00:00.000Z"],
      ["b", "2026-09-29T10:00:00.000Z"]
    ]
  );
});

test("groupConversationsByDate buckets into Today / Yesterday / Previous 7 days / Older", () => {
  const now = new Date(2026, 8, 29, 15, 0, 0);
  const at = (days: number) => new Date(2026, 8, 29 - days, 9, 0, 0).toISOString();
  const conversations: ConversationSummary[] = [
    { sessionId: "t", title: "t", updatedAt: at(0) },
    { sessionId: "y", title: "y", updatedAt: at(1) },
    { sessionId: "w", title: "w", updatedAt: at(5) },
    { sessionId: "o", title: "o", updatedAt: at(30) }
  ];

  const groups = groupConversationsByDate(conversations, now);

  assert.deepEqual(
    groups.map((group) => [group.label, group.conversations.map((conversation) => conversation.sessionId)]),
    [
      ["Today", ["t"]],
      ["Yesterday", ["y"]],
      ["Previous 7 days", ["w"]],
      ["Older", ["o"]]
    ]
  );
});
