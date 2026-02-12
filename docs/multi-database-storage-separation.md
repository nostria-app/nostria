# Multi-Database Storage Separation

## Overview

The `DatabaseService` has been refactored from a single IndexedDB database (`nostria-db`) to a dual-database architecture:

- **Shared DB** (`nostria-shared`): Universal data that doesn't depend on the logged-in account
- **Per-Account DB** (`nostria-account-{pubkeyHex}`): Data personalized to each account

## Motivation

- **WoT/Trust scores** are personalized per account — each user has their own view of trust
- **Feed cache events** are personalized per account — each user follows different people
- **Profiles, relay lists, badge definitions** are universal — they don't change based on who is viewing them

## Database Layout

### Shared DB (`nostria-shared`)
| Store | Description |
|-------|-------------|
| `events` | Shared event kinds: profiles (kind 0), contacts (kind 3), relay lists (kind 10002) |
| `relays` | Relay connection configuration |
| `observedRelays` | Relay performance statistics |
| `pubkeyRelayMappings` | Maps pubkeys to their known relays |
| `badgeDefinitions` | Badge definition events (kind 30009) |

### Per-Account DB (`nostria-account-{pubkey}`)
| Store | Description |
|-------|-------------|
| `events` | Non-shared event kinds (feed content, reactions, etc.) |
| `info` | Trust scores, WoT metrics, account-specific metadata |
| `notifications` | Per-account notifications |
| `eventsCache` | Feed event cache for infinite scrolling |
| `messages` | NIP-17 encrypted direct messages |

## Kind-Based Event Routing

Events are routed to the correct database automatically based on their kind:

```typescript
SHARED_EVENT_KINDS = new Set([0, 3, 10002]);
```

- `saveEvent(event)` routes to shared or account DB based on `event.kind`
- `getEventById(id)` checks account DB first (most lookups), then shared DB
- `deleteEvent(id)` tries both DBs since kind is unknown from just an ID

## API Surface

The external API of `DatabaseService` is **unchanged**. All 55+ consumers inject and use it the same way. The dual-DB routing is entirely internal.

### Key lifecycle methods (new)

| Method | Purpose |
|--------|---------|
| `init()` | Opens shared DB only (called at app startup) |
| `initAccount(pubkey)` | Opens per-account DB (called after account identified) |
| `initAnonymous()` | Sets up anonymous mode (no account DB) |
| `switchAccount(pubkey)` | Closes current account DB, opens new one |
| `deleteAccountData(pubkey)` | Deletes a specific account's database |

### Anonymous/Preview mode

When no account is logged in (`accountDb` is `null`), per-account methods gracefully return empty results:
- Read methods return `[]`, `0`, `undefined`, or `null`
- Write methods silently no-op

## Migration Strategy

**Start fresh**: On first launch with the new multi-DB architecture, the legacy `nostria-db` and `nostria` databases are deleted. All data is re-fetched from Nostr relays. This avoids complex data migration logic.

## Account Switching Flow

1. `AccountStateService.changeAccount(account)` is now async
2. It calls `database.switchAccount(pubkey)` or `database.initAnonymous()`
3. `switchAccount()` closes the previous account DB and opens the new one
4. All subsequent DB operations route to the new account's database

## App Initialization Flow

1. `app.ts ngOnInit()` → `database.init()` (opens shared DB)
2. Reads account pubkey from `localStorage`
3. If found: `database.initAccount(pubkey)` — opens account DB
4. If not found: `database.initAnonymous()` — anonymous mode
5. Later: `nostr.loadCachedData()` → `changeAccount(account)` → `database.switchAccount()` (re-opens same account DB, no-op)
