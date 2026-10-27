// Bounded, non-secret journal. Mutations and their event commit in the same storage transaction.
export const AUDIT_LIMIT = 256;
export async function audit(storage, { channel, member, action, reason, generation }) {
  const sequence = ((await storage.get("audit:sequence")) || 0) + 1;
  const event = { sequence, channel, member, action, at: Date.now(), generation: generation ?? null, reason };
  await storage.put({ "audit:sequence": sequence, [`audit:event:${String(sequence % AUDIT_LIMIT).padStart(3, "0")}`]: event });
  return sequence;
}

export async function lifecycle(storage) {
  const records = await storage.list({ prefix: "audit:event:" });
  return [...records.values()].sort((a, b) => a.sequence - b.sequence);
}

export async function clearChannel(storage) {
  // Keep only the bounded audit and monotonic generation counter; revoke every token and queued message.
  const keys = [...(await storage.list()).keys()].filter(k => !k.startsWith("audit:") && k !== "memberGeneration");
  for (let i = 0; i < keys.length; i += 128) await storage.delete(keys.slice(i, i + 128));
}
