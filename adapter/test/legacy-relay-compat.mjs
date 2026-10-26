// Explicit release check, not part of the portable unit suite. Supply the three bundle paths below.
// Executes saved production JavaScript locally with in-memory Cloudflare storage; never connects to a service.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MemoryStorage, makeEnv, WEBHOOK_URL, MCP_BEARER } from "./helpers.js";

registerHooks({ resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return { shortCircuit: true,
    url: "data:text/javascript,export class DurableObject { constructor(ctx,env) { this.ctx=ctx; this.env=env; } }" };
  return next(specifier, context);
} });
globalThis.WebSocketRequestResponsePair = class {};
globalThis.fetch = async () => { throw Error("Network forbidden in release compatibility test"); };
const fixedTime = Date.UTC(2026, 9, 24, 8);
Date.now = () => fixedTime;
async function bundle(variable, expectedHash) {
  assert.ok(process.env[variable], `${variable} is required`);
  const source = await readFile(process.env[variable], "utf8");
  if (expectedHash) assert.equal(createHash("sha256").update(source).digest("hex"), expectedHash);
  return { source, module: await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`) };
}
const legacyRelay = await bundle("CCIM_LEGACY_RELAY_BUNDLE", "e6ad105f803437ef3c07acbe3f0f6ab50598a8eb08380e46484e89d42256f860");
const legacyAdapter = await bundle("CCIM_LEGACY_ADAPTER_BUNDLE", "84d08d057d10f5a5757ed178a35d615968f8a1d515c0123c8e6cec6f6b10de64");
const candidate = await bundle("CCIM_CANDIDATE_ADAPTER_BUNDLE");

async function fixture(Adapter) {
  const relayStorage = new MemoryStorage();
  const channel = new legacyRelay.module.Channel({ storage: relayStorage, getWebSockets: () => [], setWebSocketAutoResponse() {} }, { LOOP_GUARD: "off" });
  const relayEnv = { CHANNEL: { idFromName: name => name, get: name => { assert.equal(name, "ginkoai"); return channel; } } };
  const request = (op, init = {}) => legacyRelay.module.default.fetch(new Request(`https://relay.test/c/ginkoai/${op}`, init), relayEnv);
  // Test-only memberships, entirely in memory. No production credentials or endpoints are loaded.
  const tokens = {};
  for (const handle of ["ginkoai-grok", "codex", "claude"]) {
    const res = await request("join", { method: "POST", headers: { "x-ccim-secret": "local-fixture-only-channel-secret" }, body: JSON.stringify({ handle, ifAbsent: true }) });
    assert.equal(res.status, 200);
    tokens[handle] = (await res.json()).token;
  }
  const env = makeEnv({ CCIM_CHANNEL: "ginkoai", CCIM_HANDLE: "ginkoai-grok", CCIM_TOKEN: tokens["ginkoai-grok"],
    STATE_NAMESPACE: "ccim-relay-ginko/ginkoai/grok", RELAY_MODE: "direct", ALLOWED_RECIPIENTS: "codex,claude" });
  const storage = new MemoryStorage(), calls = [], wakes = [];
  const h = { storage, relayStorage, env, calls, wakes, loseNextSendResponse: false };
  const deps = { now: () => fixedTime, log() {}, fetch: async (url, init = {}) => {
    if (url === WEBHOOK_URL) { wakes.push(JSON.parse(init.body)); return Response.json({ success: true, runUuid: "fixture-run-1" }); }
    const u = new URL(url);
    assert.equal(u.origin, "https://relay.test");
    const op = u.pathname.split("/")[3] + u.search;
    calls.push({ method: init.method || "GET", op, body: init.body ? JSON.parse(init.body) : null });
    const response = await request(op, init);
    if (op === "send" && h.loseNextSendResponse) { h.loseNextSendResponse = false; throw Error("fixture: response lost after relay accepted send"); }
    return response;
  } };
  h.restart = (Class = Adapter) => { h.adapter = new Class({ storage }, env, deps); };
  h.restart();
  h.tick = async () => (await h.adapter.fetch(new Request("https://adapter.internal/tick", { method: "POST" }))).json();
  h.rpc = async (method, params) => (await h.adapter.fetch(new Request("https://worker.test/mcp", {
    method: "POST", headers: { authorization: `Bearer ${MCP_BEARER}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }))).json();
  h.tool = async (name, args = {}) => (await h.rpc("tools/call", { name, arguments: args })).result;
  h.deliver = async (clientId = "fixture-inbound-001") => {
    const res = await request("send", { method: "POST", headers: { authorization: `Bearer ${tokens.codex}` },
      body: JSON.stringify({ to: "ginkoai-grok", text: "fixture inbound task", clientId }) });
    assert.equal(res.status, 200); return (await res.json()).id;
  };
  return h;
}

// Health is the intended additive field. All other business output must match the saved live adapter.
const business = value => JSON.parse(JSON.stringify(value, (key, v) => ["health", "backlog"].includes(key) ? undefined : v));
async function scenario(Adapter) {
  const h = await fixture(Adapter), results = [];
  const input = await h.deliver();
  results.push(await h.tick());
  results.push(await h.tick()); // already woken: no duplicate webhook
  results.push(await h.tool("grok_inbox", { ids: [input] }));
  const reply = { reply_to_id: input, text: "fixture reply" };
  results.push(await h.tool("grok_reply", reply));
  results.push(await h.tool("grok_reply", reply));
  results.push(await h.tool("grok_ack", { ids: [input] }));
  const send = { to: "claude", text: "fixture proactive", hop: 0, clientId: "fixture-proactive-001" };
  results.push(await h.tool("grok_send", send));
  results.push(await h.tool("grok_send", send));
  results.push(await h.tool("grok_status", { clientId: send.clientId }));
  results.push(await h.tool("grok_status", { ids: [input] }));
  assert.equal(h.wakes.length, 1);
  assert.equal(h.calls.filter(c => c.op === "send").length, 2);
  assert.equal(results[3].structuredContent.outcome, "sent");
  assert.equal(results[4].structuredContent.duplicate, true);
  assert.equal(results[7].structuredContent.duplicate, true);
  return { results: business(results), records: [...h.storage.map], calls: h.calls, wakes: h.wakes };
}

test("compiled candidate excludes unpublished loopguard and lifecycle endpoints", () => {
  assert.doesNotMatch(candidate.source, /loopGuardStatus|loop_guard|loopguard|\/lifecycle/);
});
test("old relay actually rejects the unpublished GET loopguard endpoint", async () => {
  const h = await fixture(candidate.module.Adapter);
  const res = await h.adapter.deps.fetch("https://relay.test/c/ginkoai/loopguard", { headers: { authorization: `Bearer ${h.env.CCIM_TOKEN}` } });
  assert.equal(res.status, 405);
});
test("compiled business flow matches saved live adapter: wake/inbox/reply/ack/send/dedup/status and persisted records", async () => {
  assert.deepEqual(await scenario(candidate.module.Adapter), await scenario(legacyAdapter.module.Adapter));
});
test("candidate upgrades existing uncertain-send ledger without resend or namespace change", async () => {
  const h = await fixture(legacyAdapter.module.Adapter);
  const send = { to: "claude", text: "response will be lost", hop: 0, clientId: "fixture-uncertain-001" };
  h.loseNextSendResponse = true;
  assert.equal((await h.tool("grok_send", send)).structuredContent.outcome, "uncertain");
  const before = structuredClone(h.storage.map), calls = h.calls.length;
  h.restart(candidate.module.Adapter);
  assert.equal((await h.tool("grok_send", send)).structuredContent.outcome, "uncertain");
  assert.equal((await h.tool("grok_send", { ...send, clientId: "fixture-replacement-001" })).structuredContent.reason, "recipient_has_unconfirmed_send");
  assert.equal((await h.tool("grok_status", { clientId: send.clientId })).structuredContent.outcome, "uncertain");
  assert.equal(h.calls.length, calls);
  for (const [key, value] of before) assert.deepEqual(await h.storage.get(key), value);
  assert.equal((await h.relayStorage.list({ prefix: "q:claude:" })).size, 1);
});
test("health on legacy relay uses only authenticated who and preserves state", async () => {
  const h = await fixture(candidate.module.Adapter);
  const res = await h.tool("grok_status", { health: true });
  assert.equal(res.structuredContent.downstream.ok, true);
  assert.equal(res.structuredContent.summary.health.binding.handle, "ginkoai-grok");
  assert.deepEqual(h.calls, [{ method: "GET", op: "who", body: null }]);
  assert.equal(h.storage.map.size, 0);
  assert.equal(h.wakes.length, 0);
});
test("candidate catalog adds only health and identity probe to live catalog; removed query is rejected without network", async () => {
  const old = await fixture(legacyAdapter.module.Adapter), h = await fixture(candidate.module.Adapter);
  const actual = (await h.rpc("tools/list")).result.tools;
  assert.equal(actual.find(t => t.name === "grok_status").inputSchema.properties.health.const, true);
  delete actual.find(t => t.name === "grok_status").inputSchema.properties.health;
  assert.equal(actual.find(t => t.name === "grok_status").inputSchema.properties.probe_identity.const, true);
  delete actual.find(t => t.name === "grok_status").inputSchema.properties.probe_identity;
  assert.deepEqual(actual, (await old.rpc("tools/list")).result.tools);
  assert.equal((await h.tool("grok_status", { loop_guard: true })).isError, true);
  assert.equal(h.calls.length, 0);
});
test("legacy relay real 401 latches across instance rebuild and retains existing send receipt", async () => {
  const h = await fixture(candidate.module.Adapter);
  const send = { to: "claude", text: "retained", hop: 0, clientId: "fixture-retained-001" };
  await h.tool("grok_send", send);
  const token = h.env.CCIM_TOKEN;
  h.env.CCIM_TOKEN = "invalid-local-fixture";
  await h.tick();
  const calls = h.calls.length, records = structuredClone(h.storage.map);
  h.env.CCIM_TOKEN = token;
  h.restart();
  for (let i = 0; i < 5; i++) assert.equal((await h.tick()).error, "downstream_auth_blocked");
  assert.equal((await h.tool("grok_status", { health: true })).structuredContent.downstream.status, 401);
  assert.equal((await h.tool("grok_send", send)).structuredContent.duplicate, true);
  assert.equal(h.calls.length, calls);
  assert.deepEqual(h.storage.map, records);
});
test("explicit one-time recovery against legacy who clears stop without business calls", async () => {
  const h = await fixture(candidate.module.Adapter), token = h.env.CCIM_TOKEN;
  h.env.CCIM_TOKEN = "invalid-local-fixture";
  await h.tick();
  h.env.CCIM_TOKEN = token;
  h.env.AUTH_RECHECK_APPROVAL = "fixture-approved-recovery-001";
  assert.deepEqual(await h.tick(), { polled: false, auth_recovery: { ok: true } });
  assert.deepEqual(h.calls.map(c => c.op), ["inbox?all=1", "who"]);
  assert.equal((await h.tick()).polled, true);
  assert.equal(h.wakes.length, 0);
});

test("compiled live probe authenticates against old relay while blocked and leaves backlog untouched", async () => {
  const h = await fixture(candidate.module.Adapter), token = h.env.CCIM_TOKEN;
  await h.deliver();
  h.env.CCIM_TOKEN = "invalid-local-fixture";
  await h.tick();
  h.env.CCIM_TOKEN = token;
  const records = structuredClone(h.storage.map), queue = structuredClone(h.relayStorage.map), calls = h.calls.length;
  const result = (await h.tool("grok_status", { health: true, probe_identity: true })).structuredContent;
  assert.equal(result.downstream.ok, true);
  assert.equal(result.summary.health.downstream_auth.blocked, true);
  assert.equal(result.probe.source, "worker_bound_identity");
  assert.deepEqual(h.calls.slice(calls), [{ method: "GET", op: "who", body: null }]);
  assert.equal((await h.tick()).error, "downstream_auth_blocked");
  assert.deepEqual(h.storage.map, records);
  assert.deepEqual(h.relayStorage.map, queue);
  assert.equal(h.wakes.length, 0);
});


test("compiled isolation preserves legacy queue and resumes only newer messages", async () => {
  const h = await fixture(candidate.module.Adapter), token = h.env.CCIM_TOKEN;
  const old = await h.deliver();
  h.env.BACKLOG_THROUGH_ID = String(old);
  h.env.CCIM_TOKEN = "fixture-invalid";
  await h.tick();
  h.env.CCIM_TOKEN = token;
  const next = await h.deliver("fixture-new-inbound-002");
  for (const [name,args] of [["grok_inbox",{ids:[old]}],["grok_reply",{reply_to_id:old,text:"forbidden"}],["grok_ack",{ids:[old,next]}]])
    assert.equal((await h.tool(name,args)).isError,true);
  h.env.AUTH_RECHECK_APPROVAL = "fixture-isolation-resume-001";
  assert.equal((await h.tick()).auth_recovery.ok,true);
  assert.deepEqual((await h.tick()).ids,[next]);
  assert.deepEqual((await h.tool("grok_inbox")).structuredContent.messages.map(m=>m.id),[next]);
  assert.equal((await h.relayStorage.list({prefix:"q:ginkoai-grok:"})).size,2);
  assert.equal(h.calls.filter(c=>c.op==="ack").length,0);
});
