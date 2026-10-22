"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { submit } = require("./codex-queue.cjs");
const { acquire, runtimeDirectory } = require("./codex-ownership.cjs");

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function eventLogger(directory, owner, sessionId) {
  const file = path.join(directory, "events.jsonl");
  const allowed = new Set(["reason", "code", "messageId", "deliveryId", "delayMs", "count"]);
  return (event, fields = {}) => {
    const safe = Object.fromEntries(Object.entries(fields).filter(([key, value]) => allowed.has(key) &&
      (typeof value === "number" || typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value))));
    if (fs.existsSync(file) && fs.statSync(file).size >= 1024 * 1024) fs.renameSync(file, file + ".previous");
    fs.appendFileSync(file, JSON.stringify({ utc: new Date().toISOString(), event, sessionId, ...owner, ...safe }) + "\n", { mode: 0o600 });
  };
}

function deliveryId(channel, id) {
  const h = hash(`${channel}:${id}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function createDelivery({ directory, sessionId, s, api, format, log, env, queue = submit }) {
  const file = path.join(directory, "delivery.json");
  let journal = {};
  if (fs.existsSync(file)) journal = JSON.parse(fs.readFileSync(file, "utf8"));
  const save = () => atomicJson(file, journal);
  return async message => {
    const key = `${s.channel}:${message.id}`;
    const id = deliveryId(s.channel, message.id);
    const marker = `[ccim-delivery:${id}]`;
    const previous = journal[key];
    if (previous?.state === "acked") return "acked";
    if (previous?.state !== "accepted") {
      const reconcileOnly = previous?.state === "uncertain";
      journal[key] = { state: "uncertain", deliveryId: id, updatedAt: new Date().toISOString() };
      save(); // Crash after queue acceptance must not turn into an unconditional re-send.
      const result = await queue({ binary: env.CCIM_CODEX || "codex", env, threadId: sessionId, deliveryId: id, marker,
        text: format(s, [message]) + "\n" + marker, reconcileOnly });
      journal[key] = { ...journal[key], state: result, updatedAt: new Date().toISOString() };
      save();
      log("delivery", { reason: result, messageId: message.id, deliveryId: id });
      if (result !== "accepted") return result;
    }
    const ack = await api(s, "POST", "ack", { ids: [message.id] }).catch(() => null);
    if (ack?.status !== 200) { log("ack_deferred", { messageId: message.id }); return "accepted"; }
    journal[key] = { ...journal[key], state: "acked", updatedAt: new Date().toISOString() };
    save();
    log("acknowledged", { messageId: message.id, deliveryId: id });
    return "acked";
  };
}

function connection({ s, onMessage, log, sockets, WebSocketImpl = WebSocket, connectTimeout = 15000, heartbeatMs = 30000 }) {
  return new Promise(resolve => {
    const ws = new WebSocketImpl(`${s.relay.replace(/^http/, "ws")}/c/${s.channel}/listen`, ["ccim", s.token]);
    sockets.add(ws);
    let settled = false, ping, lastPong = Date.now();
    const done = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout); clearInterval(ping); sockets.delete(ws);
      try { ws.close(); } catch { /* Connection may already be closed. */ }
      resolve(result);
    };
    const timeout = setTimeout(() => done({ reason: "connect_timeout" }), connectTimeout);
    ws.onopen = () => {
      if (settled) return;
      clearTimeout(timeout);
      log("connected");
      ping = setInterval(() => {
        if (Date.now() - lastPong > heartbeatMs * 3) return done({ reason: "heartbeat_timeout" });
        try { ws.send("ping"); } catch { done({ reason: "ping_failed" }); }
      }, heartbeatMs);
    };
    ws.onmessage = ({ data }) => {
      if (settled) return;
      if (data === "pong") { lastPong = Date.now(); return; }
      let message;
      try { message = JSON.parse(data); } catch { log("invalid_frame"); return; }
      if (message?.type === "msg" && Number.isSafeInteger(message.id) && message.id > 0) onMessage(message);
    };
    ws.onerror = () => done({ reason: "socket_error" });
    ws.onclose = ({ code }) => done({ reason: `close_${code}`, code, terminal: [4001, 4002, 4003].includes(code) });
  });
}

async function listen({ s, sessionId, sessionFile, writeSession, api, format, env = process.env }) {
  const diagnosticDirectory = runtimeDirectory(sessionFile);
  fs.mkdirSync(diagnosticDirectory, { recursive: true, mode: 0o700 });
  const diagnosticLog = eventLogger(diagnosticDirectory, { pid: process.pid }, sessionId);
  const ownership = acquire(sessionFile, { log: diagnosticLog });
  if (!ownership) throw Object.assign(new Error("lock_busy"), { code: "lock_busy" });
  const { directory, owner } = ownership;
  const log = eventLogger(directory, owner, sessionId);
  const sockets = new Set(), pending = new Map();
  let deliver;
  let stopping = false, reason = "completed", failure, working = false;
  const stop = signal => {
    stopping = true; reason = signal;
    for (const ws of sockets) try { ws.close(1000); } catch { /* Shutdown also waits for the bounded connection timeout. */ }
  };
  const term = () => stop("SIGTERM"), interrupt = () => stop("SIGINT");
  const drain = async () => {
    if (working || stopping) return;
    working = true;
    try {
      for (const [id, message] of pending) {
        if (stopping) break;
        if (await deliver(message) === "acked") pending.delete(id);
      }
    } catch {
      failure = true; stop("runtime_error");
    } finally { working = false; }
  };
  process.on("SIGTERM", term); process.on("SIGINT", interrupt);
  let timer;
  try {
    deliver = createDelivery({ directory, sessionId, s, api, format, log, env });
    writeSession({ ...s, listenerPid: process.pid, listenerIdentity: owner.identity });
    log("started", { reason: "reliable_v1" });
    timer = setInterval(() => { void drain(); }, 15000);
    for (let delay = 1000; !stopping; delay = Math.min(delay * 2, 30000)) {
      const probe = await api(s, "GET", "who").catch(() => null);
      if (stopping) break;
      if (probe?.status === 401) { reason = "unauthorized"; break; }
      if (probe?.status === 200) {
        const outcome = await connection({ s, log, sockets, onMessage: message => {
          pending.set(message.id, message); void drain();
        } });
        log("disconnected", outcome);
        if (outcome.terminal) { reason = outcome.reason; break; }
        delay = 1000;
      } else log("probe_failed", { code: probe?.status || 0 });
      if (!stopping) { log("reconnect_wait", { delayMs: delay }); await pause(delay); }
    }
  } catch { failure = true; reason = "runtime_error"; }
  finally {
    stopping = true; clearInterval(timer);
    for (const ws of sockets) try { ws.close(); } catch { /* Already closed. */ }
    // Keep the lock until an in-flight queue request settles; another listener must not race it.
    while (working) await pause(50);
    try { log("exited", { reason }); } finally {
      process.off("SIGTERM", term); process.off("SIGINT", interrupt); ownership.release();
    }
  }
  if (failure) throw new Error("reliable_receiver_failed");
}

module.exports = { acquire, eventLogger, deliveryId, createDelivery, connection, listen };
