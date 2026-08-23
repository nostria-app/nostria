---
name: nostria-urls
description: Canonical Nostria URL patterns for profiles, posts, articles, search, and NIP-05 names. Use when linking to Nostria content.
---

# Nostria URLs

Base: `https://nostria.app`

| Thing | Path |
| --- | --- |
| Profile | `/p/{npub}` or `/p/{hex}` or `/p/{nprofile}` |
| NIP-05 username | `/u/{name}` (resolves via `/.well-known/nostr.json?name={name}`) |
| Post | `/e/{note}` or `/e/{nevent}` or `/e/{hex}` |
| Article | `/a/{naddr}` |
| Search | `/search?q={query}` |
| Discover | `/discover` |
| Music | `/music` |
| Podcasts | `/podcasts` |
| Live stream | `/stream/{encodedEvent}` |

Query `https://nostria.app/.well-known/nostr.json?name={name}` for NIP-05. Names `support`, `premium`, `curator`, `payment`, and `_` are reserved.

Do not send users to `/messages`, `/wallet`, `/settings`, or `/credentials` unless they are already signed in.
