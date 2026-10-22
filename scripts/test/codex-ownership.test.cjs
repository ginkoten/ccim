"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const modulePath = path.resolve(__dirname, "../../plugin/lib/codex-ownership.cjs");
const { acquire, runtimeDirectory, listenerAlive } = require(modulePath);
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccim-ownership-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "session.json"); fs.writeFileSync(file, "{}");
  return { dir, file };
}
test("SIGKILL of a fixture owner permits atomic recovery by one of four contenders", async t => {
  const { dir, file } = fixture(t), script = path.join(dir, "owner.cjs");
  fs.writeFileSync(script, `const {acquire}=require(${JSON.stringify(modulePath)});const owner=acquire(process.argv[2]);process.send({won:!!owner});process.on('message',()=>{if(owner)owner.release();process.exit(0)});`);
  const spawn = () => fork(script, [file], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const first = spawn(); const [ready] = await once(first, "message"); assert.equal(ready.won, true);
  const killed = once(first, "exit"); first.kill("SIGKILL"); await killed;
  const children = Array.from({ length: 4 }, spawn);
  t.after(() => children.forEach(c => c.kill()));
  const outcomes = await Promise.all(children.map(c => once(c, "message")));
  assert.equal(outcomes.filter(([v]) => v.won).length, 1);
  const exits = children.map(c => once(c, "exit")); children.forEach(c => c.send("release")); await Promise.all(exits);
  const next = acquire(file); assert.ok(next); next.release();
});
test("simulated reboot or PID reuse changes owner fingerprint and reclaims without killing it", t => {
  const { file } = fixture(t); const first = acquire(file, { identify: () => "boot1:start1" });
  const events = []; const next = acquire(file, { identify: () => "boot2:start2", log: e => events.push(e) });
  assert.ok(next); assert.deepEqual(events, ["lock_reclaimed"]);
  first.release(); // A delayed old release cannot release the current generation.
  assert.equal(acquire(file, { identify: () => "boot2:start2" }), null); next.release();
});
test("unknown owner metadata fails closed, but dead legacy ownership can recover", t => {
  const { file } = fixture(t); const dir = runtimeDirectory(file); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "owner.lock"), JSON.stringify({ pid: 99999999, runId: "11111111-1111-4111-8111-111111111111" }));
  const identity = pid => pid === process.pid ? "self" : "unknown";
  assert.equal(acquire(file, { identify: identity }), null);
  const next = acquire(file, { identify: pid => pid === process.pid ? "self" : null }); assert.ok(next); next.release();
});
test("listener PID checks compare fingerprints and preserve legacy live PID safety", () => {
  assert.equal(listenerAlive({ listenerPid: 7, listenerIdentity: "old" }, () => "new"), false);
  assert.equal(listenerAlive({ listenerPid: 7, listenerIdentity: "same" }, () => "same"), true);
  assert.equal(listenerAlive({ listenerPid: 7 }, () => "unknown"), true);
  assert.equal(listenerAlive({ listenerPid: 7 }, () => null), false);
});
