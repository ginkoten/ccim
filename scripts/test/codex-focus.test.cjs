"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawn } = require("node:child_process");
const { createServer } = require("node:http");
const { processIdentity } = require("../../plugin/lib/codex-ownership.cjs");
for (const reliable of [false, true]) test(`focus Stop preserves ${reliable ? "journal boundary" : "legacy behavior"}`, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccim-focus-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url); res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url.endsWith("who") ? { members: [{ handle: "test", focus: true }] } :
      req.url.includes("inbox") ? { messages: [{ id: 1, from: "peer", text: "fixture", ts: 1 }] } : { ok: true }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  fs.mkdirSync(path.join(dir, "sessions"));
  fs.writeFileSync(path.join(dir, "sessions/test.json"), JSON.stringify({ channel: "fixture", handle: "test", host: "codex",
    relay: `http://127.0.0.1:${server.address().port}`, token: "fixture", listenerPid: process.pid, listenerIdentity: processIdentity(process.pid) }));
  const binary = path.join(dir, "fake-queue");
  fs.writeFileSync(binary, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(path.join(dir, "queued"))},'fixture');`, { mode: 0o700 });
  const child = spawn(process.execPath, [path.resolve(__dirname, "../../plugin/bin/ccim"), "hook", "stop"], {
    env: { ...process.env, CCIM_HOME: dir, CCIM_SESSION: "test", CCIM_CODEX: binary, CCIM_RELIABLE_CODEX: reliable ? "1" : "0" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify({ session_id: "test" }));
  let stderr = ""; child.stderr.on("data", chunk => { stderr += chunk; });
  const code = await new Promise(resolve => child.on("exit", resolve));
  assert.equal(code, 0);
  assert.equal(fs.existsSync(path.join(dir, "queued")), !reliable);
  assert.equal(requests.some(url => url.includes("inbox")), !reliable);
  assert.equal(requests.some(url => url.endsWith("ack")), !reliable);
  if (reliable) assert.match(stderr, /reliable_focus_flush_unsupported/);
});
