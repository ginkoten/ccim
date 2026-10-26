import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { MemoryStorage } from "../../adapter/test/helpers.js";
import { lifecycle, AUDIT_LIMIT } from "../src/lifecycle.js";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx,env){this.ctx=ctx;this.env=env;} }", shortCircuit: true };
  return next(specifier, context);
} });
const { default: worker, Channel } = await import("../src/index.js");
hooks.deregister();
const SECRET = "fixture-channel-secret-not-real";
function fixture() {
  const channels = new Map();
  const env = { CHANNEL: { idFromName: n => n, get: n => channels.get(n).channel } };
  for (const name of ["first", "second"]) {
    const storage = new MemoryStorage();
    globalThis.WebSocketRequestResponsePair = class {};
    const channel = new Channel({ storage, setWebSocketAutoResponse() {}, getWebSockets() { return []; } }, env);
    delete globalThis.WebSocketRequestResponsePair;
    channels.set(name, { channel, storage });
  }
  const call = async (op, { channel = "first", token, secret, body } = {}) => {
    const res = await worker.fetch(new Request(`https://relay.test/c/${channel}/${op}`, {
      method: body ? "POST" : "GET", headers: { ...(token && { authorization: `Bearer ${token}` }), ...(secret && { "x-ccim-secret": secret }) },
      ...(body && { body: JSON.stringify(body) }),
    }), env);
    return { status: res.status, body: await res.json() };
  };
  const join = (handle, extra = {}) => call("join", { secret: SECRET, body: { handle, ...extra } });
  return { call, join, channels };
}

test("journal differentiates join, replacement, leave and channel deletion without secrets", async () => {
  const f = fixture(), store = f.channels.get("first").storage;
  const first = await f.join("service"), oldToken = first.body.token;
  const second = await f.join("service"), token = second.body.token;
  assert.equal((await f.call("who", { token: oldToken })).status, 401);
  assert.equal((await f.call("who", { token })).body.you, "service");
  assert.equal((await f.call("leave", { token, body: {} })).status, 200);
  const next = await f.join("service");
  assert.equal((await f.call("delete", { secret: SECRET, body: {} })).status, 200);
  assert.equal((await f.call("who", { token: next.body.token })).status, 401);
  const events = await lifecycle(store);
  assert.deepEqual(events.map(e => e.action), ["join", "replace", "leave", "join", "remove", "delete"]);
  assert.deepEqual(events.map(e => e.generation), [1, 2, 2, 3, 3, null]);
  assert.deepEqual(events.map(e => e.sequence), [1, 2, 3, 4, 5, 6]);
  assert.equal(await store.get("channel"), undefined);
  assert.equal((await store.list({ prefix: "tok:" })).size, 0);
  for (const e of events) assert.deepEqual(Object.keys(e).sort(), ["sequence", "channel", "member", "action", "at", "generation", "reason"].sort());
  for (const secret of [SECRET, oldToken, token, next.body.token]) assert.ok(!JSON.stringify(events).includes(secret));
  const recreated = await f.join("service");
  assert.equal((await f.call("lifecycle", { token: recreated.body.token })).body.events.at(-1).generation, 4);
});

test("guarded provision refuses takeover and missing channel without any journal or identity mutation", async () => {
  const f = fixture(), store = f.channels.get("first").storage;
  assert.equal((await f.join("service", { ifAbsent: true, mustExist: true })).status, 404);
  assert.equal(store.map.size, 0);
  const token = (await f.join("service")).body.token;
  const before = structuredClone(store.map);
  assert.equal((await f.join("service", { ifAbsent: true, mustExist: true })).status, 409);
  assert.equal((await f.call("join", { secret: "wrong-secret", body: { handle: "other" } })).status, 403);
  assert.deepEqual(store.map, before);
  assert.equal((await f.call("who", { token })).status, 200);
});

test("lifecycle read requires the routed channel identity and changes no state", async () => {
  const f = fixture(), token = (await f.join("service")).body.token;
  const before = structuredClone(f.channels.get("first").storage.map);
  for (let i = 0; i < 3; i++) assert.equal((await f.call("lifecycle", { token })).body.events.length, 1);
  assert.equal((await f.call("lifecycle")).status, 401);
  assert.equal((await f.call("lifecycle", { channel: "second", token })).status, 401);
  assert.equal((await f.call("lifecycle?channel=second", { token })).body.events[0].channel, "first");
  assert.deepEqual(f.channels.get("first").storage.map, before);
  assert.equal(f.channels.get("second").storage.map.size, 0);
});

test("audit failure rolls back mutation; concurrent guarded joins cannot replace the winner", async () => {
  const f = fixture(), store = f.channels.get("first").storage;
  await f.join("owner");
  const original = store.put.bind(store), before = structuredClone(store.map);
  store.put = async (key, value) => { if (typeof key === "object" && key["audit:sequence"]) throw Error("fixture storage failure"); return original(key, value); };
  await assert.rejects(f.join("service"), /fixture storage failure/);
  assert.deepEqual(store.map, before);
  store.put = original;
  const results = await Promise.all([f.join("service", { ifAbsent: true, mustExist: true }), f.join("service", { ifAbsent: true, mustExist: true })]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal((await lifecycle(store)).length, 2);
});

test("bounded audit survives recreate and legacy generations are explicitly unknown", async () => {
  const f = fixture(), store = f.channels.get("first").storage;
  const token = (await f.join("service")).body.token;
  const member = await store.get("m:service");
  delete member.generation; await store.put("m:service", member);
  await f.call("leave", { token, body: {} });
  assert.equal((await lifecycle(store)).at(-1).generation, null);
  for (let i = 0; i < AUDIT_LIMIT + 2; i++) await f.join("service");
  const events = await lifecycle(store);
  assert.equal(events.length, AUDIT_LIMIT);
  assert.equal(events.at(-1).sequence - events[0].sequence, AUDIT_LIMIT - 1);
});
