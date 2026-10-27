import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./helpers.js";
import { config } from "../src/util.js";

async function list(h) {
  const response = await h.adapter.fetch(new Request("https://worker.test/mcp", {
    method: "POST", headers: { authorization: `Bearer ${h.env.MCP_BEARER}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }));
  return (await response.json()).result.tools;
}

const args = (to) => ({ to, text: "authorized task", clientId: `test-${to}-001`, hop: 0 });

test("default recipient schema and enforcement preserve workstation behavior", async () => {
  const h = harness();
  assert.deepEqual((await list(h))[0].inputSchema.properties.to.enum, ["claude", "neo-codex"]);
  for (const to of ["claude", "neo-codex"]) assert.equal((await h.mcp("grok_send", args(to))).structuredContent.outcome, "sent");
  assert.equal((await h.mcp("grok_send", args("codex"))).structuredContent.reason, "recipient_not_allowed");
});

test("project schema and runtime use only configured recipients on every request", async () => {
  const h = harness({ ALLOWED_RECIPIENTS: "codex,claude" });
  h.relay.members.push("codex");
  h.relay.queues.set("codex", new Map());
  const tools = await list(h);
  assert.deepEqual(tools[0].inputSchema.properties.to.enum, ["codex", "claude"]);
  assert.ok(tools.every((t) => !t.description.includes("neo-codex")));
  for (const to of ["codex", "claude"]) assert.equal((await h.mcp("grok_send", args(to))).structuredContent.outcome, "sent");
  assert.equal((await h.mcp("grok_send", args("neo-codex"))).structuredContent.reason, "recipient_not_allowed");
  h.env.ALLOWED_RECIPIENTS = "claude";
  assert.deepEqual((await list(h))[0].inputSchema.properties.to.enum, ["claude"]);
  assert.equal((await h.mcp("grok_send", args("codex"))).structuredContent.reason, "recipient_not_allowed");
});

test("recipient parsing trims, deduplicates and excludes invalid names, broadcast and self without logging values", () => {
  const logs = [];
  const original = console.log;
  console.log = (line) => logs.push(line);
  try {
    const cfg = config({ CCIM_HANDLE: "grok", ALLOWED_RECIPIENTS: " codex,claude,codex,*,grok,UPPER,bad/name,test-secret-invalid!" });
    assert.deepEqual(cfg.allowedRecipients, ["codex", "claude"]);
    assert.deepEqual(logs, [JSON.stringify({ event: "invalid_allowed_recipients_ignored" })]);
    for (const value of ["", " , ", "*,grok,INVALID"]) assert.deepEqual(config({ ALLOWED_RECIPIENTS: value }).allowedRecipients, ["claude", "neo-codex"]);
    assert.deepEqual(config({ CCIM_HANDLE: "claude", ALLOWED_RECIPIENTS: "claude" }).allowedRecipients, ["neo-codex"]);
    assert.deepEqual(config({ ALLOWED_RECIPIENTS: `a,${"a".repeat(32)},${"a".repeat(33)},a_b-c` }).allowedRecipients, ["a", "a".repeat(32), "a_b-c"]);
  } finally { console.log = original; }
});

test("custom member appears in tool descriptions and both proactive tag forms", async () => {
  const h = harness({ CCIM_HANDLE: "bridge-bot", ALLOWED_RECIPIENTS: "claude,codex,bridge-bot" });
  const tools = await list(h);
  for (const name of ["grok_send", "grok_inbox", "grok_reply", "grok_ack"]) assert.match(tools.find((t) => t.name === name).description, /bridge-bot/);
  assert.equal((await h.mcp("grok_send", args("bridge-bot"))).structuredContent.reason, "recipient_not_allowed");
  await h.mcp("grok_send", args("claude"));
  assert.match([...h.relay.queues.get("claude").values()][0].text, /from=bridge-bot hop=1/);
  const id = h.relay.deliver("claude", "grok", "continue [hop:9]");
  await h.mcp("grok_send", { ...args("claude"), clientId: "continue-001", source_message_id: id });
  assert.match([...h.relay.queues.get("claude").values()][1].text, new RegExp(`from=bridge-bot hop=10 re=#${id}`));
});

test("option B keeps hop mandatory for both project configurations", async () => {
  for (const env of [{}, { ALLOWED_RECIPIENTS: "codex,claude" }]) {
    const h = harness(env);
    const { hop, ...withoutHop } = args("claude");
    assert.equal((await h.mcp("grok_send", withoutHop)).structuredContent.reason, "invalid_hop");
    const send = (await list(h))[0];
    assert.ok(send.inputSchema.required.includes("hop"));
    assert.match(send.description, /"hop": 0/);
    assert.equal(send.inputSchema.properties.hop.maximum, undefined);
    assert.equal((await h.mcp("grok_send", { ...withoutHop, hop: 10000 })).structuredContent.hop, 10001);
  }
});
