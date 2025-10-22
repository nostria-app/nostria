# NIP-40 Event Expiration Implementation

## Overview

This document describes the implementation of NIP-40 (Event Expiration Timestamp) support in Nostria. According to NIP-40, events can include an `expiration` tag with a Unix timestamp (in seconds) indicating when the event should be considered expired and should no longer be stored or displayed.

## Specification Reference

NIP-40 defines:
- Events may include an `expiration` tag: `["expiration", "<unix-timestamp-in-seconds>"]`
- Clients SHOULD ignore events that have expired
- Relays SHOULD NOT send expired events to clients
- Relays MAY persist expired events but SHOULD drop them when published

## Implementation Details

### 1. Utility Functions (`utilities.service.ts`)

Three new utility methods were added to handle event expiration:

#### `isEventExpired(event: Event): boolean`
Checks if an event has expired based on its expiration tag.
- Returns `true` if the current time is >= expiration timestamp
- Returns `false` if no expiration tag exists or timestamp is invalid
- Handles malformed expiration tags gracefully

#### `getEventExpiration(event: Event): number | null`
Extracts the expiration timestamp from an event.
- Returns the expiration timestamp in seconds if valid
- Returns `null` if no expiration tag exists or timestamp is invalid

#### `filterExpiredEvents(events: Event[]): Event[]`
Filters an array of events, removing expired ones.
- Returns only non-expired events
- Useful for batch processing

### 2. Storage Layer (`storage.service.ts`)

The storage service now handles expired events at multiple points:

#### On Save (`saveEvent`)
- Checks if incoming event is expired before saving
- If expired, logs and returns without saving
- If event already exists in storage, deletes it
- Prevents expired events from persisting

#### On Retrieval
All read methods now check for and delete expired events:

- **`getEvent(id: string)`**: Checks single event, deletes if expired
- **`getEventById(id: string)`**: Same as above
- **`getEventsByKind(kind: number)`**: Filters array, deletes expired events
- **`getEventsByPubkey(pubkey: string | string[])`**: Filters array, deletes expired events
- **`getEventByPubkeyAndKind(...)`**: Uses filtered results from `getEventsByPubkeyAndKind`
- **`getEventsByPubkeyAndKind(...)`**: Filters array, deletes expired events
- **`getParameterizedReplaceableEvent(...)`**: Filters before sorting by `created_at`

### 3. Relay Layer (`relay.ts`)

The relay base class filters expired events as they arrive from relays:

#### In `subscribe()` method
- Checks each received event before processing
- Drops expired events immediately
- Logs dropped events for debugging

#### In `subscribeEose()` method
- Same expiration check as `subscribe()`
- Prevents expired events from reaching event handlers

#### In `get()` method
- Checks single event result before returning
- Returns `null` if event is expired

#### In `getMany()` method  
- Filters events in the `onevent` callback
- Only collects non-expired events
- Expired events are logged and dropped

### 4. Data Services

The data services (`data.service.ts` and `user-data.service.ts`) already benefit from:
- Storage layer filtering (when reading from database)
- Relay layer filtering (when fetching from relays)
- No additional changes needed as they use these filtered sources

## Benefits

1. **Automatic Cleanup**: Expired events are automatically deleted when encountered
2. **Prevents Stale Data**: Users never see expired content
3. **Storage Efficiency**: Database is cleaned as expired events are discovered
4. **Relay Protection**: Respects NIP-40 even when relays don't filter properly
5. **Multiple Layers**: Defense in depth with filtering at relay, storage, and retrieval layers

## Timestamp Format

All timestamps in Nostr (including expiration) are in **seconds** since Unix epoch, not milliseconds. This is consistent across:
- Event `created_at` field
- Expiration tag timestamp
- Filter `since` and `until` parameters

## Use Cases

NIP-40 expiration is useful for:
- **Temporary announcements**: Event details, time-limited news
- **Limited-time offers**: Sales, promotions, special deals
- **Ephemeral content**: Stories, temporary status updates
- **Time-sensitive data**: Market data, real-time updates

## Security Note

As stated in NIP-40: Events could be downloaded by third parties while they are publicly accessible on relays. Expiration should not be considered a security feature. Don't use expiring messages for sensitive conversations or data that must be permanently deleted.

## Testing

To test expiration handling:

1. Create an event with an expiration tag in the past:
   ```json
   {
     "tags": [["expiration", "1609459200"]]
   }
   ```

2. Verify the event is:
   - Not saved to local storage
   - Deleted if already in storage
   - Dropped when received from relays
   - Not displayed in the UI

3. Create an event with future expiration:
   ```json
   {
     "tags": [["expiration", "9999999999"]]
   }
   ```

4. Verify it behaves normally until expiration time passes.

## Performance Considerations

- Expiration checks are lightweight (single tag lookup + timestamp comparison)
- No performance impact on events without expiration tags
- Expired events are deleted opportunistically (on access) rather than via scheduled cleanup
- This approach avoids background tasks and reduces complexity

## Future Enhancements

Potential improvements:
- Optional background job to periodically scan and clean expired events
- Metrics/logging for expired event statistics
- User notification when posting events with past expiration (validation)
- Settings to configure expiration behavior
