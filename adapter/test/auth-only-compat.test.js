import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers.js";
import { TOOLS } from "../src/mcp.js";

test("auth-only status catalog excludes unpublished loop-guard query and keeps health", () => {
  const status = TOOLS.find(t => t.name === "grok_status");
  assert.equal(status.inputSchema.properties.loop_guard, undefined);
  assert.equal(status.inputSchema.properties.health.const, true);
  assert.deepEqual(TOOLS.map(t => t.name), ["grok_send", "grok_inbox", "grok_reply", "grok_ack", "grok_status"]);
});

test("unsupported loop_guard argument fails before any downstream request or state write", async () => {
  const h = harness();
  const result = await h.mcp("grok_status", { loop_guard: true });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /unexpected argument/);
  assert.equal(h.relay.calls.length, 0);
  assert.equal(h.storage.map.size, 0);
});
