"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDelivery, listen, acquire } = require("../../plugin/lib/codex-reliability.cjs");
const { runtimeDirectory } = require("../../plugin/lib/codex-ownership.cjs");
const { journalPath, deliveryStatus } = require("../../plugin/lib/codex-journal.cjs");
const { submit } = require("../../plugin/lib/codex-queue.cjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccim-delivery-review-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sessionFile = path.join(dir, "session.json"); fs.writeFileSync(sessionFile, "{}");
  const directory = runtimeDirectory(sessionFile); fs.mkdirSync(directory, { recursive: true });
  const s = { channel: "test", relay: "https://test.invalid", token: "fixture-only" };
  const calls = [], events = [], acks = [];
  let now = 1000000;
  const options = { directory, s, sessionId: "fixture", env: {}, format: () => "fixture body", now: () => now,
    queue: async args => { calls.push(args); return "accepted"; }, log: (e, fields) => events.push({ e, ...fields }),
    api: async (_, method, op) => { acks.push({ method, op }); return { status: 200 }; } };
  return { directory, sessionFile, s, calls, events, acks, options, advance: () => { now += 1000000; } };
}
test("corrupt journal is quarantined and unknown messages reconcile without blind send across restarts", async t => {
  const f = fixture(t), file = journalPath(f.directory, f.s);
  fs.writeFileSync(file, "{broken");
  f.options.queue = async args => { f.calls.push(args); return "uncertain"; };
  assert.equal(await createDelivery(f.options)({ id: 1 }), "uncertain");
  assert.ok(f.calls[0].reconcileOnly); assert.equal(f.acks.length, 0);
  assert.ok(fs.readdirSync(f.directory).some(n => n.includes(".corrupt-")));
  assert.ok(f.events.some(e => e.e === "journal_corrupt"));
  f.advance(); await createDelivery(f.options)({ id: 2 });
  assert.ok(f.calls[1].reconcileOnly);
  assert.equal(deliveryStatus(f.directory, f.s).state, "reconciliation_only");
});
test("valid JSON with invalid journal shape cannot silently become an empty ledger", async t => {
  const f = fixture(t); fs.writeFileSync(journalPath(f.directory, f.s), "[]");
  f.options.queue = async args => { assert.ok(args.reconcileOnly); return "uncertain"; };
  await createDelivery(f.options)({ id: 1 }); assert.equal(f.acks.length, 0);
});
test("journal setup error still releases ownership", async t => {
  const f = fixture(t); fs.mkdirSync(journalPath(f.directory, f.s));
  await assert.rejects(listen({ ...f.options, sessionFile: f.sessionFile, writeSession() {} }), /reliable_receiver_failed/);
  const next = acquire(f.sessionFile); assert.ok(next); next.release();
});
test("recreated channel or changed binding does not reuse ACKs or queue IDs", async t => {
  const f = fixture(t); await createDelivery(f.options)({ id: 1 });
  await createDelivery({ ...f.options, s: { ...f.s, token: "new-fixture-generation" } })({ id: 1 });
  assert.equal(f.calls.length, 2); assert.notEqual(f.calls[0].deliveryId, f.calls[1].deliveryId);
  assert.notEqual(journalPath(f.directory, f.s), journalPath(f.directory, { ...f.s, relay: "https://other.invalid" }));
});
test("legacy ledger requires reconciliation rather than guessing a generation", async t => {
  const f = fixture(t); fs.writeFileSync(path.join(f.directory, "delivery.json"), JSON.stringify({ "test:1": { state: "acked" } }));
  f.options.queue = async args => { assert.ok(args.reconcileOnly); return "uncertain"; };
  await createDelivery(f.options)({ id: 1 }); assert.equal(f.acks.length, 0);
});
test("uncertain delivery backs off, stops automatically after eight attempts, and reports read-only status", async t => {
  const f = fixture(t); f.options.queue = async args => { f.calls.push(args); return "uncertain"; };
  const deliver = createDelivery(f.options);
  for (let i = 0; i < 8; i++) { await deliver({ id: 1 }); await deliver({ id: 1 }); f.advance(); }
  assert.equal(f.calls.length, 8); assert.equal(await deliver({ id: 1 }), "stuck");
  const file = journalPath(f.directory, f.s), before = fs.statSync(file).mtimeMs;
  assert.equal(deliveryStatus(f.directory, f.s).pending[0].state, "stuck");
  assert.equal(fs.statSync(file).mtimeMs, before); assert.equal(f.acks.length, 0);
  assert.equal(f.events.filter(e => e.e === "delivery_stuck").length, 1);
});
function rpc(call) { return { initialize: async () => {}, call, close() {} }; }
test("new messages do not query any queue or history even when history would be huge", async () => {
  const methods = [];
  assert.equal(await submit({ threadId: "t", deliveryId: "id", text: "new", rpcFactory: () => rpc(async method => {
    methods.push(method); assert.equal(method, "thread/queue/add");
    return { result: { queuedSubmission: { clientUserMessageId: "id" } } };
  }) }), "accepted");
  assert.deepEqual(methods, ["thread/queue/add"]);
});
test("quoted or assistant marker text never acknowledges an uncertain delivery", async () => {
  const methods = [];
  const value = await submit({ threadId: "t", deliveryId: "id", reconcileOnly: true, rpcFactory: () => rpc(async method => {
    methods.push(method);
    if (method === "thread/queue/list") return { result: { data: [{ clientUserMessageId: "other", input: [{ text: "[ccim-delivery:id]" }] }] } };
    return { result: { data: [{ items: [{ type: "agentMessage", clientId: "id", text: "[ccim-delivery:id]" },
      { type: "userMessage", clientId: null, content: [{ text: "[ccim-delivery:id]" }] }] }] } };
  }) });
  assert.equal(value, "uncertain"); assert.ok(!methods.includes("thread/queue/add"));
});
test("reconciliation uses at most 60 recent turns and reports incomplete evidence", async () => {
  let history = 0; const events = [];
  const value = await submit({ threadId: "t", deliveryId: "id", reconcileOnly: true, onEvent: e => events.push(e), rpcFactory: () => rpc(async (method, params) => {
    if (method === "thread/queue/list") return { result: { data: [] } };
    assert.equal(method, "thread/turns/list"); assert.equal(params.limit, 20); assert.equal(params.sortDirection, "desc");
    history++; return { result: { data: [], nextCursor: String(history) } };
  }) });
  assert.equal(value, "uncertain"); assert.equal(history, 3); assert.deepEqual(events, ["history_page_limit"]);
});
test("oversized RPC response has an explicit reason and cannot authorize resubmission", async () => {
  const events = [];
  const value = await submit({ threadId: "t", deliveryId: "id", reconcileOnly: true, onEvent: e => events.push(e),
    rpcFactory: () => rpc(async () => { throw Object.assign(new Error("private raw response"), { code: "rpc_response_too_large" }); }) });
  assert.equal(value, "uncertain"); assert.deepEqual(events, ["rpc_response_too_large"]);
});
