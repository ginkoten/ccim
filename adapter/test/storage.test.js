import { test } from "node:test";
import assert from "node:assert/strict";
import { scopedStorage } from "../src/storage.js";
import { MemoryStorage, harness } from "./helpers.js";

test("relay namespaces isolate message ids, pending records and reply reservations", async () => {
  const raw = new MemoryStorage();
  await raw.put({ "msg:000000000001": { from: "old" }, "reply:1:p1": { outcome: "sent", relay_id: 11 } });
  const next = scopedStorage(raw, "new-relay/channel/grok");
  assert.equal(await next.get("msg:000000000001"), undefined);
  assert.equal(await next.get("reply:1:p1"), undefined);
  await next.transaction(async (tx) => tx.put({
    "msg:000000000001": { from: "new" },
    "open:000000000001": 1,
    "reply:1:p1": { outcome: "uncertain" },
  }));
  assert.deepEqual(await raw.get("msg:000000000001"), { from: "old" });
  assert.equal((await raw.get("reply:1:p1")).outcome, "sent");
  assert.deepEqual([...await next.list({ prefix: "msg:" })], [["msg:000000000001", { from: "new" }]]);
  assert.equal((await next.get(["reply:1:p1"])).get("reply:1:p1").outcome, "uncertain");
  await next.delete(["open:000000000001"]);
  assert.equal((await next.list({ prefix: "open:" })).size, 0);
  assert.equal(await scopedStorage(raw, "another-relay/channel/grok").get("reply:1:p1"), undefined);
});

test("switching namespaces preserves daily and sender wake budgets", async () => {
  const h = harness();
  h.relay.deliver("neo-codex", "grok", "first");
  assert.equal((await h.tick()).woke, true);
  const oldPoll = await h.storage.get("poll");
  h.env.STATE_NAMESPACE = "new-relay/channel/grok";
  h.env.DAILY_CAP = "1";
  assert.equal((await h.tick()).deferred, "daily_cap");
  assert.equal(h.webhook.calls.length, 1);
  const status = (await h.mcp("grok_status")).structuredContent;
  assert.equal(status.summary.wakes_today, 1);
  h.env.DAILY_CAP = "30";
  h.env.SENDER_LIMIT = "1";
  assert.equal((await h.tick()).deferred, "rate_limit");
  assert.equal(h.webhook.calls.length, 1);
  const scoped = scopedStorage(h.storage, h.env.STATE_NAMESPACE);
  assert.deepEqual(await scoped.get("rate:neo-codex"), await h.storage.get("rate:neo-codex"));
  assert.deepEqual(await h.storage.get("poll"), oldPoll);
});

test("the new relay can reply to an id already replied to on the old relay", async () => {
  const h = harness();
  const id = h.relay.deliver("neo-codex", "grok", "old message");
  await h.mcp("grok_inbox");
  assert.equal((await h.mcp("grok_reply", { reply_to_id: id, text: "old reply" })).structuredContent.outcome, "sent");
  h.env.STATE_NAMESPACE = "new-relay/channel/grok";
  h.relay.cids.clear();
  await h.mcp("grok_inbox");
  const result = await h.mcp("grok_reply", { reply_to_id: id, text: "new reply" });
  assert.equal(result.structuredContent.outcome, "sent");
  assert.notEqual(result.structuredContent.relay_id, 2);
  h.env.STATE_NAMESPACE = "";
  const original = (await h.mcp("grok_status", { ids: [id] })).structuredContent.messages[0];
  assert.equal(original.reply_attempts[0].relay_id, 2);
});
