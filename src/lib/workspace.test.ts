import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidWorkspaceId, workspaceFromRequest, WORKSPACE_HEADER } from "./workspace";

test("workspace ids must be long random tokens, not arbitrary strings", () => {
  assert.equal(isValidWorkspaceId("3f2b9c1e-7a4d-4e8b-9c0a-1b2c3d4e5f60"), true);
  assert.equal(isValidWorkspaceId("short"), false);
  assert.equal(isValidWorkspaceId("has spaces and ; drop table"), false);
  assert.equal(isValidWorkspaceId(undefined), false);
});

test("workspaceFromRequest reads the workspace header and rejects bad values", () => {
  const good = new Request("http://x", { headers: { [WORKSPACE_HEADER]: "3f2b9c1e-7a4d-4e8b-9c0a-1b2c3d4e5f60" } });
  const bad = new Request("http://x", { headers: { [WORKSPACE_HEADER]: "nope" } });
  assert.equal(workspaceFromRequest(good), "3f2b9c1e-7a4d-4e8b-9c0a-1b2c3d4e5f60");
  assert.equal(workspaceFromRequest(bad), null);
  assert.equal(workspaceFromRequest(new Request("http://x")), null);
});
