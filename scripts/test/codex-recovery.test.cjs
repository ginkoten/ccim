"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createDelivery, listen } = require("../../plugin/lib/codex-reliability.cjs");
const { generation, journalPath, deliveryStatus } = require("../../plugin/lib/codex-journal.cjs");
const { acquire, runtimeDirectory, processIdentity } = require("../../plugin/lib/codex-ownership.cjs");
const { parseResolution, resolveDelivery } = require("../../plugin/lib/codex-resolve.cjs");
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ccim-recovery-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const sessionFile = path.join(home, "test.json"); fs.writeFileSync(sessionFile, "{}");
  const directory = runtimeDirectory(sessionFile); fs.mkdirSync(directory, { recursive: true });
  const s = { host: "codex", channel: "fixture", relay: "http://fixture.invalid", token: "fixture-only" };
  const calls = [], requests = []; let pending = [{ id: 1 }], clock = 1000000;
  const options = { directory, s, sessionId: "fixture", sessionFile, env: {}, log() {}, format: () => "fixture",
    now: () => clock, queue: async args => { calls.push(args); return args.reconcileOnly ? "uncertain" : "accepted"; },
    api: async (_, method, op, body) => { requests.push({ method, op, body }); return { status: 200, messages: pending }; } };
  const file = journalPath(directory, s);
  const legacy = () => fs.writeFileSync(path.join(directory, "delivery.json"), '{"fixture:1":{"state":"acked"}}');
  const resolution = (id, mode) => parseResolution(["resolve", String(id), "--" + mode,
    mode === "resend" ? "--confirm-duplicate-risk" : "--confirm-delivered", "--generation", generation(s)]);
  return { options, s, directory, sessionFile, file, calls, requests, legacy, resolution,
    advance: () => { clock += 1000000; }, pending: value => { pending = value; } };
}
test("legacy fully ACKed journal does not prevent new messages from being delivered", async t => {
  const f = fixture(t); f.legacy(); f.pending([]);
  const deliver = createDelivery(f.options); await deliver.prepare();
  assert.equal(await deliver({ id: 999 }), "acked");
  assert.equal(f.calls[0].reconcileOnly, false);
  assert.deepEqual(f.requests.map(r => r.op), ["inbox?all=1", "ack"]);
});
test("corrupt recovery snapshots only current pending IDs, persists boundary, and delivers later arrivals", async t => {
  const f = fixture(t); fs.writeFileSync(f.file, "broken");
  const deliver = createDelivery(f.options); await deliver.prepare();
  assert.equal(await deliver({ id: 1 }), "uncertain");
  f.pending([{ id: 1 }, { id: 2 }]);
  assert.equal(await deliver({ id: 2 }), "acked");
  f.advance(); const resumed = createDelivery(f.options);
  assert.equal(await resumed({ id: 1 }), "uncertain");
  assert.equal(await resumed({ id: 3 }), "acked");
  assert.equal(f.requests.filter(r => r.method === "GET").length, 1);
  assert.deepEqual(f.calls.map(c => c.reconcileOnly), [true, false, true, false]);
  assert.deepEqual(deliveryStatus(f.directory, f.s).recoveryIds, [1]);
  assert.ok(!fs.readFileSync(f.file, "utf8").includes(f.s.token));
});
test("existing globally quarantined v2 ledger gains one boundary without clearing unresolved entries", async t => {
  const f = fixture(t); const ledger = { version: 2, quarantined: true, entries: {
    7: { state: "stuck", deliveryId: "old", attempts: 8, nextAttemptAt: 0, updatedAt: 1 } } };
  fs.writeFileSync(f.file, JSON.stringify(ledger)); f.pending([{ id: 7 }]);
  const deliver = createDelivery(f.options); await deliver.prepare();
  assert.equal(await deliver({ id: 7 }), "stuck"); assert.equal(await deliver({ id: 8 }), "acked");
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].reconcileOnly, false);
});
test("failed recovery snapshot neither queues nor ACKs and releases listener ownership", async t => {
  const f = fixture(t); f.legacy();
  f.options.api = async () => ({ status: 503 });
  await assert.rejects(listen({ ...f.options, writeSession() { assert.fail(); } }), /reliable_receiver_failed/);
  assert.equal(f.calls.length, 0);
  const next = acquire(f.sessionFile); assert.ok(next); next.release();
  assert.equal(deliveryStatus(f.directory, f.s).state, "recovery_snapshot_required");
});
test("resolution requires one positive ID, explicit mode, risk confirmation and exact generation", () => {
  const epoch = "a".repeat(64);
  for (const args of [[], ["resolve", "*", "--resend", "--confirm-duplicate-risk", "--generation", epoch],
    ["resolve", "1", "--resend", "--confirm-delivered", "--generation", epoch],
    ["resolve", "1", "--delivered", "--confirm-delivered", "--generation", epoch, "--resend"]])
    assert.throws(() => parseResolution(args), /invalid_resolution_arguments|resolution_confirmation_required/);
});
test("manual resend stages exactly one boundary item without network and then uses normal journal delivery", async t => {
  const f = fixture(t); f.legacy(); await createDelivery(f.options).prepare();
  const before = f.requests.length;
  const result = resolveDelivery({ ...f.options, resolution: f.resolution(1, "resend") });
  assert.deepEqual(result, { messageId: 1, decision: "resend", staged: true, networkActions: 0 });
  assert.equal(f.requests.length, before);
  assert.equal(await createDelivery(f.options)({ id: 1 }), "acked");
  assert.equal(f.calls[0].reconcileOnly, false);
  assert.deepEqual(f.requests.filter(r => r.op === "ack").map(r => r.body.ids), [[1]]);
});
test("manual delivered decision ACKs only the selected item on next normal delivery, never queue/add", async t => {
  const f = fixture(t); f.legacy(); f.pending([{ id: 1 }, { id: 2 }]);
  const deliver = createDelivery(f.options); await deliver({ id: 1 }); await deliver({ id: 2 });
  const before = JSON.parse(fs.readFileSync(f.file, "utf8")).entries[2];
  resolveDelivery({ ...f.options, resolution: f.resolution(1, "delivered") });
  assert.deepEqual(JSON.parse(fs.readFileSync(f.file, "utf8")).entries[2], before);
  const queueCount = f.calls.length;
  assert.equal(await createDelivery(f.options)({ id: 1 }), "acked");
  assert.equal(f.calls.length, queueCount);
  assert.deepEqual(f.requests.filter(r => r.op === "ack").map(r => r.body.ids), [[1]]);
});
test("stuck has a selected-item exit; unknown, ACKed, accepted resend and wrong generation are refused", async t => {
  const f = fixture(t); f.legacy(); const deliver = createDelivery(f.options);
  for (let n = 0; n < 8; n++) { await deliver({ id: 1 }); f.advance(); }
  assert.equal(deliveryStatus(f.directory, f.s).pending[0].state, "stuck");
  for (const resolution of [f.resolution(20, "resend"), { ...f.resolution(1, "resend"), epoch: "a".repeat(64) }]) {
    const before = fs.readFileSync(f.file, "utf8");
    assert.throws(() => resolveDelivery({ ...f.options, resolution }), /resolution_entry_unknown|resolution_generation_mismatch/);
    assert.equal(fs.readFileSync(f.file, "utf8"), before);
  }
  resolveDelivery({ ...f.options, resolution: f.resolution(1, "delivered") });
  assert.throws(() => resolveDelivery({ ...f.options, resolution: f.resolution(1, "resend") }), /already_accepted/);
  await createDelivery(f.options)({ id: 1 });
  assert.throws(() => resolveDelivery({ ...f.options, resolution: f.resolution(1, "delivered") }), /already_acked/);
});
test("live owner or live legacy listener prevents manual journal mutation", async t => {
  const f = fixture(t); f.legacy(); await createDelivery(f.options).prepare();
  const before = fs.readFileSync(f.file, "utf8"), owner = acquire(f.sessionFile);
  assert.throws(() => resolveDelivery({ ...f.options, resolution: f.resolution(1, "resend") }), /lock_busy/);
  owner.release();
  assert.throws(() => resolveDelivery({ ...f.options, s: { ...f.s, listenerPid: process.pid,
    listenerIdentity: processIdentity(process.pid) }, resolution: f.resolution(1, "resend") }), /listener_active_or_unknown/);
  assert.equal(fs.readFileSync(f.file, "utf8"), before);
});

function cliFixture(f, args, input) {
  const { spawnSync } = require("node:child_process");
  const home = path.dirname(f.sessionFile);
  fs.mkdirSync(path.join(home, "sessions"), { recursive: true });
  const alias = path.join(home, "sessions", "test.json");
  if (!fs.existsSync(alias)) fs.symlinkSync(f.sessionFile, alias);
  fs.writeFileSync(f.sessionFile, JSON.stringify(f.s));
  return spawnSync(process.execPath, [path.resolve(__dirname, "../../plugin/bin/ccim"), ...args], {
    input, encoding: "utf8", env: { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: home,
      CCIM_HOME: home, CCIM_SESSION: "test", CCIM_RELIABLE_CODEX: "1" },
  });
}
test("official CLI stages one confirmed decision and status stays read-only", async t => {
  const f = fixture(t); f.legacy(); await createDelivery(f.options).prepare();
  const args = ["reliable", "resolve", "1", "--resend", "--confirm-duplicate-risk", "--generation", generation(f.s)];
  const result = cliFixture(f, args); assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).staged, true);
  assert.ok(!result.stdout.includes(f.s.token));
  const before = fs.readFileSync(f.file, "utf8"), timestamp = fs.statSync(f.file).mtimeMs;
  const status = cliFixture(f, ["status", "--reliable"]);
  assert.equal(status.status, 0); assert.equal(JSON.parse(status.stdout).generation, generation(f.s));
  assert.equal(fs.readFileSync(f.file, "utf8"), before); assert.equal(fs.statSync(f.file).mtimeMs, timestamp);
});
test("SessionEnd with no listener exits quietly without misleading identity warning", t => {
  const f = fixture(t);
  const result = cliFixture(f, ["hook", "end"], JSON.stringify({ session_id: "test" }));
  assert.equal(result.status, 0); assert.equal(result.stderr, "");
});

test("malformed snapshot cannot silently authorize new delivery", async t => {
  const f = fixture(t); f.legacy(); f.pending([{ id: "1" }]);
  const deliver = createDelivery(f.options);
  await assert.rejects(deliver({ id: 2 }), /recovery_snapshot_failed/);
  assert.equal(f.calls.length, 0); assert.equal(f.requests.some(r => r.op === "ack"), false);
  assert.equal(JSON.parse(fs.readFileSync(f.file, "utf8")).recoveryIds, undefined);
});
test("manual resolution refuses corrupt ledgers without replacing them and releases its lock", async t => {
  const f = fixture(t); fs.writeFileSync(f.file, "corrupt");
  assert.throws(() => resolveDelivery({ ...f.options, resolution: f.resolution(1, "resend") }), /resolution_journal_unavailable/);
  assert.equal(fs.readFileSync(f.file, "utf8"), "corrupt");
  const owner = acquire(f.sessionFile); assert.ok(owner); owner.release();
});
