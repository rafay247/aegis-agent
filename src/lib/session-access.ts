import { assignSessionWorkspace, getSessionWorkspace } from "@/lib/db";
import { getSessionState, peekSessionState } from "@/lib/runtime-store";

// Conversations belong to the workspace that started them. Postgres is the
// source of truth; without it, the in-process store remembers the owner.

// For writes (a new chat turn): claims an unowned session, then checks it.
export async function claimSessionForWorkspace(sessionId: string, workspaceId: string) {
  const owner = await assignSessionWorkspace(sessionId, workspaceId);
  const state = getSessionState(sessionId);

  if (owner !== undefined) {
    state.workspaceId = owner;
    return owner === workspaceId;
  }

  state.workspaceId ??= workspaceId;
  return state.workspaceId === workspaceId;
}

// For reads and deletes: only the owning workspace gets in. Sessions nobody
// owns (created before workspaces) must be claimed first.
export async function sessionBelongsToWorkspace(sessionId: string, workspaceId: string) {
  const owner = await getSessionWorkspace(sessionId);

  if (owner !== undefined) {
    return owner === workspaceId;
  }

  const localOwner = peekSessionState(sessionId)?.workspaceId;
  return localOwner === undefined || localOwner === workspaceId;
}
