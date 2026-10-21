// Run manually after the channel exists. Never prints a secret or member token.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function provision({ relay, channel, secret, output, request = fetch }) {
  const url = new URL(relay);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    throw new Error("HTTPS required");
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(channel)) throw new Error("Invalid channel");
  if (!secret) throw new Error("Missing channel secret");
  fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
  // Reserve the destination before making a request; do not overwrite an existing token.
  const fd = fs.openSync(output, "wx", 0o600);
  try {
    const response = await request(`${url.origin}/c/${channel}/join`, {
      method: "POST", headers: { "content-type": "application/json", "x-ccim-secret": secret },
      body: JSON.stringify({ handle: "grok", ifAbsent: true, mustExist: true }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (response.status !== 200 || typeof result.token !== "string" || !result.token)
      throw new Error("Member creation refused or unconfirmed");
    fs.writeFileSync(fd, result.token + "\n");
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [channel, output] = process.argv.slice(2);
    if (!channel || !output) throw new Error("Usage: node scripts/provision-grok.mjs CHANNEL TOKEN_FILE");
    const home = process.env.CCIM_HOME || path.join(os.homedir(), ".ccim");
    const config = JSON.parse(fs.readFileSync(path.join(home, "config.json"), "utf8"));
    await provision({ relay: process.env.CCIM_RELAY || config.relay, channel, secret: config.channels?.[channel]?.secret, output });
    console.log("Grok member created; token saved to the requested private file. No value printed.");
  } catch {
    console.error("Provisioning failed or uncertain. Stop; do not retry or rename the member. Inspect member status and the token file privately. No credential details printed.");
    process.exitCode = 1;
  }
}
