// Immutable relay sequence fence. No message, completion, or dedup records are rewritten.
export function backlogPolicy(storage, env, cfg, now) {
  const key = "backlog:fence:v1";
  const binding = JSON.stringify([cfg.relay, cfg.channel, cfg.handle]);
  const configured = env.BACKLOG_THROUGH_ID;
  const parsed = configured === undefined ? null : Number(configured);
  const valid = configured === undefined || (/^[1-9][0-9]*$/.test(configured) && Number.isSafeInteger(parsed));
  async function status() {
    if (env.BACKLOG_HOLD === "on") return { active: true, error: "backlog_operator_hold" };
    if (env.BACKLOG_HOLD !== undefined && env.BACKLOG_HOLD !== "off") return { active: true, error: "backlog_hold_invalid" };
    const saved = await storage.get(key);
    if (!valid || (saved && (!Number.isSafeInteger(saved.through_id) || saved.through_id < 1 || saved.binding !== binding || (parsed !== null && parsed !== saved.through_id))))
      return { active: true, error: "backlog_fence_conflict" };
    if (saved) return { active: true, through_id: saved.through_id, installed_at: saved.installed_at };
    return parsed === null ? { active: false } : { active: true, error: "backlog_fence_pending" };
  }
  async function initialize() {
    if (parsed !== null && valid) await storage.transaction(async tx => {
      if (!(await tx.get(key))) await tx.put(key, { binding, through_id: parsed, installed_at: now() });
    });
    return status();
  }
  async function rejection(ids = []) {
    const state = await status();
    if (state.error) return state.error;
    return state.active && ids.some(id => !Number.isSafeInteger(id) || id <= state.through_id) ? "backlog_quarantined" : null;
  }
  return { status, initialize, rejection };
}
