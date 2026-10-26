import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { provision } from "../provision-grok.mjs";
import { adapterOptionsFromEnv } from "../check-adapter-mcp.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), "ccim-multi-test-"));

test("provision accepts explicit members and rejects invalid handles before creating files or joining", async () => {
  const dir = fixture();
  try {
    let calls = 0;
    for (const handle of ["grok", "codex", "a", "a".repeat(32), "a_b-c"]) {
      const opts = { relay: "https://relay.example.invalid", channel: "example", secret: "fixture-secret", handle, output: path.join(dir, handle),
        request: async (_url, init) => { calls++; assert.deepEqual(JSON.parse(init.body), { handle, ifAbsent: true, mustExist: true }); return Response.json({ token: "fixture-token" }); } };
      await provision(opts);
      assert.equal(fs.statSync(opts.output).mode & 0o777, 0o600);
      await assert.rejects(provision(opts), /EEXIST/);
      assert.equal(fs.readFileSync(opts.output, "utf8"), "fixture-token\n");
    }
    assert.equal(calls, 5);
    for (const handle of ["", "*", "Bad", "a/b", "a".repeat(33), null, 1]) {
      const output = path.join(dir, "invalid");
      await assert.rejects(provision({ relay: "https://relay.example.invalid", channel: "example", secret: "fixture-secret", output, handle,
        request: async () => { throw Error("must not request"); } }), /Invalid handle/);
      assert.equal(fs.existsSync(output), false);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("provision CLI honors isolated CCIM_HOME and optional HANDLE without printing values on success or failure", () => {
  const dir = fixture();
  try {
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ relay: "https://relay.example.invalid", channels: { example: { secret: "fixture-channel-secret" } } }));
    const mock = path.join(dir, "mock.mjs");
    fs.writeFileSync(mock, `globalThis.fetch = async (url, init) => {
      if (url !== "https://relay.example.invalid/c/example/join" || init.headers["x-ccim-secret"] !== "fixture-channel-secret") throw Error("fixture-secret");
      const body = JSON.parse(init.body);
      if (body.handle !== process.env.EXPECTED_HANDLE || !body.ifAbsent || !body.mustExist) throw Error("fixture-secret");
      return Response.json({ token: "fixture-member-token" });
    };`);
    for (const handle of [undefined, "grok", "codex", "INVALID"]) {
      const output = path.join(dir, `token-${handle}`);
      const args = ["--import", mock, path.join(root, "scripts/provision-grok.mjs"), "example", output, ...(handle === undefined ? [] : [handle])];
      const env = { PATH: process.env.PATH, CCIM_HOME: dir, EXPECTED_HANDLE: handle || "grok" };
      const result = spawnSync(process.execPath, args, { env, encoding: "utf8" });
      assert.equal(result.status, handle === "INVALID" ? 1 : 0);
      for (const value of ["fixture-channel-secret", "fixture-member-token", dir, "relay.example.invalid", "INVALID"]) assert.ok(!(result.stdout + result.stderr).includes(value));
      if (handle === "INVALID") { assert.equal(fs.existsSync(output), false); continue; }
      assert.equal(fs.readFileSync(output, "utf8"), "fixture-member-token\n");
      const repeated = spawnSync(process.execPath, args, { env, encoding: "utf8" });
      assert.equal(repeated.status, 1);
      assert.ok(!(repeated.stdout + repeated.stderr).includes("fixture-member-token"));
      assert.equal(fs.readFileSync(output, "utf8"), "fixture-member-token\n");
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("MCP environment option defaults and independent overrides select only variable names", () => {
  const env = { CCIM_ADAPTER_MCP_URL: "default-url", CCIM_ADAPTER_MCP_BEARER: "default-bearer", CCIM_GINKOAI_MCP_URL: "project-url", CCIM_GINKOAI_MCP_BEARER: "project-bearer" };
  assert.deepEqual(adapterOptionsFromEnv([], env), { url: "default-url", bearer: "default-bearer" });
  assert.deepEqual(adapterOptionsFromEnv(["--url-env", "CCIM_GINKOAI_MCP_URL"], env), { url: "project-url", bearer: "default-bearer" });
  assert.deepEqual(adapterOptionsFromEnv(["--bearer-env", "CCIM_GINKOAI_MCP_BEARER"], env), { url: "default-url", bearer: "project-bearer" });
  assert.deepEqual(adapterOptionsFromEnv(["--url-env", "CCIM_GINKOAI_MCP_URL", "--bearer-env", "CCIM_GINKOAI_MCP_BEARER"], env), { url: "project-url", bearer: "project-bearer" });
});

test("MCP environment options reject values, unknown, missing and duplicate flags", () => {
  for (const args of [["--url-env"], ["--url-env", "https://example.invalid/mcp"], ["--bearer-env", "Bearer fixture"], ["--url-env", "X=value"], ["--url-env", "1X"], ["--secret", "X"], ["--url-env", "X", "--url-env", "Y"]]) {
    assert.throws(() => adapterOptionsFromEnv(args, {}), /^Error: invalid_env_option$/);
  }
});

test("MCP CLI custom options interoperate using only read-only calls and never echo values", () => {
  const dir = fixture();
  try {
    const mock = path.join(dir, "mock.mjs");
    fs.writeFileSync(mock, `const expected = ["initialize", "notifications/initialized", "tools/list", "tools/call"];
      globalThis.fetch = async (url, init) => {
        if (url !== "https://adapter.example.invalid/mcp" || init.headers.authorization !== "Bearer fixture-bearer") throw Error("fixture-bearer");
        const body = JSON.parse(init.body);
        if (body.method !== expected.shift()) throw Error("unexpected call");
        if (body.method === "notifications/initialized") return new Response(null, {status:202});
        const result = body.method === "initialize" ? {serverInfo:{version:"0.2.0"}} : body.method === "tools/list" ? {tools:["grok_inbox","grok_send","grok_reply","grok_ack","grok_status"].map(name=>({name}))} : body.params.name === "grok_status" ? {structuredContent:{summary:{poll:{at:1,ok:true,queued:0},wakes_today:0,open:0}}} : null;
        return Response.json({jsonrpc:"2.0",id:body.id,result});
      };`);
    const result = spawnSync(process.execPath, ["--import", mock, path.join(root, "scripts/check-adapter-mcp.mjs"), "--url-env", "CCIM_GINKOAI_MCP_URL", "--bearer-env", "CCIM_GINKOAI_MCP_BEARER"], {
      encoding: "utf8", env: { PATH: process.env.PATH, CCIM_GINKOAI_MCP_URL: "https://adapter.example.invalid/mcp", CCIM_GINKOAI_MCP_BEARER: "fixture-bearer" },
    });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).poll.ok, true);
    assert.doesNotMatch(result.stdout + result.stderr, /fixture-bearer|adapter\.example/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
