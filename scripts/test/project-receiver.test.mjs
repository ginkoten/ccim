import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { receiverPlan, runReceiver } from "../legacy/project-receiver.cjs";
import { macosProxyEnv } from "../macos-proxy.cjs";

function fixture(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccim-launch-test-"));
  try {
    const project = path.join(dir, "project"), home = path.join(dir, "private-home");
    fs.mkdirSync(project); fs.mkdirSync(home);
    return fn({ CCIM_PROJECT_DIR: project, CCIM_PROJECT_HOME: home });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const proxyEnv = (env) => macosProxyEnv(env, { nodeVersion: "24.16.0", readProxy: () => "HTTPEnable : 1\nHTTPProxy : 127.0.0.1\nHTTPPort : 12345" });
const help = "--cd --sandbox --ask-for-approval --permission-mode --resume";

test("receiver preflight defaults to no start and emits only known diagnostics", () => fixture((env) => {
  for (const client of ["codex", "claude"]) {
    const calls = [], output = [];
    const result = runReceiver(client, [], { env, proxyEnv, spawn: (...args) => { calls.push(args); return { status: 0, stdout: help }; }, log: (line) => output.push(line) });
    assert.equal(result, 0); assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][1], ["--help"]);
    assert.equal(JSON.parse(output[0]).started, false);
    assert.ok(!output[0].includes(env.CCIM_PROJECT_HOME));
    assert.ok(!output[0].includes("12345"));
  }
}));

test("explicit start fixes cwd, clears inherited identities and keeps Claude Node proxy hook-only", () => fixture((base) => {
  for (const client of ["codex", "claude"]) {
    const calls = [];
    const env = { ...base, CCIM_SESSION: "old", CODEX_THREAD_ID: "old", CLAUDE_CODE_SESSION_ID: "old", CLAUDE_CODE_MESSAGING_TOKEN: "fixture-token", CCIM_RECEIVER_SESSION_ID: "old", CCIM_RELAY: "fixture-relay", CCIM_TOKEN: "fixture-token", CCIM_SECRET: "fixture-secret", CCIM_CODEX: "old-runtime", NODE_USE_ENV_PROXY: "1" };
    runReceiver(client, ["--start"], { env, proxyEnv, spawn: (...args) => { calls.push(args); return { status: 0, stdout: help }; } });
    assert.equal(calls.length, 2);
    const options = calls[1][2];
    assert.equal(options.cwd, fs.realpathSync(base.CCIM_PROJECT_DIR));
    assert.equal(options.env.CCIM_HOME, fs.realpathSync(base.CCIM_PROJECT_HOME));
    for (const key of ["CCIM_SESSION", "CODEX_THREAD_ID", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_TOKEN", "CCIM_RECEIVER_SESSION_ID", "CCIM_RELAY", "CCIM_TOKEN", "CCIM_SECRET", "CCIM_CODEX"]) assert.equal(options.env[key], undefined);
    assert.equal(options.env.NODE_USE_ENV_PROXY, client === "codex" ? "1" : undefined);
    assert.equal(options.env.HTTPS_PROXY, "http://127.0.0.1:12345");
    assert.equal(options.env.CCIM_HOST, client);
    assert.ok(calls[1][1].includes(client === "codex" ? "read-only" : "default"));
    assert.equal(env.CCIM_SESSION, "old");
  }
}));

test("resume uses only explicit UUID with verified client syntax", () => fixture((base) => {
  const id = "11111111-1111-1111-1111-111111111111";
  const env = { ...base, CCIM_RECEIVER_RESUME_ID: id };
  const codex = receiverPlan("codex", env), claude = receiverPlan("claude", env);
  assert.equal(codex.args[0], "resume"); assert.ok(codex.args.includes(id));
  assert.equal(claude.args[claude.args.indexOf("--resume") + 1], id);
  const calls = [];
  runReceiver("codex", ["--check"], { env, proxyEnv, spawn: (...args) => { calls.push(args); return { status: 0, stdout: help }; }, log: () => {} });
  assert.deepEqual(calls[0][1], ["resume", "--help"]);
  assert.throws(() => receiverPlan("codex", { ...base, CCIM_RECEIVER_RESUME_ID: "--last" }), /Invalid/);
}));

test("receiver refuses missing or shared homes and unsupported options without creating files", () => fixture((env) => {
  assert.throws(() => receiverPlan("codex", {}), /Explicit/);
  assert.throws(() => receiverPlan("codex", { ...env, CCIM_PROJECT_HOME: env.CCIM_PROJECT_DIR }), /separate/);
  assert.throws(() => receiverPlan("codex", { ...env, CCIM_PROJECT_HOME: path.join(env.CCIM_PROJECT_HOME, "absent") }), /unavailable/);
  assert.throws(() => receiverPlan("codex", { ...env, CCIM_CODEX_BIN: "relative/bin" }), /absolute/);
  assert.throws(() => runReceiver("codex", ["--dangerously-bypass-hook-trust"], { env }), /no CLI passthrough/);
  assert.deepEqual(fs.readdirSync(env.CCIM_PROJECT_HOME), []);
}));

test("failed CLI preflight hides raw output and prevents startup", () => fixture((env) => {
  let calls = 0;
  assert.throws(() => runReceiver("claude", ["--start"], { env, proxyEnv, spawn: () => { calls++; return { status: 1, stdout: "fixture-private", stderr: "fixture-private" }; } }), /^Error: CLI preflight failed;/);
  assert.equal(calls, 1);
}));
