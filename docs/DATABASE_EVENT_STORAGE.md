# Database Event Storage for Summary Queries

This document describes the changes made to ensure profiles (kind 0), following lists (kind 3), and relay lists (kind 10002) are stored in the new `DatabaseService` events store, enabling the Summary page to query this data.

## Overview

The Summary page relies on the new `DatabaseService` to query recent activity from followed users. Previously, events were saved to the old `StorageService` but not always to the new `DatabaseService`. These changes ensure all relevant event kinds are saved to both storage systems.

## Event Kinds Stored

- **Kind 0 (Metadata/Profile)**: User profile information
- **Kind 1 (Notes)**: Short text notes
- **Kind 3 (Contacts/Following)**: Following list
- **Kind 6 (Reposts)**: Repost events
- **Kind 10000 (Mute List)**: Muted users/content
- **Kind 10002 (Relay List)**: Relay configuration
- **Kind 20 (Media)**: Media posts
- **Kind 30023 (Long-form Articles)**: Article content

## Files Modified

### `src/app/services/data.service.ts`

Added `saveEventToDatabase()` helper method and updated:
- `loadProfile()` - saves discovered profiles to DatabaseService
- `refreshProfileInBackground()` - saves refreshed profiles to DatabaseService  
- `getEventByPubkeyAndKindAndReplaceableEvent()` - saves events to DatabaseService
- `getEventByPubkeyAndKind()` - saves events to DatabaseService
- `getEventsByKindAndEventTag()` - saves events to DatabaseService

### `src/app/services/user-data.service.ts`

Added `saveEventToDatabase()` helper method and updated:
- `loadProfile()` - saves discovered profiles to DatabaseService
- `refreshProfileInBackground()` - saves refreshed profiles to DatabaseService
- `getEventById()` - saves events to DatabaseService
- `getEventByPubkeyAndKindAndReplaceableEvent()` - saves events to DatabaseService
- `getEventByPubkeyAndKind()` - saves events to DatabaseService
- `getEventsByPubkeyAndKindPaginated()` - saves events to DatabaseService
- `getEventsByKindAndEventTag()` - saves events to DatabaseService
- `getEventsByKindsAndEventTag()` - saves events to DatabaseService

### `src/app/services/nostr.service.ts`

Updated to save events to DatabaseService in:
- `getMetadataForUser()` - saves discovered metadata (kind 0) to DatabaseService
- Background metadata refresh - saves refreshed metadata to DatabaseService
- `loadAccountFollowing()` - saves following list (kind 3) to DatabaseService
- `loadAccountMuteList()` - saves mute list (kind 10000) to DatabaseService
- `discoverMetadataFromAccountRelays()` - saves relay list (kind 10002), following list (kind 3), and metadata (kind 0) to DatabaseService

### `src/app/services/profile.ts`

Updated `updateProfile()` to:
- Inject `DatabaseService`
- Save profile events (kind 0) to DatabaseService after publishing

## How It Works

1. **Event Fetch**: When an event is fetched from relays, it's saved to both:
   - `StorageService` (old idb-based storage)
   - `DatabaseService` (new raw IndexedDB storage)

2. **Summary Queries**: The Summary page uses `DatabaseService.getAllEventsByPubkeyKindSince()` to query events from both:
   - The main events store
   - The events cache store (for feed events)

3. **Deduplication**: The combined query method deduplicates events by ID to avoid counting events twice.

## Note

Events stored before these changes will only exist in `StorageService`. Only newly fetched events will appear in `DatabaseService`. Over time, as users browse and interact with the app, the `DatabaseService` will accumulate the necessary data for Summary queries to work properly.
