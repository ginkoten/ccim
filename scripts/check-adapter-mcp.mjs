// Read-only diagnostic for this adapter's stateless JSON MCP endpoint.
import { pathToFileURL } from "node:url";

const TOOLS = ["grok_inbox", "grok_reply", "grok_send", "grok_ack", "grok_status"];
class CheckError extends Error {}
function safeBinding(binding) {
  if (!binding) return null;
  const name = value => typeof value === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(value) ? value : null;
  let relay_origin = null;
  try { const url = new URL(binding.relay_origin); if (url.protocol === "https:" && !url.username && !url.password) relay_origin = url.origin; } catch {}
  return { channel: name(binding.channel), handle: name(binding.handle), relay_mode: ["direct", "author-mcp"].includes(binding.relay_mode) ? binding.relay_mode : null, relay_origin };
}

export function adapterOptionsFromEnv(args = [], env = process.env) {
  const names = { "--url-env": "CCIM_ADAPTER_MCP_URL", "--bearer-env": "CCIM_ADAPTER_MCP_BEARER" };
  const seen = new Set();
  let probeIdentity = false;
  for (let i = 0; i < args.length;) {
    if (args[i] === "--probe-identity" && !probeIdentity) { probeIdentity = true; i++; continue; }
    const flag = args[i], name = args[i + 1];
    i += 2;
    if (!Object.hasOwn(names, flag) || seen.has(flag) || typeof name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      throw new CheckError("invalid_env_option");
    seen.add(flag);
    names[flag] = name;
  }
  return { url: env[names["--url-env"]], bearer: env[names["--bearer-env"]], ...(probeIdentity && { probeIdentity }) };
}

export async function inspectAdapter({ url, bearer, probeIdentity = false, request = fetch }) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new CheckError("invalid_mcp_url"); }
  if (endpoint.protocol !== "https:" || endpoint.pathname !== "/mcp" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new CheckError("invalid_mcp_url");
  if (typeof bearer !== "string" || !bearer.trim() || /[\r\n]/.test(bearer)) throw new CheckError("missing_or_invalid_bearer");
  let id = 0;
  async function rpc(method, params, notification = false) {
    const response = await request(endpoint.href, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${bearer}`, "mcp-protocol-version": "2025-03-26" },
      body: JSON.stringify({ jsonrpc: "2.0", ...(!notification && { id: ++id }), method, ...(params && { params }) }),
    });
    if (response.status !== (notification ? 202 : 200)) throw new CheckError(`http_${response.status}`);
    if (notification) return;
    let body;
    try { body = await response.json(); } catch { throw new CheckError("invalid_json_response"); }
    if (body?.error || !body?.result || body.id !== id) throw new CheckError("invalid_rpc_result");
    return body.result;
  }
  const initialized = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ccim-readonly-check", version: "1.0.0" } });
  await rpc("notifications/initialized", undefined, true);
  const listed = await rpc("tools/list", {});
  const available = new Set((listed.tools || []).map(t => t.name));
  if (!TOOLS.every(name => available.has(name))) throw new CheckError("missing_adapter_tools");
  const status = await rpc("tools/call", { name: "grok_status", arguments: { health: true, ...(probeIdentity && { probe_identity: true }) } });
  if (status.isError || !status.structuredContent?.summary) throw new CheckError("status_unavailable");
  const summary = status.structuredContent.summary;
  // Only print known diagnostic fields: never raw response text, URLs, messages or headers.
  const poll = summary.poll;
  const version = initialized.serverInfo?.version;
  return {
    server_version: typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version) ? version : null,
    tools: TOOLS,
    entry_auth: "authenticated",
    identity_probe: probeIdentity ? { source: status.structuredContent.probe?.source === "worker_bound_identity" ? "worker_bound_identity" : null, checked_at: Number.isSafeInteger(status.structuredContent.probe?.checked_at) ? status.structuredContent.probe.checked_at : null } : null,
    auth_stop_at: Number.isSafeInteger(summary.health?.downstream_auth?.at) ? summary.health.downstream_auth.at : null,
    binding: safeBinding(summary.health?.binding),
    downstream_auth: status.structuredContent.downstream ? {
      ok: status.structuredContent.downstream.ok === true,
      status: Number.isInteger(status.structuredContent.downstream.status) ? status.structuredContent.downstream.status : null,
      blocked: summary.health?.downstream_auth?.blocked === true,
    } : { ok: null, status: null, blocked: null },
    poll: poll ? { at: Number.isSafeInteger(poll.at) ? poll.at : null, ok: poll.ok === true, queued: Number.isSafeInteger(poll.queued) ? poll.queued : null } : null,
    wakes_today: Number.isSafeInteger(summary.wakes_today) ? summary.wakes_today : null,
    open: Number.isSafeInteger(summary.open) ? summary.open : null,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await inspectAdapter(adapterOptionsFromEnv(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof CheckError ? error.message : "mcp_check_failed", retried: false }));
    process.exitCode = 1;
  }
}
