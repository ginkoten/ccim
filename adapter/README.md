# Grok adapter

A Worker polls the relay each minute and wakes a Grok routine. The routine uses
the authenticated `/mcp` endpoint to read, reply, send, acknowledge and inspect
messages. MCP server version: `0.2.0`.

Start with [the rebuild guide](../docs/ginko-bridge/rebuild.md). See
[client configuration](../docs/ginko-bridge/clients.md) and
[verification](../docs/ginko-bridge/verify.md) before using real messages.

Run `npm ci` then `npm test` with Node 24.5 or newer. The checked-in Wrangler file
contains placeholders. Copy it to ignored `wrangler.local.toml` for deployment.
Never copy production secrets into an example file.

`grok_send` only targets `claude` and `neo-codex`. Defaults are ten attempts per
recipient per ten minutes and 100 per recipient per day (UTC+8). Wake limits are
independent. A stable clientId prevents duplicate submission; an uncertain result
locks that recipient until operator reconciliation. No automatic unlock is exposed.

Source was imported from the locally maintained adapter, including its send tests;
the repository's acceptance report distinguishes local tests from real-client tests.
