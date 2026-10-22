"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { macosProxyEnv } = require("./macos-proxy.cjs");

const EVENTS = new Set(["start", "prompt", "stop", "end"]);

function runHook(event, input, spec, deps = {}) {
  const now = deps.now || (() => performance.now());
  const started = now();
  if (!EVENTS.has(event)) throw new Error("invalid_hook_event");
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(spec.session || "")) throw new Error("invalid_receiver_session");
  for (const key of ["project", "home", "node", "cli", "codex"]) {
    if (typeof spec[key] !== "string" || !path.isAbsolute(spec[key])) throw new Error("invalid_receiver_path");
  }
  // The hook can be discovered from a wider config layer; only this exact app conversation may act.
  if (input.session_id !== spec.session) return { skipped: true, reason: "session_mismatch" };
  const realpath = deps.realpath || fs.realpathSync;
  try {
    if (realpath(input.cwd) !== realpath(spec.project)) return { skipped: true, reason: "project_mismatch" };
  } catch { return { skipped: true, reason: "project_unavailable" }; }
  if (spec.legacyHandlersExcluded !== true) return { skipped: false, status: 1, stdout: "", reason: "legacy_handlers_not_excluded" };
  if (![undefined, "none", "system"].includes(spec.proxy)) throw new Error("invalid_proxy_mode");
  const budget = event === "stop" ? 9000 : event === "end" ? 2500 : 4500;
  const base = { ...(deps.env || process.env) };
  for (const key of ["CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN",
    "CCIM_WAKE_SOCKET", "CCIM_WAKE_TOKEN", "CCIM_TOKEN", "CCIM_SECRET", "CCIM_RELAY",
    "CODEX_THREAD_ID", "CCIM_RECEIVER_SESSION_ID"]) delete base[key];
  let env = { ...base, CCIM_HOME: spec.home, CCIM_SESSION: spec.session,
    CCIM_HOST: "codex", CCIM_CODEX: spec.codex, CCIM_RELIABLE_CODEX: "1" };
  if (spec.proxy === "system") {
    if ((deps.platform || process.platform) !== "darwin") throw new Error("system_proxy_unsupported");
    const remaining = Math.floor(budget - (now() - started));
    if (remaining <= 0) throw new Error("hook_deadline_exhausted");
    try { env = (deps.proxyEnv || macosProxyEnv)(env, { timeout: Math.min(3000, remaining) }); }
    catch { throw new Error("system_proxy_failed"); }
  }
  const remaining = Math.floor(budget - (now() - started));
  if (remaining <= 0) throw new Error("hook_deadline_exhausted");
  const result = (deps.spawn || spawnSync)(spec.node, [spec.cli, "hook", event], {
    input: JSON.stringify(input), encoding: "utf8", timeout: remaining,
    env, stdio: ["pipe", "pipe", "pipe"],
  });
  return { skipped: false, status: result.status ?? 1,
    stdout: result.status === 0 ? result.stdout || "" : "",
    reason: result.error?.code === "ETIMEDOUT" ? "hook_child_timeout" : result.status === 0 ? "hook_completed" : "hook_child_failed" };
}

function main() {
  const [event, specPath] = process.argv.slice(2);
  try {
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    const raw = fs.readFileSync(0, "utf8");
    if (raw.length > 1024 * 1024) throw new Error("hook_input_too_large");
    const result = runHook(event, JSON.parse(raw), spec);
    if (result.skipped) { console.error(`[ccim] ${result.reason}`); return; }
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.status) console.error(`[ccim] ${result.reason}`);
    process.exitCode = result.status;
  } catch (error) {
    const reasons = new Set(["invalid_hook_event", "invalid_receiver_session", "invalid_receiver_path", "invalid_proxy_mode",
      "system_proxy_unsupported", "system_proxy_failed", "hook_deadline_exhausted", "hook_input_too_large"]);
    console.error(`[ccim] ${reasons.has(error.message) ? error.message : "hook_input_or_spec_invalid"}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { runHook };
