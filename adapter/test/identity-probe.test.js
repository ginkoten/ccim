import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, TOKEN } from "./helpers.js";

const args = { health: true, probe_identity: true };
test("blocked live probe uses current credential once, preserves every record, and cannot resume old backlog", async () => {
  const h = harness({ CCIM_TOKEN: "fixture-invalid" });
  h.relay.deliver("claude", "grok", "old task remains untouched");
  await h.tick();
  h.env.CCIM_TOKEN = TOKEN;
  const before = structuredClone(h.storage.map), queue = structuredClone(h.relay.queues);
  const calls = h.relay.calls.length;
  const result = (await h.mcp("grok_status", args)).structuredContent;
  assert.equal(result.downstream.ok, true);
  assert.equal(result.probe.source, "worker_bound_identity");
  assert.equal(result.summary.health.downstream_auth.blocked, true);
  assert.deepEqual(h.relay.calls.slice(calls), [{ method: "GET", op: "who" }]);
  assert.equal((await h.tick()).error, "downstream_auth_blocked");
  assert.deepEqual(h.storage.map, before);
  assert.deepEqual(h.relay.queues, queue);
  assert.equal(h.webhook.calls.length, 0);
});
test("failed and mismatched live probes do not latch, clear, or write state", async () => {
  for (const blocked of [false, true]) {
    const h = harness({ CCIM_TOKEN: "fixture-invalid" });
    if (blocked) await h.tick();
    const before = structuredClone(h.storage.map);
    assert.equal((await h.mcp("grok_status", args)).structuredContent.downstream.status, 401);
    h.relay.handle = () => [200, { you: "wrong-member" }];
    assert.equal((await h.mcp("grok_status", args)).structuredContent.downstream.ok, false);
    h.relay.down = true;
    assert.equal((await h.mcp("grok_status", args)).structuredContent.downstream.ok, false);
    assert.deepEqual(h.storage.map, before);
  }
});
test("probe rejects missing entry auth and invalid argument combinations before any network", async () => {
  const h = harness();
  assert.equal((await h.mcp("grok_status", args, "invalid-entry")).httpStatus, 401);
  for (const bad of [{ probe_identity: true }, { ...args, ids: [1] }, { ...args, clientId: "fixture-client-001" }, { health: true, probe_identity: false }])
    assert.equal((await h.mcp("grok_status", bad)).isError, true);
  assert.equal(h.relay.calls.length, 0);
  assert.equal(h.storage.map.size, 0);
});
test("OAuth probe refuses without token refresh or any state write", async () => {
  const h = harness({ RELAY_MODE: "author-mcp" });
  const result = (await h.mcp("grok_status", args)).structuredContent;
  assert.equal(result.downstream.status, 501);
  assert.equal(h.relay.calls.length, 0);
  assert.equal(h.storage.map.size, 0);
});
