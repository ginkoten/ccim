"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const runtimePath = path.resolve(__dirname, "../../plugin/lib/codex-reliability.cjs");
const { acquire, eventLogger, createDelivery, connection } = require(runtimePath);
const { submit } = require("../../plugin/lib/codex-queue.cjs");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ccim-reliable-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sessionFile = path.join(directory, "session.json");
  fs.writeFileSync(sessionFile, "{}", { mode: 0o600 });
  return { directory, sessionFile };
}
function deliveryFixture(t, results, ackStatuses = [200]) {
  const { directory } = fixture(t);
  const calls = [], acks = [];
  const options = { directory, sessionId: "test-session", s: { channel: "test-channel" },
    env: {}, log: () => {}, format: () => "private-test-body",
    api: async (_s, _method, _op, body) => { acks.push(body.ids); return { status: ackStatuses.shift() ?? 200 }; },
    queue: async args => { calls.push(args); return results.shift() ?? "accepted"; },
  };
  return { options, calls, acks, deliver: createDelivery(options), message: { id: 7, text: "private-test-body" } };
}

test("definite pre-submit failure retries without losing listener work", async t => {
  const f = deliveryFixture(t, ["not_sent", "accepted"]);
  assert.equal(await f.deliver(f.message), "not_sent");
  assert.equal(f.acks.length, 0);
  assert.equal(await f.deliver(f.message), "acked");
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].reconcileOnly, false);
  assert.equal(f.calls[0].deliveryId, f.calls[1].deliveryId);
});
test("uncertain submission is reconciliation-only across process restart", async t => {
  const f = deliveryFixture(t, ["uncertain", "uncertain", "accepted"]);
  assert.equal(await f.deliver(f.message), "uncertain");
  const resumed = createDelivery(f.options);
  assert.equal(await resumed(f.message), "uncertain");
  assert.equal(f.acks.length, 0);
  assert.equal(await resumed(f.message), "acked");
  assert.ok(f.calls.slice(1).every(call => call.reconcileOnly));
});
test("accepted submission survives ACK failure without a second queue operation", async t => {
  const f = deliveryFixture(t, ["accepted"], [503, 200]);
  assert.equal(await f.deliver(f.message), "accepted");
  assert.equal(await createDelivery(f.options)(f.message), "acked");
  assert.equal(f.calls.length, 1);
  assert.equal(f.acks.length, 2);
  assert.equal(await f.deliver({ ...f.message, id: 8 }), "acked");
});
test("duplicate relay delivery after successful ACK never enqueues twice", async t => {
  const f = deliveryFixture(t, ["accepted"]);
  await f.deliver(f.message);
  await f.deliver(f.message);
  assert.equal(f.calls.length, 1);
  assert.equal(f.acks.length, 1);
  const state = fs.readFileSync(path.join(f.options.directory, "delivery.json"), "utf8");
  assert.ok(!state.includes("private-test-body"));
});
test("crash during queue call leaves an uncertain write-ahead record", async t => {
  const f = deliveryFixture(t, []);
  f.options.queue = async () => { throw new Error("simulated crash"); };
  await assert.rejects(createDelivery(f.options)(f.message));
  f.options.queue = async args => { assert.equal(args.reconcileOnly, true); return "uncertain"; };
  assert.equal(await createDelivery(f.options)(f.message), "uncertain");
});

function rpcFixture(mode) {
  const calls = [];
  return { calls, rpc: {
    async initialize() { if (mode === "unavailable") throw new Error("missing binary"); },
    async call(method) {
      calls.push(method);
      if (method === "thread/queue/list") return { result: { data: mode === "queued" ? [{ clientUserMessageId: "id" }] : [] } };
      if (method === "thread/read") return { result: { thread: { turns: [{ items: [{ text: mode === "delivered" ? "marker" : "other" }] }] } } };
      if (method === "thread/queue/add") {
        if (mode === "timeout") throw new Error("timeout");
        return { result: { queuedSubmission: { clientUserMessageId: "id" } } };
      }
    }, close() {},
  } };
}
for (const mode of ["queued", "delivered", "normal", "timeout", "unavailable"]) {
  test(`official queue transport classifies ${mode} without blind resubmit`, async () => {
    const f = rpcFixture(mode);
    const actual = await submit({ threadId: "thread", deliveryId: "id", marker: "marker", text: "body", rpcFactory: () => f.rpc });
    assert.equal(actual, mode === "timeout" ? "uncertain" : mode === "unavailable" ? "not_sent" : "accepted");
    assert.equal(f.calls.filter(x => x === "thread/queue/add").length, ["normal", "timeout"].includes(mode) ? 1 : 0);
  });
}
test("missing queue/history evidence cannot authorize retry after uncertainty", async () => {
  const f = rpcFixture("normal");
  assert.equal(await submit({ threadId: "thread", deliveryId: "id", marker: "marker", text: "body", reconcileOnly: true, rpcFactory: () => f.rpc }), "uncertain");
  assert.ok(!f.calls.includes("thread/queue/add"));
});

test("session aliases share one atomic owner and release permits the next generation", t => {
  const f = fixture(t), alias = path.join(f.directory, "alias.json");
  fs.symlinkSync(f.sessionFile, alias);
  const first = acquire(f.sessionFile);
  assert.equal(acquire(alias), null);
  first.release();
  const next = acquire(alias); assert.ok(next); next.release();
});
test("four concurrent OS processes elect exactly one listener owner", async t => {
  const f = fixture(t), childFile = path.join(f.directory, "contender.cjs");
  fs.writeFileSync(childFile, `const {acquire}=require(${JSON.stringify(runtimePath)}); let owner; process.on('message', m=>{if(m==='start'){owner=acquire(process.argv[2]);process.send({won:!!owner});}else{if(owner)owner.release();process.exit(0);}});process.send('ready');`);
  const children = Array.from({ length: 4 }, () => fork(childFile, [f.sessionFile], { stdio: ["ignore", "ignore", "ignore", "ipc"] }));
  t.after(() => children.forEach(c => c.kill()));
  await Promise.all(children.map(c => once(c, "message")));
  const outcomes = children.map(c => once(c, "message"));
  children.forEach(c => c.send("start"));
  assert.equal((await Promise.all(outcomes)).filter(([m]) => m.won).length, 1);
  const exits = children.map(c => once(c, "exit"));
  children.forEach(c => c.send("release")); await Promise.all(exits);
});
test("logs are private, bounded and exclude bodies, tokens, environment and raw stderr", t => {
  const { directory } = fixture(t);
  const log = eventLogger(directory, { pid: 1, runId: "run" }, "session");
  log("delivery", { reason: "uncertain", text: "sensitive-message", token: "sensitive-token", stderr: "sensitive-stderr", env: { SECRET: "sensitive-env" } });
  const file = path.join(directory, "events.jsonl");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(!fs.readFileSync(file, "utf8").includes("sensitive"));
  fs.appendFileSync(file, "x".repeat(1024 * 1024)); log("exited", { reason: "SIGTERM" });
  assert.ok(fs.existsSync(file + ".previous"));
  assert.ok(fs.statSync(file).size < 1024);
});

test("malformed frames and connect errors have bounded recovery", async () => {
  const events = [], messages = [];
  class Socket {
    constructor() { setImmediate(() => { this.onmessage({ data: "not-json" }); this.onerror(); }); }
    close() {}
  }
  const outcome = await connection({ s: { relay: "https://test.invalid", token: "test-only" }, log: e => events.push(e), onMessage: m => messages.push(m), sockets: new Set(), WebSocketImpl: Socket });
  assert.equal(outcome.reason, "socket_error"); assert.deepEqual(events, ["invalid_frame"]); assert.equal(messages.length, 0);
});
test("a socket that never opens or closes times out", async () => {
  class Socket { close() {} }
  const outcome = await connection({ s: { relay: "https://test.invalid", token: "test-only" }, log() {}, onMessage() {}, sockets: new Set(), WebSocketImpl: Socket, connectTimeout: 5 });
  assert.equal(outcome.reason, "connect_timeout");
});

test("running listener survives temporary queue failure, retries and ACKs exactly once", async t => {
  const f = fixture(t), childFile = path.join(f.directory, "recovery.cjs");
  const queuePath = path.resolve(__dirname, "../../plugin/lib/codex-queue.cjs");
  fs.writeFileSync(childFile, `let submissions=0,acks=0,sockets=0;require(${JSON.stringify(queuePath)}).submit=async()=>++submissions===1?'not_sent':'accepted';const {listen}=require(${JSON.stringify(runtimePath)});
global.WebSocket=class {constructor(){sockets++;setImmediate(()=>{this.onopen();this.onmessage({data:JSON.stringify({type:'msg',id:1,text:'fixture-body'})});setTimeout(()=>this.onmessage({data:JSON.stringify({type:'msg',id:1,text:'fixture-body'})}),50);});}send(){}close(){if(this.onclose)this.onclose({code:1000});}};
listen({s:{host:'codex',channel:'test',relay:'https://test.invalid',token:'fixture-token'},sessionId:'fixture',sessionFile:process.argv[2],writeSession(){},api:async(_s,_m,op)=>{if(op==='ack'){acks++;setImmediate(()=>process.kill(process.pid,'SIGTERM'));}return {status:200};},format:()=> 'fixture-body',env:{}}).then(()=>{process.send({submissions,acks,sockets});process.disconnect();});`);
  const child = fork(childFile, [f.sessionFile], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  t.after(() => child.kill());
  const exited = once(child, "exit");
  const [result] = await once(child, "message"); await exited;
  assert.deepEqual(result, { submissions: 2, acks: 1, sockets: 1 });
});

for (const terminal of [401, 4001, 4002, 4003, "SIGTERM"]) {
  test(`terminal ${terminal} records exit and never auto-restarts`, async t => {
    const f = fixture(t), childFile = path.join(f.directory, "listener.cjs");
    fs.writeFileSync(childFile, `const {listen}=require(${JSON.stringify(runtimePath)});const terminal=${JSON.stringify(terminal)};let probes=0,sockets=0;
global.WebSocket=class {constructor(){sockets++;setImmediate(()=>{this.onopen();if(typeof terminal==='number'&&terminal>4000)this.onclose({code:terminal});});}send(){}close(){if(this.onclose)this.onclose({code:1000});}};
listen({s:{host:'codex',channel:'test',relay:'https://test.invalid',token:'test-only'},sessionId:'fixture',sessionFile:process.argv[2],writeSession(){if(terminal==='SIGTERM')process.send('ready');},api:async()=>{probes++;return {status:terminal===401?401:200};},format:()=>'',env:{}}).then(()=>{process.send({probes,sockets});process.disconnect();});`);
    const child = fork(childFile, [f.sessionFile], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    t.after(() => child.kill());
    const exited = once(child, "exit");
    if (terminal === "SIGTERM") { await once(child, "message"); child.kill("SIGTERM"); }
    await exited;
    const stateDir = path.join(f.directory, ".receiver-runtime", "session");
    const records = fs.readFileSync(path.join(stateDir, "events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(records.filter(x => x.event === "started").length, 1);
    assert.equal(records.at(-1).event, "exited");
    assert.equal(records.at(-1).reason, terminal === 401 ? "unauthorized" : terminal === "SIGTERM" ? "SIGTERM" : `close_${terminal}`);
    const next = acquire(f.sessionFile); assert.ok(next); next.release();
  });
}
