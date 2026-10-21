# Grok adapter

A Worker polls the relay each minute and wakes a Grok routine. The routine uses
the authenticated `/mcp` endpoint to read, reply, send, acknowledge and inspect
messages. MCP server version: `0.2.0`.

Start with [the rebuild guide](../docs/ginko-bridge/rebuild.md). See
[client configuration](../docs/ginko-bridge/clients.md) and
[verification](../docs/ginko-bridge/verify.md) before using real messages.

Run `npm ci` then `npm test` with Node 22 or newer. The checked-in Wrangler file
contains placeholders. Copy it to ignored `wrangler.local.toml` for deployment.
Never copy production secrets into an example file.

`ALLOWED_RECIPIENTS` configures `grok_send` recipients as comma-separated member names.
Unset or empty-after-filtering lists default to `claude,neo-codex`; invalid names,
broadcast (`*`) and the configured `CCIM_HANDLE` are excluded, with duplicates removed.
Invalid entries produce a value-free diagnostic event. Tool descriptions and schemas
use the current request configuration; the five `grok_*` tool names stay stable.

`grok_send` must include `"hop": 0` for a new message (option B); continuations retain
the incoming hop and `source_message_id`. No adapter hop, send-frequency or daily
quota applies. A stable clientId prevents duplicate submission; an uncertain result
locks that recipient until operator reconciliation. No automatic unlock is exposed.

See [multi-project setup](../docs/ginko-bridge/multi-project.md) for separate channels,
adapter deployments, local homes and receiver proxy startup. Deployment requires
operator approval; successful local tests or dry-runs do not mean a Worker is live.

Source was imported from the locally maintained adapter, including its send tests;
the repository's acceptance report distinguishes local tests from real-client tests.
