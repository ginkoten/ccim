// Persistent downstream auth stop. Never key it by a credential: rotating a secret must not silently resume work.
import { sha256 } from "./util.js";

export function guardRelay(relay, { storage, cfg, now, backlog }) {
  const key = sha256(JSON.stringify([cfg.relay, cfg.channel, cfg.handle, cfg.relayMode])).then(h => `auth:${h}`);
  const read = async () => (await storage.get(await key)) || null;
  const failed = () => ({ ok: false, outcome: "rejected", status: 401, error: "downstream_auth_blocked" });
  const layer = cfg.relayMode === "direct" ? "relay_member" : "relay_oauth";
  const guarded = {
    authState: read,
    // Explicit read-only diagnostics do not change control state or refresh credentials.
    identity: async () => (await read())?.blocked ? failed() : relay.identity(),
    // Explicit diagnostics use the configured credential but never alter the stop or recovery ledger.
    probeIdentity: () => relay.identity(),
  };
  for (const op of ["peek", "ack", "send"]) {
    guarded[op] = async (...args) => {
      if ((await read())?.blocked) return failed();
      const isolationError = await backlog?.rejection(op === "ack" ? args[0] : []);
      if (isolationError) return { ok: false, outcome: "rejected", status: 409, error: isolationError };
      const result = await relay[op](...args);
      if (result.status === 401) {
        await storage.transaction(async tx => {
          const k = await key, prev = await tx.get(k);
          if (!prev?.blocked) await tx.put(k, { blocked: true, layer, reason: "downstream_http_401", at: now(), operation: op });
        });
      }
      if (op === "peek" && result.ok && backlog) {
        const state = await backlog.status();
        if (state.active) return { ...result, messages: result.messages.filter(m => Number.isSafeInteger(m.id) && m.id > state.through_id) };
      }
      return result;
    };
  }
  // Operator-configured recovery only. A unique non-secret approval id claims exactly one read-only attempt,
  // including across crashes. Cron requires an explicit deployment marker; MCP and secret changes cannot clear it.
  guarded.recheck = async (approvalId, supersedes, allowBacklogApproval) => {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(approvalId || "")) return { ok: false, error: "approval_id_required" };
    if (supersedes !== undefined && !/^[A-Za-z0-9_-]{8,64}$/.test(supersedes)) return { ok: false, error: "invalid_superseded_approval" };
    if (cfg.relayMode !== "direct") return { ok: false, error: "oauth_recovery_requires_operator" };
    // Check before claiming the approval: missing isolation must not consume it.
    const fence = await backlog?.status();
    if (fence?.error) return { ok: false, error: fence.error };
    if (!fence?.active && allowBacklogApproval !== approvalId)
      return { ok: false, error: "backlog_isolation_required" };
    const k = await key, attemptKey = `${k}:recheck:${approvalId}`;
    const claim = await storage.transaction(async tx => {
      const prev = await tx.get(k);
      if (!prev?.blocked) return { ok: false, error: "auth_not_blocked" };
      if (await tx.get(attemptKey)) return { ok: false, error: "approval_already_used" };
      if (supersedes !== undefined) {
        if (prev.recovery?.state !== "checking" || prev.recovery.approval_id !== supersedes || approvalId === supersedes)
          return { ok: false, error: "supersession_target_mismatch" };
        const previousKey = `${k}:recheck:${supersedes}`;
        const previous = (await tx.get(previousKey)) || prev.recovery;
        await tx.put(previousKey, { ...previous, state: "superseded", superseded_by: approvalId,
          superseded_at: now(), reason: "operator_superseded_unfinished_check" });
      } else if (prev.recovery?.state === "checking") return { ok: false, error: "recheck_outcome_unknown" };
      const next = { ...prev, recovery: { approval_id: approvalId, state: "checking", at: now(),
        ...(supersedes !== undefined && { supersedes }) } };
      await tx.put({ [k]: next, [attemptKey]: next.recovery });
      return { ok: true };
    });
    if (!claim.ok) return claim;
    const result = await relay.identity(); // exactly GET who; never joins, sends, ACKs or refreshes OAuth
    const outcome = { state: result.ok ? "verified" : "failed", finished_at: now(),
      reason: result.ok ? "identity_verified" : result.status === 401 ? "downstream_http_401" : "identity_unverified" };
    return storage.transaction(async tx => {
      const current = await tx.get(k);
      // Compare the active approval inside the commit transaction: an old HTTP request may finish after takeover.
      if (current?.recovery?.approval_id !== approvalId || current.recovery.state !== "checking") {
        const previous = await tx.get(attemptKey);
        if (previous?.state === "superseded") await tx.put(attemptKey, { ...previous, late_result: outcome });
        return { ok: false, error: "recheck_superseded" };
      }
      const record = { ...current, blocked: !result.ok, recovery: { ...current.recovery, ...outcome } };
      await tx.put({ [k]: record, [attemptKey]: record.recovery });
      return { ok: result.ok, error: result.ok ? undefined : outcome.reason };
    });
  };
  return guarded;
}
