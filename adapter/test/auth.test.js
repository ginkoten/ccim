import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { Adapter } from "../src/index.js";
import { makeContext, tick, summary } from "../src/core.js";
import { harness, makeEnv, MemoryStorage, TOKEN, MCP_BEARER } from "./helpers.js";

const recheck = (adapter, id = "approved-test-001") => adapter.ctx().relay.recheck(id, undefined, id);

test("downstream 401 persists across restart and token changes; cron stops without losing last poll", async () => {
  const h = harness({ CCIM_TOKEN: "invalid-fixture-token" });
  await h.tick();
  const before = structuredClone(h.storage.map);
  for (let i = 0; i < 8; i++) { h.advance(1); assert.equal((await h.tick()).error, "downstream_auth_blocked"); }
  const restarted = new Adapter({ storage: h.storage }, { ...h.env, CCIM_TOKEN: TOKEN }, h.adapter.deps);
  assert.equal((await tick(restarted.ctx())).polled, false);
  assert.equal(h.relay.calls.length, 1);
  assert.deepEqual(h.storage.map, before);
  const s = await summary(restarted.ctx());
  assert.equal(s.health.downstream_auth.layer, "relay_member");
  assert.equal(s.poll.status, 401);
  assert.ok(!JSON.stringify(s).includes("invalid-fixture-token"));
});

test("entry 401 and tools/list prove nothing about downstream; health uses only who", async () => {
  const h = harness();
  assert.equal((await h.mcp("grok_status", { health: true }, "invalid-entry")).httpStatus, 401);
  assert.equal(h.storage.map.size, 0);
  assert.equal(h.relay.calls.length, 0);
  const realHandle = h.relay.handle.bind(h.relay);
  h.relay.handle = (method, op, body, auth) => op === "who" ? [200, { you: "grok", members: [{ handle: "grok", online: false }] }] : realHandle(method, op, body, auth);
  const status = (await h.mcp("grok_status", { health: true })).structuredContent;
  assert.equal(status.summary.health.entry_auth, "authenticated");
  assert.equal(status.downstream.ok, true);
  assert.deepEqual(h.relay.calls, [{ method: "GET", op: "who" }]);
  assert.equal(h.storage.map.size, 0, "successful diagnostic does not change state");
  assert.equal(h.webhook.calls.length, 0);
});

test("identity mismatch and network errors never become a fabricated auth rejection", async () => {
  const h = harness();
  h.relay.down = true;
  await h.tick(); await h.tick();
  assert.equal((await summary(h.adapter.ctx())).health.downstream_auth.blocked, false);
  h.relay.down = false;
  h.relay.handle = () => [200, { you: "different-member" }];
  const result = await h.mcp("grok_status", { health: true });
  assert.equal(result.structuredContent.downstream.ok, false);
  assert.equal(result.structuredContent.summary.health.downstream_auth.blocked, false);
});

test("auth stops are isolated by channel, member, relay and namespace", async () => {
  const storage = new MemoryStorage();
  let requests = 0;
  const build = extra => makeContext({ storage, env: makeEnv(extra), now: () => 1234, log() {}, fetch: async () => { requests++; return Response.json({ error: "unauthorized" }, { status: 401 }); } });
  const original = build({});
  await tick(original); await tick(original);
  assert.equal(requests, 1);
  for (const extra of [{ CCIM_CHANNEL: "ginkoai" }, { CCIM_HANDLE: "ginkoai-grok" }, { CCIM_RELAY: "https://other.test" }, { STATE_NAMESPACE: "second" }]) await tick(build(extra));
  assert.equal(requests, 5);
});

test("auth stop and explicit recovery preserve accepted, uncertain, clientId and reply records", async () => {
  const h = harness();
  const sent = { to: "claude", text: "one", hop: 0, clientId: "accepted-001" };
  const pending = { to: "neo-codex", text: "two", hop: 0, clientId: "uncertain-001" };
  assert.equal((await h.mcp("grok_send", sent)).structuredContent.outcome, "sent");
  h.relay.down = true;
  assert.equal((await h.mcp("grok_send", pending)).structuredContent.outcome, "uncertain");
  h.relay.down = false;
  await h.storage.put("reply:999:p1", { outcome: "uncertain", clientId: "grok-re-999-p1" });
  await h.storage.put("msg:000000000999", { id: 999, stages: { recorded: 1, woken: 2 }, wake: { attempts: 1 } });
  const records = structuredClone(h.storage.map);
  h.env.CCIM_TOKEN = "invalid-token-fixture";
  await h.tick();
  h.env.CCIM_TOKEN = TOKEN;
  const original = h.relay.handle.bind(h.relay);
  h.relay.handle = (method, op, body, auth) => op === "who" ? [200, { you: "grok" }] : original(method, op, body, auth);
  const calls = h.relay.calls.length;
  assert.equal((await recheck(h.adapter)).ok, true);
  assert.equal(h.relay.calls.length, calls + 1);
  assert.deepEqual(h.relay.calls.at(-1), { method: "GET", op: "who" });
  for (const [k, v] of records) assert.deepEqual(await h.storage.get(k), v);
  assert.equal((await h.mcp("grok_send", sent)).structuredContent.duplicate, true);
  assert.equal((await h.mcp("grok_send", pending)).structuredContent.outcome, "uncertain");
  assert.equal((await h.mcp("grok_send", { ...pending, clientId: "new-key-001" })).structuredContent.reason, "recipient_has_unconfirmed_send");
  assert.equal(h.relay.calls.length, calls + 1);
});

test("recovery rejects wrong identity and duplicate approval; concurrent checks make one request", async () => {
  const h = harness({ CCIM_TOKEN: "invalid-token-fixture" });
  await h.tick();
  h.relay.handle = () => [200, { you: "wrong" }];
  const results = await Promise.all([recheck(h.adapter), recheck(h.adapter)]);
  assert.equal(results.filter(r => r.error === "identity_unverified").length, 1);
  assert.equal(h.relay.calls.length, 2);
  assert.equal((await recheck(h.adapter)).error, "approval_already_used");
  const before = h.relay.calls.length;
  await h.mcp("grok_status", { health: true });
  await h.tick();
  assert.equal(h.relay.calls.length, before);
  const r = await worker.fetch(new Request("https://public.test/auth-recheck", { method: "POST" }), h.env);
  assert.equal(r.status, 404);
});

test("401 error bodies and headers do not enter auth or poll journals", async () => {
  const storage = new MemoryStorage(), logs = [];
  const ctx = makeContext({ storage, env: makeEnv(), log: (...a) => logs.push(a), now: () => 12,
    fetch: async () => Response.json({ error: TOKEN, authorization: MCP_BEARER }, { status: 401, headers: { "x-secret": TOKEN } }) });
  await tick(ctx);
  const output = JSON.stringify({ records: [...storage.map], logs });
  for (const secret of [TOKEN, MCP_BEARER]) assert.ok(!output.includes(secret));
});

test("OAuth health never refreshes and OAuth network failures do not latch a member fault", async () => {
  let calls = 0;
  const ctx = makeContext({ storage: new MemoryStorage(), env: makeEnv({ RELAY_MODE: "author-mcp", OAUTH_REFRESH_TOKEN: "fixture-refresh", OAUTH_CLIENT_ID: "fixture-client" }), log() {},
    fetch: async () => { calls++; throw Error("network"); } });
  assert.equal((await ctx.relay.identity()).status, 501);
  assert.equal(calls, 0);
  await tick(ctx); await tick(ctx);
  assert.equal(calls, 2);
  assert.equal(await ctx.relay.authState(), null);
});


test("read-only health 401 neither resets nor latches control state", async () => {
  const h = harness({ CCIM_TOKEN: "invalid-fixture-token" });
  const result = await h.mcp("grok_status", { health: true });
  assert.equal(result.structuredContent.downstream.status, 401);
  assert.equal(h.storage.map.size, 0);
  assert.equal(h.relay.calls.length, 1);
});

test("send 401 stops future cron, while inbound MCP 401 leaves downstream usable", async () => {
  const h = harness({ CCIM_TOKEN: "invalid-fixture-token" });
  const result = await h.mcp("grok_send", { to: "claude", text: "fixture", hop: 0, clientId: "auth-send-001" });
  assert.equal(result.structuredContent.outcome, "rejected");
  assert.equal((await summary(h.adapter.ctx())).health.downstream_auth.operation, "send");
  await h.tick();
  assert.equal(h.relay.calls.length, 1);
});


test("operator deployment marker authorizes one probe; failure never repeats and success resumes next tick", async () => {
  const h = harness({ CCIM_TOKEN: "invalid-fixture-token" });
  await h.tick();
  h.env.AUTH_RECHECK_APPROVAL = "approved-deploy-001";
  h.env.AUTH_RECHECK_ALLOW_BACKLOG = "approved-deploy-001";
  assert.equal((await h.tick()).auth_recovery.ok, false);
  const afterFailure = h.relay.calls.length;
  for (let i = 0; i < 4; i++) await h.tick();
  assert.equal(h.relay.calls.length, afterFailure);
  h.env.CCIM_TOKEN = TOKEN;
  await h.tick();
  assert.equal(h.relay.calls.length, afterFailure, "changing token does not reuse an already consumed approval");
  h.env.AUTH_RECHECK_APPROVAL = "approved-deploy-002";
  h.env.AUTH_RECHECK_ALLOW_BACKLOG = "approved-deploy-002";
  const recovered = await h.tick();
  assert.deepEqual(recovered, { polled: false, auth_recovery: { ok: true } });
  assert.equal(h.relay.calls.length, afterFailure + 1);
  assert.equal(h.relay.calls.at(-1).op, "who");
  assert.equal((await h.tick()).polled, true);
});
