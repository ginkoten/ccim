"use strict";
// Copy beside a reviewed local receiver wrapper; keep this helper path pointed at the checkout.
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { macosProxyEnv } = require("./macos-proxy.cjs");

const event = process.argv[2];
const input = fs.readFileSync(0, "utf8");
let payload;
try { payload = JSON.parse(input); } catch { process.exit(0); }
const thread = process.env.CCIM_RECEIVER_SESSION_ID;
if (!thread || payload.session_id !== thread) process.exit(0);
if (!["start", "prompt", "stop", "end"].includes(event)) process.exit(1);
const plugin = process.env.CCIM_PLUGIN_BIN;
const codex = process.env.CCIM_CODEX;
if (!plugin || !codex) { console.error("Receiver runtime paths are required"); process.exit(1); }
let env;
try { env = macosProxyEnv({ ...process.env, CCIM_CODEX: codex }); }
catch (error) { console.error(error.message); process.exit(1); }
const result = spawnSync(process.execPath, [plugin, "hook", event], {
  input, encoding: "utf8", timeout: event === "stop" ? 9000 : 4500, env,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
