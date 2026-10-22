"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const hash = text => crypto.createHash("sha256").update(text).digest("hex");
const STATES = new Set(["not_sent", "uncertain", "accepted", "acked", "stuck"]);
function generation(s) {
  if (!s.token || !s.channel || !s.relay) throw Object.assign(new Error("binding_incomplete"), { code: "binding_incomplete" });
  return hash(JSON.stringify([s.relay, s.channel, s.token]));
}
function atomicJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, file);
}
function valid(journal) {
  return journal?.version === 2 && typeof journal.quarantined === "boolean" &&
    journal.entries && !Array.isArray(journal.entries) && typeof journal.entries === "object" &&
    Object.values(journal.entries).every(e => e && STATES.has(e.state) &&
      typeof e.deliveryId === "string" && Number.isInteger(e.attempts) && e.attempts >= 0 &&
      Number.isFinite(e.nextAttemptAt) && Number.isFinite(e.updatedAt));
}
function journalPath(directory, s) { return path.join(directory, `delivery-${generation(s)}.json`); }
function openJournal(directory, s, log) {
  const file = journalPath(directory, s), hold = `${file}.recovery-required`;
  const legacy = fs.existsSync(path.join(directory, "delivery.json"));
  let data = { version: 2, quarantined: legacy || fs.existsSync(hold), entries: {} };
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, "utf8");
    try { data = JSON.parse(text); if (!valid(data)) throw new Error("invalid_journal"); }
    catch {
      // Persist the hold before renaming: a crash in recovery must not forget uncertainty.
      fs.writeFileSync(hold, "journal_corrupt\n", { mode: 0o600 });
      fs.renameSync(file, `${file}.corrupt-${Date.now()}-${crypto.randomUUID()}`);
      data = { version: 2, quarantined: true, entries: {} };
      log("journal_corrupt");
    }
  }
  if (legacy || fs.existsSync(hold)) data.quarantined = true;
  if (legacy) log("journal_legacy_hold");
  atomicJson(file, data);
  return { data, save: () => atomicJson(file, data) };
}
function deliveryStatus(directory, s) {
  const file = journalPath(directory, s);
  if (!fs.existsSync(file)) return { state: "no_current_journal", legacy: fs.existsSync(path.join(directory, "delivery.json")) };
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); if (!valid(data)) throw new Error(); }
  catch { return { state: "journal_corrupt" }; }
  return { state: data.quarantined ? "reconciliation_only" : "ready",
    pending: Object.entries(data.entries).filter(([, e]) => e.state !== "acked").map(([id, e]) =>
      ({ messageId: Number(id), state: e.state, attempts: e.attempts, nextAttemptAt: e.nextAttemptAt })) };
}
module.exports = { generation, journalPath, openJournal, deliveryStatus };
