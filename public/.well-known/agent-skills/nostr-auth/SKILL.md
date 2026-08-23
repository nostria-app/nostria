---
name: nostr-auth
description: Authenticate to Nostria HTTP APIs with NIP-98. Use when calling api.nostria.app or signing Nostr HTTP auth events.
---

# Nostria Nostr HTTP Auth

Nostria account APIs at `https://api.nostria.app/api/` require [NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md). Public GETs (NIP-05, public account, MCP) do not.

## Sign the request

Create a kind `27235` event:

- `created_at`: Unix seconds, close to now
- tag `u`: absolute request URL with scheme, host, path, and query (no fragment)
- tag `method`: `GET` | `POST` | `PUT` | `PATCH` | `DELETE`
- `content`: empty string unless the API says otherwise
- Sign with the user's key (NIP-07, NIP-46, or a delegated key they control)

Send:

```
Authorization: Nostr <base64(utf8 JSON of the signed event)>
```

Do not put nsec values in logs, URLs, or chat. Prefer an in-browser NIP-07 prompt or a bunker.

## Public vs protected

- Public: `https://nostria.app/.well-known/nostr.json?name=`, `https://api.nostria.app/api/account/{id}`
- Protected: settings, backup, notifications, payments — same host, NIP-98 required

Full agent instructions: https://nostria.app/auth.md
