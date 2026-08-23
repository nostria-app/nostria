---
name: nostria-mcp
description: Call the public Nostria MCP server over Streamable HTTP. Use for NIP-05 lookup, public accounts, and canonical URL helpers.
---

# Nostria MCP

- Card: `https://nostria.app/.well-known/mcp/server-card.json`
- Endpoint: `POST https://nostria.app/mcp`
- Auth: none
- Protocol: MCP Streamable HTTP, JSON-RPC 2.0, protocol version `2025-06-18`

## Handshake

`initialize` → `notifications/initialized` → `tools/list` / `tools/call`.

## Tools

- `resolve_nip05` — `{ "name": "alice" }` → pubkey map from NIP-05
- `get_public_account` — `{ "id": "alice" }` or a hex pubkey
- `canonical_url` — `{ "identifier": "npub1..." }` → https://nostria.app/...

These tools only expose public data. They cannot post, follow, zap, or read DMs.
