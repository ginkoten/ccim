import { test } from "node:test";
import assert from "node:assert/strict";
import { macosProxyEnv } from "../macos-proxy.cjs";

const system = (port = 12345) => `<dictionary> {\n HTTPEnable : 1\n HTTPProxy : 127.0.0.1\n HTTPPort : ${port}\n}`;
const options = (text) => ({ nodeVersion: "24.16.0", readProxy: () => text });

test("receiver proxy reads current system settings on every launch and preserves receiver identity", () => {
  const base = { CCIM_HOME: "fixture-home", CCIM_CODEX: "fixture-runtime", HTTPS_PROXY: "stale", https_proxy: "stale", NO_PROXY: "*" };
  for (const port of [12345, 23456]) {
    const env = macosProxyEnv(base, options(system(port)));
    assert.equal(env.HTTPS_PROXY, `http://127.0.0.1:${port}`);
    assert.equal(env.HTTP_PROXY, env.HTTPS_PROXY);
    assert.equal(env.https_proxy, env.HTTPS_PROXY);
    assert.equal(env.NODE_USE_ENV_PROXY, "1");
    assert.equal(env.NO_PROXY, "localhost,127.0.0.1,::1");
    assert.equal(env.no_proxy, env.NO_PROXY);
    assert.equal(env.CCIM_HOME, base.CCIM_HOME);
    assert.equal(env.CCIM_CODEX, base.CCIM_CODEX);
  }
  assert.equal(base.HTTPS_PROXY, "stale");
});

test("receiver proxy supports separate HTTPS CONNECT and IPv6 endpoints", () => {
  const env = macosProxyEnv({}, options(system() + "\n HTTPSEnable : 1\n HTTPSProxy : ::1\n HTTPSPort : 23456\n"));
  assert.equal(env.HTTP_PROXY, "http://127.0.0.1:12345");
  assert.equal(env.HTTPS_PROXY, "http://[::1]:23456");
});

test("receiver proxy refuses missing or credential-bearing settings without exposing values", () => {
  for (const text of ["", "HTTPEnable : 0", system(0), system(65536), system().replace("127.0.0.1", "fixture-user:fixture-password@host")]) {
    assert.throws(() => macosProxyEnv({}, options(text)), (error) => /system proxy/.test(error.message) && !/fixture-|65536/.test(error.message));
  }
  assert.throws(() => macosProxyEnv({}, { readProxy: () => { throw Error("fixture-sensitive"); } }), /^Error: Cannot read system proxy; no proxy details printed$/);
});

test("receiver proxy enforces Node versions supporting fetch and HTTP environment proxies", () => {
  for (const nodeVersion of ["20.19.0", "22.20.0", "23.0.0", "24.4.0"]) assert.throws(() => macosProxyEnv({}, { ...options(system()), nodeVersion }), /requires Node/);
  for (const nodeVersion of ["22.21.0", "24.5.0", "24.16.0", "25.0.0"]) assert.equal(macosProxyEnv({}, { ...options(system()), nodeVersion }).NODE_USE_ENV_PROXY, "1");
});
