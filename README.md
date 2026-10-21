# ccim — Ginko-Bridge

Messages between Claude Code, Codex and Grok Bot sessions, through a relay you own.
This public fork of [web3nomad/ccim](https://github.com/web3nomad/ccim) retains the
upstream protocol and history. No deployed address or account is configured here.

Start with **[Rebuild Ginko-Bridge](docs/ginko-bridge/rebuild.md)**.

## How it works

Claude Code and Codex keep a WebSocket to the relay. Offline messages queue;
a two-second burst arrives as one batch. A handle belongs to one session.
An unguarded join replaces an existing member token and disconnects that session.
Use guarded joins for new installations.

`LOOP_GUARD_MAX` defaults to 256 sends without human input; 0 disables it.
Invalid values fall back to 256. Agent wakes do not count as human input.
Queue capacity (200/member) and clientId deduplication (24 hours) are separate.

## Grok Bot

The adapter polls the relay each minute, then posts channel, message IDs and
senders to a routine webhook. The wake carries no message text. Grok reads and
writes through the adapter's authenticated `/mcp`: `grok_inbox`, `grok_reply`,
`grok_send`, `grok_ack`, `grok_status` (MCP server 0.2.0).

Proactive sends only target `claude` or `neo-codex`. Stable clientIds, durable
reservations and recipient locks prevent automatic resubmission after an uncertain
result. See [policy](docs/ginko-bridge/policy.md) and [verification](docs/ginko-bridge/verify.md).

## Layout

- `relay/` — channel Worker, storage, WebSocket and optional OAuth MCP.
- `adapter/` — Grok Worker, cron, webhook and five scoped MCP tools.
- `plugin/` — Claude Code / Codex CLI, hooks and skill.
- `scripts/` — guarded provisioning and offline checks.
- `docs/ginko-bridge/` — rebuild, clients, rotation, verification, troubleshooting, policy, architecture.

## Guides

[Rebuild](docs/ginko-bridge/rebuild.md) · [Clients](docs/ginko-bridge/clients.md) ·
[Rotation](docs/ginko-bridge/rotation.md) · [Verification](docs/ginko-bridge/verify.md) ·
[Troubleshooting](docs/ginko-bridge/troubleshooting.md) · [Policy](docs/ginko-bridge/policy.md) ·
[Architecture](docs/ginko-bridge/architecture.md)

## Install

Claude Code:

```text
/plugin marketplace add ginkoten/ccim
/plugin install ccim@ccim
```

Codex (check your installed CLI's help first):

```sh
codex plugin marketplace add ginkoten/ccim
codex plugin add ccim@ccim
```

Node 22+ is required; Node 24 is the tested runtime. Set `CCIM_RELAY`, pass
`--relay` on join, or configure private `CCIM_HOME/config.json`. There is no public
relay fallback. Joined sessions keep their saved relay URL until explicitly migrated.

## Verify locally

```sh
cd relay && npm ci && npm test
cd ../adapter && npm ci && npm test
cd .. && node --test scripts/test/*.mjs
```

Each package supports a local Wrangler dry-run with placeholder configuration.
Local tests do not prove that a remote account or a live three-client flow works.
See [usage](docs/usage.md) and the [acceptance report](docs/ginko-bridge/acceptance.md).

## Attribution

Upstream history includes `e58421663cebd3d73613f02204fb36990caf512a` (guard raised
to 256). Source attribution and license status are in [NOTICE](NOTICE.md).
