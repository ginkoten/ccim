"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { runHook } = require("../codex-app-hook.cjs");

const spec = { session: "11111111-1111-4111-8111-111111111111", project: "/project",
  home: "/private/receiver", node: "/runtime/node", cli: "/runtime/ccim", codex: "/runtime/codex" };
const input = { session_id: spec.session, cwd: spec.project, prompt: "fixture" };

test("another thread cannot start or stop this receiver", () => {
  for (const event of ["start", "prompt", "stop", "end"]) {
    const noCall = () => assert.fail("must not consult proxy or spawn for another thread");
    assert.deepEqual(runHook(event, { ...input, session_id: "other" }, spec,
      { proxyEnv: noCall, spawn: noCall }), { skipped: true });
  }
});

test("same session in another project is rejected without process activity", () => {
  assert.deepEqual(runHook("start", { ...input, cwd: "/other" }, spec,
    { proxyEnv: () => assert.fail("must not prepare an environment") }), { skipped: true });
});

test("only known events and explicit absolute paths are accepted", () => {
  assert.throws(() => runHook("join", input, spec), /invalid_hook_event/);
  assert.throws(() => runHook("start", input, { ...spec, session: "invented" }), /invalid_receiver_session/);
  assert.throws(() => runHook("start", input, { ...spec, session: "-".repeat(36) }), /invalid_receiver_session/);
  for (const key of ["project", "home", "node", "cli", "codex"]) {
    assert.throws(() => runHook("start", input, { ...spec, [key]: "relative" }), /invalid_receiver_path/);
  }
});

test("all four events preserve the real session and select the isolated runtime", () => {
  for (const event of ["start", "prompt", "stop", "end"]) {
    let calls = 0;
    const result = runHook(event, input, spec, { env: {}, proxyEnv: env => env,
      spawn: (binary, args, options) => {
        calls++;
        assert.equal(binary, spec.node);
        assert.deepEqual(args, [spec.cli, "hook", event]);
        assert.deepEqual(JSON.parse(options.input), input);
        assert.equal(options.env.CCIM_SESSION, spec.session);
        assert.equal(options.env.CCIM_HOME, spec.home);
        assert.equal(options.env.CCIM_HOST, "codex");
        assert.equal(options.env.CCIM_RELIABLE_CODEX, "1");
        assert.equal(options.env.CCIM_CODEX, spec.codex);
        assert.equal(options.timeout, event === "stop" ? 9000 : event === "end" ? 2500 : 4500);
        return { status: 0, stdout: "" };
      } });
    assert.equal(calls, 1);
    assert.equal(result.status, 0);
  }
});

test("clears inherited member and Claude socket material only in the child environment", () => {
  const inherited = { CCIM_TOKEN: "fixture-token", CCIM_SECRET: "fixture-secret", CCIM_RELAY: "fixture-relay",
    CLAUDE_CODE_SESSION_ID: "other", CLAUDE_CODE_MESSAGING_TOKEN: "fixture", CLAUDE_CODE_MESSAGING_SOCKET: "fixture",
    CCIM_WAKE_SOCKET: "fixture", CCIM_WAKE_TOKEN: "fixture", CCIM_SESSION: "other",
    CODEX_THREAD_ID: "other", CCIM_RECEIVER_SESSION_ID: "other", KEEP: "preserved" };
  const before = { ...inherited };
  runHook("start", input, spec, { env: inherited, proxyEnv: env => ({ ...env, NODE_USE_ENV_PROXY: "1" }),
    spawn: (_, __, options) => {
      for (const key of Object.keys(inherited).filter(k => !["CCIM_SESSION", "KEEP"].includes(k))) assert.equal(options.env[key], undefined);
      assert.equal(options.env.KEEP, "preserved");
      assert.equal(options.env.NODE_USE_ENV_PROXY, "1");
      return { status: 0, stdout: "" };
    } });
  assert.deepEqual(inherited, before);
});

test("failure suppresses raw child stdout and stderr", () => {
  const result = runHook("start", input, spec, { env: {}, proxyEnv: env => env,
    spawn: () => ({ status: null, stdout: "private fixture", stderr: "private error fixture" }) });
  assert.deepEqual(result, { skipped: false, status: 1, stdout: "" });
});
