"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { macosProxyEnv } = require("./macos-proxy.cjs");

const EVENTS = new Set(["start", "prompt", "stop", "end"]);

function runHook(event, input, spec, deps = {}) {
  if (!EVENTS.has(event)) throw new Error("invalid_hook_event");
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(spec.session || "")) throw new Error("invalid_receiver_session");
  for (const key of ["project", "home", "node", "cli", "codex"]) {
    if (typeof spec[key] !== "string" || !path.isAbsolute(spec[key])) throw new Error("invalid_receiver_path");
  }
  // The hook can be discovered from a wider config layer; only this exact app conversation may act.
  if (input.session_id !== spec.session || input.cwd !== spec.project) return { skipped: true };
  const base = { ...(deps.env || process.env) };
  for (const key of ["CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN",
    "CCIM_WAKE_SOCKET", "CCIM_WAKE_TOKEN", "CCIM_TOKEN", "CCIM_SECRET", "CCIM_RELAY",
    "CODEX_THREAD_ID", "CCIM_RECEIVER_SESSION_ID"]) delete base[key];
  const env = (deps.proxyEnv || macosProxyEnv)({ ...base, CCIM_HOME: spec.home, CCIM_SESSION: spec.session,
    CCIM_HOST: "codex", CCIM_CODEX: spec.codex, CCIM_RELIABLE_CODEX: "1" });
  const result = (deps.spawn || spawnSync)(spec.node, [spec.cli, "hook", event], {
    input: JSON.stringify(input), encoding: "utf8", timeout: event === "stop" ? 9000 : 4500,
    env, stdio: ["pipe", "pipe", "pipe"],
  });
  return { skipped: false, status: result.status ?? 1,
    stdout: result.status === 0 ? result.stdout || "" : "" };
}

function main() {
  const [event, specPath] = process.argv.slice(2);
  try {
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    const raw = fs.readFileSync(0, "utf8");
    if (raw.length > 1024 * 1024) throw new Error("hook_input_too_large");
    const result = runHook(event, JSON.parse(raw), spec);
    if (result.skipped) return;
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.status) console.error("[ccim] app hook failed; receiver state requires inspection");
    process.exitCode = result.status;
  } catch {
    console.error("[ccim] invalid app hook input or receiver specification");
    process.exitCode = 1;
  }
}

if (require.main === module) main();
module.exports = { runHook };
