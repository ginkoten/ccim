import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, TOKEN, MCP_BEARER } from "./helpers.js";
import { Adapter } from "../src/index.js";
import { makeLogger } from "../src/util.js";

const args = (n = 1, extra = {}) => ({ to: "claude", text: `test ${n}`, clientId: `send-test-${n}`, hop: 0, ...extra });
const send = async (h, a) => (await h.mcp("grok_send", a)).structuredContent;
const posts = (h) => h.relay.calls.filter((c) => c.op === "send").length;

test("proactive send needs no inbox message and returns a receipt with hop marker", async () => {
  const h = harness();
  const r = await send(h, args());
  assert.equal(r.outcome, "sent");
  assert.equal(r.relay_id, 1);
  assert.equal(r.to, "claude");
  assert.equal(r.hop, 1);
  assert.equal(r.retry_allowed, false);
  assert.equal([...h.relay.queues.get("claude").values()][0].text, "test 1\n\n[ccim-auto from=grok hop=1]");
  assert.equal(h.relay.queues.get("grok").size, 0);
  assert.equal(h.webhook.calls.length, 0);
});

test("allowlist and arguments fail closed without network calls", async () => {
  const h = harness();
  const invalid = [
    { to: "*" }, { to: "grok" }, { to: "someone" }, { to: "CLAUDE" },
    { clientId: "x" }, { clientId: "x".repeat(65) }, { text: " " }, { text: "x".repeat(16384) },
    { hop: -1 }, { hop: Number.MAX_SAFE_INTEGER }, { hop: 1.5 }, { hop: undefined }, { urgent: true },
    { source_message_id: 0 }, { source_message_id: 999 },
  ];
  for (const bad of invalid) {
    const r = await send(h, args(1, bad));
    assert.equal(r.outcome, "rejected", JSON.stringify(bad));
    assert.equal(r.relay_id, null);
  }
  assert.equal(posts(h), 0);
});

test("high hops preserve source provenance without a quota; new messages start their own chain", async () => {
  const h = harness({ MAX_HOP: "2" });
  const id = h.relay.deliver("neo-codex", "grok", "continue [hop:128]");
  const first = await send(h, args(1, { source_message_id: id, hop: 0 }));
  assert.equal(first.hop, 129);
  assert.equal(first.outcome, "sent");
  assert.match([...h.relay.queues.get("claude").values()][0].text, new RegExp(`hop=129 re=#${id}`));
  const embedded = await send(h, args(2, { text: "continue [ccim-auto from=claude hop=32]" }));
  assert.equal(embedded.hop, 33);
  assert.equal((await send(h, args(3, { hop: 256 }))).hop, 257);
  assert.equal((await send(h, args(4))).hop, 1, "new task does not inherit previous chain");
  assert.equal(posts(h), 4);
});

test("same clientId is durable and payload changes or recipient changes are rejected", async () => {
  const h = harness({ STATE_NAMESPACE: "relay/channel/grok" });
  const first = await send(h, args());
  h.advance(60 * 48); // Relay dedupe expires at 24 h; adapter records must not.
  const again = await send(h, args());
  assert.equal(again.relay_id, first.relay_id);
  assert.equal(again.duplicate, true);
  for (const extra of [{ text: "different" }, { to: "neo-codex" }, { hop: 1 }]) {
    assert.equal((await send(h, args(1, extra))).reason, "client_id_reused");
  }
  const r = (await h.mcp("grok_status", { clientId: args().clientId })).structuredContent;
  assert.equal(r.relay_id, first.relay_id);
  assert.equal(r.fingerprint, undefined);
  assert.equal(posts(h), 1);
});

test("old environment quotas and persisted counters do not block sends", async () => {
  const h = harness({ SEND_LIMIT: "1", SEND_DAILY_CAP: "1", SEND_WINDOW_MIN: "10" });
  await h.storage.put("rate:send:claude", { recent: [h.clock.t], day: "2026-10-20", count: 999 });
  for (let n = 1; n <= 110; n++) assert.equal((await send(h, args(n))).outcome, "sent");
  assert.equal(posts(h), 110);
  assert.equal((await send(h, args(110))).duplicate, true);
  assert.equal(posts(h), 110);
});

test("zero legacy quotas cannot disable proactive sends", async () => {
  const h = harness({ SEND_LIMIT: "0", SEND_DAILY_CAP: "0" });
  assert.equal((await send(h, args())).outcome, "sent");
});

test("send tool advertises nonnegative tracing hops without a policy maximum", async () => {
  const { TOOLS } = await import("../src/mcp.js");
  const hop = TOOLS.find(t => t.name === "grok_send").inputSchema.properties.hop;
  assert.equal(hop.minimum, 0);
  assert.equal(hop.maximum, undefined);
});

test("concurrent same-clientId calls issue exactly one POST", async () => {
  const h = harness();
  const results = await Promise.all(Array.from({ length: 8 }, () => send(h, args())));
  assert.equal(posts(h), 1);
  assert.equal(h.relay.queues.get("claude").size, 1);
  assert.ok(results.every((r) => ["sent", "uncertain"].includes(r.outcome)));
});

test("in-flight send blocks different clientIds to that recipient, not other recipients", async () => {
  const h = harness();
  const original = h.adapter.deps.fetch;
  let release, started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  h.adapter.deps.fetch = async (url, init) => {
    if (url.endsWith("/send") && JSON.parse(init.body).to === "claude") { started(); await gate; }
    return original(url, init);
  };
  const pending = send(h, args());
  await waiting;
  assert.equal((await send(h, args(2))).reason, "recipient_has_unconfirmed_send");
  assert.equal((await send(h, args(3, { to: "neo-codex" }))).outcome, "sent");
  release();
  assert.equal((await pending).outcome, "sent");
  assert.equal(posts(h), 2);
});

test("lost relay response stays uncertain across restart and cannot be retried with a new id", async () => {
  const h = harness({ STATE_NAMESPACE: "relay/channel/grok" });
  const original = h.adapter.deps.fetch;
  h.adapter.deps.fetch = async (url, init) => {
    const r = await original(url, init);
    if (url.endsWith("/send")) throw new Error(`lost ${TOKEN}`);
    return r;
  };
  const first = await send(h, args());
  assert.equal(first.outcome, "uncertain");
  assert.equal(first.relay_id, null);
  const restarted = new Adapter({ storage: h.storage }, h.env, { fetch: original, now: () => h.clock.t, log: () => {} });
  h.adapter.fetch = restarted.fetch.bind(restarted);
  assert.equal((await send(h, args())).outcome, "uncertain");
  assert.equal((await send(h, args(2))).reason, "recipient_has_unconfirmed_send");
  assert.equal((await send(h, args(3, { to: "neo-codex" }))).outcome, "sent");
  assert.equal(posts(h), 2);
  assert.equal(h.relay.queues.get("claude").size, 1);
  assert.ok(!JSON.stringify(h.logs).includes(TOKEN));
});

test("known relay rejection is cached without an unrelated quota", async () => {
  const h = harness({ SEND_LIMIT: "1" });
  h.adapter.deps.fetch = async () => new Response(JSON.stringify({ error: "unknown_handle" }), { status: 404 });
  const first = await send(h, args());
  assert.equal(first.outcome, "rejected");
  assert.equal(first.reason, "unknown_handle");
  assert.equal((await send(h, args())).duplicate, true);
  assert.equal((await send(h, args(2))).reason, "unknown_handle");
});

test("storage failure before reserve performs no POST", async () => {
  const h = harness();
  h.storage.transaction = async () => { throw new Error("storage failed"); };
  assert.equal((await send(h, args())).reason, "storage_unavailable_before_send");
  assert.equal(posts(h), 0);
});

test("receipt persistence failure keeps reservation and recipient lock", async () => {
  const h = harness();
  const transaction = h.storage.transaction.bind(h.storage);
  let calls = 0;
  h.storage.transaction = async (fn) => {
    if (++calls === 2) throw new Error("save failed");
    return transaction(fn);
  };
  const first = await send(h, args());
  assert.equal(first.outcome, "sent");
  assert.equal(first.persistence, "receipt_not_saved");
  assert.equal((await send(h, args())).outcome, "uncertain");
  assert.equal((await send(h, args(2))).reason, "recipient_has_unconfirmed_send");
  assert.equal(posts(h), 1);
});

test("response bodies and credentials never appear in return values, logs or durable send records", async () => {
  const h = harness();
  h.adapter.deps.log = makeLogger(h.env, (line) => h.logs.push(line));
  h.adapter.deps.fetch = async () => new Response(`proxy echoed Bearer ${TOKEN}`, { status: 502 });
  assert.equal((await send(h, args(1, { text: TOKEN }))).reason, "credential_in_arguments");
  const result = await send(h, args());
  assert.equal(result.outcome, "uncertain");
  const serialized = JSON.stringify([result, h.logs, [...h.storage.map]]);
  for (const forbidden of [TOKEN, MCP_BEARER, "proxy echoed", "test 1"]) assert.ok(!serialized.includes(forbidden));
});

test("status is read-only and auth applies to proactive sending", async () => {
  const h = harness();
  assert.equal((await h.mcp("grok_send", args(), "wrong")).httpStatus, 401);
  assert.equal((await h.mcp("grok_status", { clientId: "unknown-id" })).structuredContent.found, false);
  assert.equal((await h.mcp("grok_status", { clientId: "unknown-id", ids: [1] })).isError, true);
  assert.equal(posts(h), 0);
});
