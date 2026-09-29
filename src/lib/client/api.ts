import { WORKSPACE_HEADER, isValidWorkspaceId } from "@/lib/workspace";
import type { AgentStreamEvent } from "@/types";

// Browser-side API helpers. Every request carries this browser's workspace id.

const workspaceStorageKey = "aegis-workspace-id";
let cachedWorkspaceId: string | null = null;

function randomId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// Returns this browser's workspace id, creating one on first use.
// `created` is true only the first time, so callers can run migrations.
export function ensureWorkspaceId(): { workspaceId: string; created: boolean } {
  if (cachedWorkspaceId) {
    return { workspaceId: cachedWorkspaceId, created: false };
  }

  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(workspaceStorageKey);
  } catch {
    stored = null;
  }

  if (isValidWorkspaceId(stored)) {
    cachedWorkspaceId = stored;
    return { workspaceId: stored, created: false };
  }

  const workspaceId = randomId();
  cachedWorkspaceId = workspaceId;
  try {
    window.localStorage.setItem(workspaceStorageKey, workspaceId);
  } catch {
    // Private windows: the id lives for this tab only.
  }

  return { workspaceId, created: true };
}

export function createSessionId() {
  return `session-${randomId()}`;
}

export function apiFetch(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set(WORKSPACE_HEADER, ensureWorkspaceId().workspaceId);
  return fetch(input, { ...init, headers });
}

// Reads a newline-delimited JSON stream, calling onEvent for each event.
export async function readEventStream(body: ReadableStream<Uint8Array>, onEvent: (event: AgentStreamEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (line: string) => {
    if (line.trim()) {
      onEvent(JSON.parse(line) as AgentStreamEvent);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(flush);
  }

  flush(buffer + decoder.decode());
}
