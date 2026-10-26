import { test } from "node:test";
import assert from "node:assert/strict";
import { guardRelay } from "../src/auth.js";
import { Adapter } from "../src/index.js";
import { tick } from "../src/core.js";
import { MemoryStorage, makeEnv } from "./helpers.js";

const cfg = { relay: "https://relay.test", channel: "ginkoai", handle: "ginkoai-grok", relayMode: "direct" };
const oldId = "approval-interrupted", newId = "approval-takeover";
const deferred = () => Promise.withResolvers();
function fixture() {
  const storage = new MemoryStorage();
  let calls = 0;
  const make = identity => guardRelay({
    peek: async () => ({ ok: false, status: 401 }),
    identity: async () => { calls++; return identity(); },
  }, { storage, cfg, now: () => 1234 + calls });
  const attempt = async id => [...(await storage.list({ prefix: "auth:" }))].find(([k]) => k.endsWith(`:recheck:${id}`))?.[1];
  return { storage, make, attempt, calls: () => calls };
}

test("interrupted checking survives restart and requires explicit exact-target supersession", async () => {
  const f = fixture();
  const first = f.make(() => { throw Error("fixture process interruption"); });
  await first.peek();
  await f.storage.put({ "send:accepted": { clientId: "accepted-001", outcome: "sent" },
    "send:uncertain": { clientId: "uncertain-001", outcome: "uncertain" }, "send-pending:claude": "uncertain-001" });
  await assert.rejects(first.recheck(oldId), /fixture process interruption/);
  const old = await f.attempt(oldId), before = structuredClone(f.storage.map);
  assert.equal(old.state, "checking");
  const restarted = f.make(() => ({ ok: true, status: 200 }));
  assert.equal((await restarted.recheck(newId)).error, "recheck_outcome_unknown");
  assert.equal((await restarted.recheck(newId, "approval-wrong-target")).error, "supersession_target_mismatch");
  assert.equal((await restarted.recheck(oldId, oldId)).error, "approval_already_used");
  assert.equal(f.calls(), 1);
  assert.deepEqual(f.storage.map, before);
  assert.equal((await restarted.recheck(newId, oldId)).ok, true);
  assert.equal(f.calls(), 2);
  const prior = await f.attempt(oldId);
  assert.equal(prior.state, "superseded");
  assert.equal(prior.at, old.at);
  assert.equal(prior.superseded_by, newId);
  assert.equal((await f.attempt(newId)).supersedes, oldId);
  assert.equal((await restarted.authState()).blocked, false);
  for (const [k, v] of before) if (!k.startsWith("auth:")) assert.deepEqual(await f.storage.get(k), v);
});

test("concurrent supersessions of one unfinished check claim only one new probe", async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  const broken = f.make(() => { throw Error("interrupted"); });
  await broken.peek(); await assert.rejects(broken.recheck(oldId));
  const make = () => f.make(async () => { entered.resolve(); await release.promise; return { ok: false, status: 401 }; });
  const first = make().recheck(newId, oldId);
  await entered.promise;
  const competing = await Promise.all([make().recheck("approval-competitor", oldId), make().recheck(newId, oldId)]);
  assert.deepEqual(competing.map(r => r.error), ["supersession_target_mismatch", "approval_already_used"]);
  assert.equal(f.calls(), 2);
  release.resolve();
  assert.equal((await first).ok, false);
  assert.equal((await make().authState()).blocked, true);
  assert.equal((await f.attempt(oldId)).superseded_by, newId);
  assert.equal(await f.attempt("approval-competitor"), undefined);
  assert.equal((await make().recheck(newId, oldId)).error, "approval_already_used");
  assert.equal(f.calls(), 2);
});

for (const replacementOk of [false, true]) {
  test(`late old ${replacementOk ? "failure cannot reblock a verified" : "success cannot unlock a failed"} replacement`, async () => {
    const f = fixture(), entered = deferred(), release = deferred();
    const original = f.make(async () => { entered.resolve(); return release.promise; });
    await original.peek();
    const pending = original.recheck(oldId);
    await entered.promise;
    const restarted = f.make(() => ({ ok: replacementOk, status: replacementOk ? 200 : 401 }));
    assert.equal((await restarted.recheck(newId, oldId)).ok, replacementOk);
    const state = await restarted.authState(), replacement = await f.attempt(newId);
    release.resolve({ ok: !replacementOk, status: replacementOk ? 401 : 200 });
    assert.equal((await pending).error, "recheck_superseded");
    assert.deepEqual(await restarted.authState(), state);
    assert.deepEqual(await f.attempt(newId), replacement);
    const old = await f.attempt(oldId);
    assert.equal(old.state, "superseded");
    assert.equal(old.late_result.state, replacementOk ? "failed" : "verified");
    assert.equal(f.calls(), 2);
  });
}

test("cron requires the explicit supersedes marker and never retries a failed takeover", async () => {
  const f = fixture(), broken = f.make(() => { throw Error("interrupted"); });
  await broken.peek(); await assert.rejects(broken.recheck(oldId));
  let requests = 0;
  const env = makeEnv({ CCIM_CHANNEL: cfg.channel, CCIM_HANDLE: cfg.handle, AUTH_RECHECK_APPROVAL: newId });
  const restart = () => new Adapter({ storage: f.storage }, env, { log() {}, fetch: async (url, init) => {
    requests++;
    assert.equal(url, "https://relay.test/c/ginkoai/who");
    assert.equal(init.method, "GET");
    return Response.json({ error: "unauthorized" }, { status: 401 });
  } });
  assert.equal((await tick(restart().ctx())).auth_recovery.error, "recheck_outcome_unknown");
  assert.equal(requests, 0);
  env.AUTH_RECHECK_SUPERSEDES = oldId;
  assert.equal((await tick(restart().ctx())).auth_recovery.ok, false);
  for (let i = 0; i < 5; i++) await tick(restart().ctx());
  assert.equal(requests, 1);
  assert.equal((await restart().ctx().relay.authState()).blocked, true);
});
