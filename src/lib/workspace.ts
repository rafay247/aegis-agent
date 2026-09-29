// Each browser gets its own anonymous workspace (a random id kept in
// localStorage and sent on every API call), so visitors never see or change
// each other's documents and conversations.

export const WORKSPACE_HEADER = "x-aegis-workspace";

// Used by the eval harness and the seed script, which run outside a browser.
export const DEMO_WORKSPACE = "demo-workspace-shared";

const workspaceIdPattern = /^[A-Za-z0-9-]{16,64}$/;

export function isValidWorkspaceId(value: string | null | undefined): value is string {
  return typeof value === "string" && workspaceIdPattern.test(value);
}

export function workspaceFromRequest(request: Request) {
  const value = request.headers.get(WORKSPACE_HEADER);
  return isValidWorkspaceId(value) ? value : null;
}
