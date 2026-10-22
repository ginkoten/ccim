"use strict";
const { execFileSync } = require("node:child_process");
const { isIP } = require("node:net");

function proxyAddress(text, kind) {
  const field = (name) => text.match(new RegExp(`^\\s*${name}\\s*:\\s*(.*?)\\s*$`, "m"))?.[1];
  if (field(`${kind}Enable`) !== "1") return null;
  const host = field(`${kind}Proxy`) || "";
  const port = field(`${kind}Port`) || "";
  const ipv6 = isIP(host) === 6;
  if ((!ipv6 && !/^[a-zA-Z0-9.-]+$/.test(host)) || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)
    throw new Error("Invalid system proxy endpoint; no proxy details printed");
  return `http://${ipv6 ? `[${host}]` : host}:${Number(port)}`;
}

function macosProxyEnv(base = process.env, options = {}) {
  const [major, minor] = (options.nodeVersion || process.versions.node).split(".").map(Number);
  if (!(major > 24 || (major === 24 && minor >= 5) || (major === 22 && minor >= 21)))
    throw new Error("ccim proxy requires Node 22.21+ or 24.5+");
  let text;
  try {
    text = options.readProxy ? options.readProxy() : execFileSync("/usr/sbin/scutil", ["--proxy"], {
      encoding: "utf8", timeout: options.timeout ?? 3000, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch { throw new Error("Cannot read system proxy; no proxy details printed"); }
  const http = proxyAddress(text, "HTTP");
  const https = proxyAddress(text, "HTTPS");
  if (!http && !https) throw new Error("No enabled HTTP(S) system proxy; check local proxy settings");
  // Set both cases because HTTP clients differ in which spelling takes precedence.
  return { ...base, HTTP_PROXY: http || https, HTTPS_PROXY: https || http,
    http_proxy: http || https, https_proxy: https || http,
    NODE_USE_ENV_PROXY: "1", NO_PROXY: "localhost,127.0.0.1,::1", no_proxy: "localhost,127.0.0.1,::1" };
}

module.exports = { macosProxyEnv };
