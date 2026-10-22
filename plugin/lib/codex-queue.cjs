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
  fail(code = "rpc_unavailable") {
    this.dead = true;
    for (const job of this.pending.values()) {
      clearTimeout(job.timer);
      job.reject(Object.assign(new Error(code), { code }));
    }
    this.pending.clear();
  }
  receive(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 16 * 1024 * 1024) { this.fail("rpc_response_too_large"); return this.close(); }
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error("rpc_timeout"), { code: "rpc_timeout" })); }, this.timeout);
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

async function findDelivery(rpc, threadId, deliveryId, onEvent = () => {}) {
  let cursor = null;
  const seen = new Set();
  for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
    const page = await rpc.call("thread/queue/list", { threadId, cursor, limit: 100 });
    if (page.error || !Array.isArray(page.result?.data)) return "unknown";
    if (page.result.data.some(item => item.clientUserMessageId === deliveryId)) return "accepted";
    cursor = page.result.nextCursor || null;
    if (!cursor) break;
    if (cursor && seen.has(cursor)) return "unknown";
    seen.add(cursor);
  }
  if (cursor) { onEvent("queue_page_limit"); return "unknown"; }
  // The installed public schema exposes userMessage.clientId, not clientUserMessageId.
  // Never use body text (including a quoted marker) as delivery evidence.
  for (let pageNumber = 0; pageNumber < 3; pageNumber++) {
    const page = await rpc.call("thread/turns/list", { threadId, cursor, limit: 20, sortDirection: "desc", itemsView: "full" });
    if (page.error || !Array.isArray(page.result?.data)) return "unknown";
    if (page.result.data.some(turn => Array.isArray(turn.items) && turn.items.some(item =>
      item.type === "userMessage" && item.clientId === deliveryId))) return "accepted";
    cursor = page.result.nextCursor || null;
    if (!cursor) return "not_observed";
  }
  onEvent("history_page_limit");
  return "unknown";
}

async function submit({ binary, env, threadId, deliveryId, text, reconcileOnly = false, rpcFactory, onEvent = () => {} }) {
  const rpc = rpcFactory ? rpcFactory() : new QueueRpc(binary, env);
  let addIssued = false;
  try {
    await rpc.initialize();
    if (reconcileOnly) {
      const found = await findDelivery(rpc, threadId, deliveryId, onEvent);
      return found === "accepted" ? "accepted" : "uncertain";
    }
    addIssued = true;
    const added = await rpc.call("thread/queue/add", {
      threadId, clientUserMessageId: deliveryId,
      input: [{ type: "text", text, text_elements: [] }],
    });
    if (added.result?.queuedSubmission?.clientUserMessageId === deliveryId) return "accepted";
    // Do not infer non-delivery from an arbitrary server error after issuing a mutation.
    return "uncertain";
  } catch (error) {
    onEvent(["rpc_response_too_large", "rpc_timeout", "rpc_unavailable"].includes(error.code) ? error.code : "rpc_failed");
    return addIssued || reconcileOnly ? "uncertain" : "not_sent";
  } finally { rpc.close(); }
}

module.exports = { QueueRpc, findDelivery, submit };
