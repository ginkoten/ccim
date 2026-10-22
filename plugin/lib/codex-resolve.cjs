"use strict";
const fs = require("node:fs");
const { acquire, listenerAlive } = require("./codex-ownership.cjs");
const { generation, journalPath, valid, atomicJson } = require("./codex-journal.cjs");
const { deliveryId, eventLogger } = require("./codex-reliability.cjs");
const fail = code => { throw new Error(code); };

function parseResolution(args) {
  const [command, rawId, mode, confirmation, flag, epoch] = args;
  if (args.length !== 6 || command !== "resolve" || !/^[1-9]\d*$/.test(rawId || "") ||
      !Number.isSafeInteger(Number(rawId)) || flag !== "--generation" || !/^[a-f0-9]{64}$/.test(epoch || ""))
    fail("invalid_resolution_arguments");
  if (!(mode === "--delivered" && confirmation === "--confirm-delivered") &&
      !(mode === "--resend" && confirmation === "--confirm-duplicate-risk")) fail("resolution_confirmation_required");
  return { id: Number(rawId), mode: mode.slice(2), epoch };
}

function resolveDelivery({ s, sessionId, sessionFile, resolution }) {
  if (s.host !== "codex") fail("resolution_requires_codex_binding");
  if (resolution.epoch !== generation(s)) fail("resolution_generation_mismatch");
  if (listenerAlive(s)) fail("resolution_listener_active_or_unknown");
  const ownership = acquire(sessionFile);
  if (!ownership) fail("lock_busy");
  try {
    // Recheck after winning ownership; all reliable writers use this same lock.
    if (listenerAlive(s)) fail("resolution_listener_active_or_unknown");
    const file = journalPath(ownership.directory, s);
    let data;
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { fail("resolution_journal_unavailable"); }
    if (!valid(data)) fail("resolution_journal_invalid");
    const previous = data.entries[String(resolution.id)];
    if (!previous && !(data.recoveryIds || []).includes(resolution.id)) fail("resolution_entry_unknown");
    if (previous?.state === "acked") fail("resolution_already_acked");
    if (resolution.mode === "resend" && previous?.state === "accepted") fail("resolution_already_accepted");
    data.entries[String(resolution.id)] = { state: resolution.mode === "delivered" ? "accepted" : "not_sent",
      deliveryId: deliveryId(resolution.epoch, resolution.id), attempts: 0, nextAttemptAt: 0, updatedAt: Date.now() };
    atomicJson(file, data);
    eventLogger(ownership.directory, ownership.owner, sessionId)("manual_resolution", {
      messageId: resolution.id, reason: resolution.mode,
    });
    // This stages one decision only. The next normal listener owns queue/ACK execution.
    return { messageId: resolution.id, decision: resolution.mode, staged: true, networkActions: 0 };
  } catch (error) {
    if (/^resolution_[a-z_]+$/.test(error.message)) throw error;
    fail("resolution_io_failed");
  } finally { ownership.release(); }
}
module.exports = { parseResolution, resolveDelivery };
