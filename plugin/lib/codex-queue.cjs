"use strict";
const { spawn } = require("node:child_process");

// Use the public protocol; message bodies stay on stdin, never in process arguments/logs.
class QueueRpc {
  constructor(binary, env, timeout = 15000) {
    this.child = spawn(binary, ["app-server", "--listen", "stdio://"], { env, stdio: ["pipe", "pipe", "ignore"] });
    this.pending = new Map();
    this.nextId = 0;
    this.buffer = "";
    this.timeout = timeout;
    this.dead = false;
    this.child.on("error", () => this.fail());
    this.child.on("exit", () => this.fail());
    this.child.stdin.on("error", () => this.fail());
    this.child.stdout.on("data", chunk => this.receive(chunk));
  }
  fail() {
    this.dead = true;
    for (const job of this.pending.values()) {
      clearTimeout(job.timer);
      job.reject(new Error("rpc_unavailable"));
    }
    this.pending.clear();
  }
  receive(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 16 * 1024 * 1024) return this.close();
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      let value;
      try { value = JSON.parse(line); } catch { continue; }
      const job = this.pending.get(value.id);
      if (!job) continue;
      this.pending.delete(value.id);
      clearTimeout(job.timer);
      job.resolve(value);
    }
  }
  call(method, params) {
    if (this.dead) return Promise.reject(new Error("rpc_unavailable"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error("rpc_timeout")); }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  async initialize() {
    const response = await this.call("initialize", {
      clientInfo: { name: "ccim_receiver", version: "1.0.0" }, capabilities: { experimentalApi: true },
    });
    if (response.error) throw new Error("rpc_initialize_rejected");
    this.child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n");
  }
  close() {
    this.fail();
    this.child.stdin.destroy();
    this.child.kill();
  }
}

function containsMarker(value, marker) {
  if (!value || typeof value !== "object") return false;
  if (typeof value.text === "string" && value.text.includes(marker)) return true;
  return Object.values(value).some(item => typeof item === "object" && containsMarker(item, marker));
}

async function findDelivery(rpc, threadId, deliveryId, marker) {
  let cursor = null;
  const seen = new Set();
  do {
    const page = await rpc.call("thread/queue/list", { threadId, cursor, limit: 100 });
    if (page.error || !Array.isArray(page.result?.data)) return "unknown";
    if (page.result.data.some(item => item.clientUserMessageId === deliveryId || containsMarker(item, marker))) return "accepted";
    cursor = page.result.nextCursor || null;
    if (cursor && seen.has(cursor)) return "unknown";
    seen.add(cursor);
  } while (cursor);
  const history = await rpc.call("thread/read", { threadId, includeTurns: true });
  if (history.error || !history.result?.thread) return "unknown";
  return containsMarker(history.result.thread, marker) ? "accepted" : "not_observed";
}

async function submit({ binary, env, threadId, deliveryId, marker, text, reconcileOnly = false, rpcFactory }) {
  const rpc = rpcFactory ? rpcFactory() : new QueueRpc(binary, env);
  let addIssued = false;
  try {
    await rpc.initialize();
    const found = await findDelivery(rpc, threadId, deliveryId, marker);
    if (found === "accepted") return "accepted";
    if (reconcileOnly) return "uncertain"; // Absence from a snapshot is not proof that an earlier add failed.
    if (found === "unknown") return "not_sent";
    addIssued = true;
    const added = await rpc.call("thread/queue/add", {
      threadId, clientUserMessageId: deliveryId,
      input: [{ type: "text", text, text_elements: [] }],
    });
    if (added.result?.queuedSubmission?.clientUserMessageId === deliveryId) return "accepted";
    // Do not infer non-delivery from an arbitrary server error after issuing a mutation.
    return "uncertain";
  } catch {
    return addIssued || reconcileOnly ? "uncertain" : "not_sent";
  } finally { rpc.close(); }
}

module.exports = { QueueRpc, containsMarker, findDelivery, submit };
