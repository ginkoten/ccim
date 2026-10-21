import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, WEBHOOK_KEY, TOKEN, MCP_BEARER } from "./helpers.js";

const status = async (h, ids) => (await h.mcp("grok_status", ids ? { ids } : {})).structuredContent;

test("direct message wakes once; webhook carries ids, senders, channel and bearer, never text", async () => {
  const h = harness();
  const id = h.relay.deliver("neo-codex", "grok", "ping-001 secret-ish text");
  const r = await h.tick();
  assert.equal(r.woke, true);
  assert.equal(h.webhook.calls.length, 1);
  const call = h.webhook.calls[0];
  assert.equal(call.headers.authorization, `Bearer ${WEBHOOK_KEY}`);
  const body = JSON.parse(call.body);
  assert.deepEqual(body, { channel: "ginko-bridge", message_ids: [id], senders: ["neo-codex"] });
  assert.ok(!call.body.includes("ping-001"));
  assert.deepEqual(Object.keys(body).sort(), ["channel", "message_ids", "senders"]);
  // peek only: the message is still queued on the relay
  assert.equal(h.relay.queues.get("grok").size, 1);
  assert.ok(!h.relay.calls.some((c) => c.op === "ack"));
});

test("dedupe: the same message never wakes twice across ticks", async () => {
  const h = harness();
  h.relay.deliver("neo-codex", "grok", "ping-001");
  await h.tick();
  h.advance(1); await h.tick();
  h.advance(30); await h.tick();
  assert.equal(h.webhook.calls.length, 1);
});

test("broadcasts and own messages do not wake", async () => {
  const h = harness();
  const b = h.relay.deliver("neo-codex", "*", "hello all");
  h.relay.queues.get("grok").set(99, { type: "msg", id: 99, from: "grok", to: "grok", text: "self", urgent: false, ts: 1 });
  const r = await h.tick();
  assert.equal(r.woke, false);
  assert.equal(h.webhook.calls.length, 0);
  const s = await status(h, [b, 99]);
  assert.deepEqual(s.messages.map((m) => [m.id, m.class]), [[b, "broadcast"], [99, "own"]]);
});

test("high-hop direct messages wake and remain readable", async () => {
  const h = harness({ MAX_HOP: "2" });
  const ids = [2, 32, 256].map(hop => h.relay.deliver("claude", "grok", `continue [hop:${hop}]`));
  await h.tick();
  assert.deepEqual(JSON.parse(h.webhook.calls[0].body).message_ids, ids);
  assert.deepEqual((await h.mcp("grok_inbox")).structuredContent.messages.map(m => m.id), ids);
  assert.ok((await status(h, ids)).messages.every(m => m.class === "direct"));
});

test("wake frequency and daily legacy quotas no longer defer new work", async () => {
  const h = harness({ DAILY_CAP: "1", SENDER_LIMIT: "1" });
  await h.storage.put("day:2026-10-20", 100);
  await h.storage.put("rate:neo-codex", [h.clock.t]);
  for (let i = 0; i < 35; i++) {
    h.relay.deliver("neo-codex", "grok", `m${i}`);
    assert.equal((await h.tick()).woke, true);
  }
  const s = await status(h);
  assert.equal(s.summary.wakes_today, 135);
  for (const key of ["daily_cap", "sender_limit", "hop_limit", "send_limit", "send_daily_cap"]) assert.equal(s.summary[key], null);
  await h.tick();
  assert.equal(h.webhook.calls.length, 35, "no repeated wake of the same messages");
});

test("upgrade recovers live hop-blocked messages without resetting receipts or reviving acked messages", async () => {
  const h = harness();
  const { key } = await import("../src/core.js");
  const ids = [1, 2, 3].map(() => h.relay.deliver("claude", "grok", "work [hop:8]"));
  for (let i = 0; i < ids.length; i++) {
    await h.storage.put(key(ids[i]), { id: ids[i], from: "claude", to: "grok", hop: 8, cls: "hop_limit", replies: [],
      stages: { recorded: 123, ...(i === 1 ? { woken: 234 } : {}), ...(i === 2 ? { acked: 345 } : {}) }, wake: { attempts: 0 } });
  }
  await h.tick();
  assert.deepEqual(JSON.parse(h.webhook.calls[0].body).message_ids, [ids[0]]);
  const messages = (await status(h, ids)).messages;
  assert.ok(messages.every(m => m.class === "direct" && m.stages.recorded === 123));
  assert.equal(messages[1].stages.woken, 234);
  assert.equal(messages[2].stages.acked, 345);
  await h.tick();
  assert.equal(h.webhook.calls.length, 1);
});

test("webhook failures (rate limit text, 500, network) retry on later ticks with backoff, bounded", async () => {
  const h = harness({ WAKE_MAX_ATTEMPTS: "3" });
  h.webhook.next([429, '{"success":false,"error":"Automation run rate limit exceeded"}'], [500, "oops"], [400, '{"success":false,"error":"Automation is disabled"}']);
  const id = h.relay.deliver("neo-codex", "grok", "ping");
  await h.tick();
  let m = (await status(h, [id])).messages[0];
  assert.equal(m.wake.attempts, 1);
  assert.equal(m.wake.lastError, "rate_limited");
  await h.tick(); // backoff 1 min not elapsed yet
  assert.equal(h.webhook.calls.length, 1);
  h.advance(1); await h.tick();
  assert.equal(h.webhook.calls.length, 2);
  h.advance(2); await h.tick();
  assert.equal(h.webhook.calls.length, 3);
  m = (await status(h, [id])).messages[0];
  assert.equal(m.wake.failed, true);
  assert.equal(m.stage, "recorded");
  h.advance(60); await h.tick();
  assert.equal(h.webhook.calls.length, 3, "no more attempts after the bound");
});

test("a failed wake followed by success marks woken; 200 with success:false counts as failure", async () => {
  const h = harness();
  h.webhook.next([200, '{"success":false}']);
  const id = h.relay.deliver("neo-codex", "grok", "ping");
  await h.tick();
  assert.equal((await status(h, [id])).messages[0].stage, "recorded");
  h.advance(1); await h.tick();
  const m = (await status(h, [id])).messages[0];
  assert.equal(m.stage, "woken");
  assert.equal(m.wake.runUuid, "run-2");
});

test("relay down: poll failure is recorded, nothing woken, recovers next tick", async () => {
  const h = harness();
  h.relay.deliver("neo-codex", "grok", "ping");
  h.relay.down = true;
  const r = await h.tick();
  assert.equal(r.polled, false);
  assert.equal(h.webhook.calls.length, 0);
  h.relay.down = false;
  h.advance(1);
  assert.equal((await h.tick()).woke, true);
});

test("message acked elsewhere before waking is marked gone and never woken", async () => {
  const h = harness();
  h.webhook.next([500, "x"]);
  const id = h.relay.deliver("neo-codex", "grok", "ping");
  await h.tick();
  h.relay.queues.get("grok").delete(id);
  h.advance(5); await h.tick();
  assert.equal(h.webhook.calls.length, 1);
  assert.equal((await status(h, [id])).messages[0].gone, true);
});

test("logs carry no message text and no secrets", async () => {
  const h = harness();
  h.relay.deliver("neo-codex", "grok", "TOPSECRET-TEXT ping");
  await h.tick();
  await h.mcp("grok_inbox");
  await h.mcp("grok_reply", { reply_to_id: 1, text: "TOPSECRET-REPLY pong" });
  const all = h.logs.join("\n");
  for (const s of ["TOPSECRET", WEBHOOK_KEY, TOKEN, MCP_BEARER, "hooks.test"]) assert.ok(!all.includes(s), `log leaked ${s}`);
});
