"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); } catch (error) { return error.code === "ESRCH" ? null : "unknown"; }
  if (process.platform === "linux") {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const ticks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
      return `${fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}:${ticks}`;
    } catch { return "unknown"; }
  }
  const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8", timeout: 1500, env: { ...process.env, LC_ALL: "C" }, stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : "unknown";
}

function listenerAlive(s, identify = processIdentity) {
  const current = identify(s.listenerPid);
  if (!current) return false;
  // An old binding without a fingerprint must not authorize killing an unrelated live PID.
  return !s.listenerIdentity || current === "unknown" || current === s.listenerIdentity;
}

function publish(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  try { fs.linkSync(temporary, file); return true; }
  catch (error) { if (error.code === "EEXIST") return false; throw error; }
  finally { fs.unlinkSync(temporary); }
}

function runtimeDirectory(sessionFile) {
  const canonical = fs.realpathSync(sessionFile);
  return path.join(path.dirname(canonical), ".receiver-runtime", path.basename(canonical, ".json"));
}

function acquire(sessionFile, { identify = processIdentity, log = () => {} } = {}) {
  const directory = runtimeDirectory(sessionFile);
  const generations = path.join(directory, "owners");
  fs.mkdirSync(generations, { recursive: true, mode: 0o700 });
  const identity = identify(process.pid);
  if (!identity || identity === "unknown") throw Object.assign(new Error("owner_identity_unknown"), { code: "owner_identity_unknown" });
  const owner = { pid: process.pid, identity, runId: crypto.randomUUID(), startedAt: new Date().toISOString() };
  let file = path.join(directory, "owner.lock"), reclaimed = false;
  // Immutable successor records are a filesystem CAS: racing reclaimers link the same
  // next filename, so a delayed reclaimer can never unlink a newer live owner's lock.
  for (let depth = 0; depth < 10000; depth++) {
    if (publish(file, owner)) {
      if (reclaimed) log("lock_reclaimed");
      return { directory, owner, release: () => { publish(path.join(generations, `${owner.runId}.released`), {}); } };
    }
    let previous;
    try { previous = JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { throw Object.assign(new Error("lock_corrupt"), { code: "lock_corrupt" }); }
    if (!/^[a-f0-9-]{36}$/.test(previous.runId || "") || !Number.isSafeInteger(previous.pid))
      throw Object.assign(new Error("lock_corrupt"), { code: "lock_corrupt" });
    const next = path.join(generations, `${previous.runId}.next`);
    if (fs.existsSync(next)) { file = next; continue; }
    const released = fs.existsSync(path.join(generations, `${previous.runId}.released`));
    const current = released ? null : identify(previous.pid);
    if (!released && current && (current === "unknown" || !previous.identity || current === previous.identity)) {
      log("lock_busy"); return null;
    }
    reclaimed ||= !released;
    file = next;
  }
  throw Object.assign(new Error("lock_history_limit"), { code: "lock_history_limit" });
}

module.exports = { acquire, runtimeDirectory, listenerAlive, processIdentity };
