# Nostria auth.md

You are an agent. Nostria is a Nostr client. HTTP APIs authenticate with **NIP-98** (`Authorization: Nostr <base64-event>`), not OAuth bearer tokens. Public reads need no credentials.

Discovery documents at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` exist so agents can find this file and the NIP-98 skill. They do not issue OAuth access tokens.

## Audience

- **Public content** (profiles, posts, articles, music, NIP-05): no auth.
- **Account APIs** at `https://api.nostria.app/api/` (settings, backup, notifications, payments): NIP-98 signed by the user's Nostr key.

Users hold keys in the Nostria app (nsec, NIP-07 extension, or NIP-46 bunker). Agents acting for a user must use a key the user has authorized. Do not ask users to paste an nsec into chat.

## Step 1 — Discover

```http
GET https://nostria.app/.well-known/oauth-protected-resource
GET https://nostria.app/.well-known/oauth-authorization-server
GET https://nostria.app/.well-known/agent-skills/nostr-auth/SKILL.md
```

- `resource` is `https://api.nostria.app/`.
- `authorization_servers` lists `https://nostria.app`.
- `agent_auth.skill` points at this document.
- `agent_auth.register_uri` is `https://nostria.app/agent/auth`.

There is no agent account signup. Identity is the user's Nostr public key.

## Step 2 — Pick a method

1. **Public GET** (NIP-05, public account, MCP tools, this site) → no auth.
2. **User-authorized HTTP call to api.nostria.app** → [NIP-98](#nip-98-http-auth).
3. **OAuth ID-JAG / email claim** → not supported. `POST /agent/identity` returns `nip98_required`.

## Step 3 — Register

Do not POST an OAuth registration body expecting an `access_token`.

For NIP-98, "registration" is: the user already has a Nostr identity. Confirm with the user that your agent may sign HTTP auth events for `https://api.nostria.app` using a key they control (NIP-07 prompt, NIP-46 bunker, or a delegated key they created).

```http
GET https://nostria.app/agent/auth
```

## NIP-98 HTTP Auth

Sign a kind `27235` event and send it as `Authorization: Nostr <base64(json(event))>`.

Required tags:

- `u` — absolute URL of the request (no fragment)
- `method` — HTTP method uppercase (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`)

`created_at` is Unix **seconds**. Keep it within a few minutes of the server clock.

```json
{
  "kind": 27235,
  "created_at": 1700000000,
  "tags": [
    ["u", "https://api.nostria.app/api/account"],
    ["method", "GET"]
  ],
  "content": "",
  "pubkey": "<hex>",
  "id": "<hex>",
  "sig": "<hex>"
}
```

```http
GET https://api.nostria.app/api/account
Authorization: Nostr <base64-event>
```

OpenAPI: `https://api.nostria.app/openapi.json` (security scheme `NIP98Auth`).

## Public endpoints (no auth)

| Purpose | URL |
| --- | --- |
| NIP-05 lookup | `https://nostria.app/.well-known/nostr.json?name={name}` |
| Public account | `https://api.nostria.app/api/account/{pubkeyOrUsername}` |
| API health | `https://api.nostria.app/api/status/health` |
| MCP (JSON-RPC) | `POST https://nostria.app/mcp` |

## Canonical app URLs

- Profile: `https://nostria.app/p/{npub\|hex\|nprofile}`
- Username: `https://nostria.app/u/{name}`
- Post: `https://nostria.app/e/{note\|nevent\|hex}`
- Article: `https://nostria.app/a/{naddr}`

## Errors

Protected API calls without a valid NIP-98 header return `401`. Retry only after the user authorizes a new signed event. Do not fall back to password, email, or OAuth code flows against nostria.app — those endpoints explain NIP-98 and do not mint bearer tokens.
