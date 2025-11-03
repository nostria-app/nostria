# Feed Cache Migration to IndexedDB

## Overview

This document describes the migration of feed event caching from localStorage to IndexedDB, implemented to provide better performance, scalability, and storage management.

## Motivation

The previous implementation stored cached feed events in localStorage with the following limitations:

1. **Limited Storage**: localStorage typically has a 5-10MB limit
2. **Performance**: Synchronous API blocked the main thread
3. **Small Cache Size**: Only 5 events per column were cached
4. **No Cleanup**: Cache could grow indefinitely across accounts
5. **JSON Serialization**: Overhead of parsing/stringifying large objects

## Implementation

### Database Schema

A new `eventsCache` table was added to the IndexedDB schema:

```typescript
interface CachedFeedEvent {
  id: string; // composite key: accountPubkey::columnId::eventId
  accountPubkey: string; // The pubkey of the account viewing this feed
  columnId: string; // The column ID this event belongs to
  eventId: string; // The event ID
  event: Event; // The actual event data
  cachedAt: number; // Timestamp when this was cached
}
```

**Indexes:**
- `by-account-column`: [accountPubkey, columnId] - for efficient column queries
- `by-cached-at`: cachedAt - for cleanup operations
- `by-account`: accountPubkey - for account-wide operations

### Key Features

#### 1. Increased Cache Size
- **Previous**: 5 events per column
- **New**: 200 events per column
- This provides better instant loading when opening the app

#### 2. Automatic Cleanup
- Background service runs every 5 minutes (starts after 5-minute delay)
- Maintains ~200 events per column across all accounts
- Prevents unbounded growth

#### 3. Async Operations
- Non-blocking cache loading using IndexedDB async API
- Better app responsiveness during initialization

#### 4. Account Isolation
- Each account's cache is independently managed
- Switching accounts doesn't affect other account caches

### Storage Service Methods

```typescript
// Save cached events (auto-limits to 200 per column)
await storage.saveCachedEvents(accountPubkey, columnId, events);

// Load cached events for a column
const events = await storage.loadCachedEvents(accountPubkey, columnId);

// Delete cached events for a specific column
await storage.deleteCachedEventsForColumn(accountPubkey, columnId);

// Delete all cached events for an account
await storage.deleteCachedEventsForAccount(accountPubkey);

// Manual cleanup (normally runs automatically)
await storage.cleanupCachedEvents();

// Get cache statistics
const stats = await storage.getCachedEventsStats();
```

### Feed Service Integration

The `FeedService` was updated to use the new async cache methods:

```typescript
// Load cache when subscribing to a column (async)
const cachedEvents = await this.loadCachedEvents(column.id);

// Save events to cache after fetching
await this.saveCachedEvents(column.id, events);
```

### Cache Cleanup Service

A dedicated `CacheCleanupService` manages periodic cleanup:

```typescript
@Injectable({ providedIn: 'root' })
export class CacheCleanupService {
  // Starts 5 minutes after app initialization
  start(): void

  // Stop the service
  stop(): void

  // Manual trigger (for testing)
  async triggerCleanup(): Promise<void>

  // Get service status
  getStatus(): { isRunning, lastCleanup, nextCleanup, totalCleanupsPerformed }
}
```

The service is automatically started in `app.ts` during initialization.

## Migration Process

### Automatic Migration

When users upgrade to the new version:

1. **Detection**: On app initialization, checks for `nostria-feed-cache` in localStorage
2. **Migration**: If found, migrates all cached events to IndexedDB
   - Structure: `{ pubkey: { columnId: Event[] } }` → IndexedDB records
   - Preserves all events from all accounts
3. **Cleanup**: Removes old localStorage data
4. **Flag**: Sets `nostria-feed-cache-migrated` flag to prevent re-running

### Migration Result

The migration returns detailed statistics:

```typescript
{
  success: boolean;
  migratedAccounts: number;
  migratedColumns: number;
  migratedEvents: number;
  errors: string[];
}
```

### Error Handling

- Non-blocking: App continues if migration fails
- Detailed logging: All errors are logged for debugging
- Graceful degradation: Falls back to empty cache if migration fails

## Performance Benefits

### Before (localStorage)
- **Read**: Synchronous, blocks main thread
- **Write**: Synchronous, blocks main thread
- **Cache Size**: 5 events per column
- **Storage Limit**: ~5-10MB total
- **Parse Overhead**: JSON.parse() on every read

### After (IndexedDB)
- **Read**: Async, non-blocking
- **Write**: Async, non-blocking
- **Cache Size**: 200 events per column
- **Storage Limit**: ~50MB+ (depends on browser)
- **Direct Access**: No JSON parsing overhead
- **Automatic Cleanup**: Prevents unbounded growth

## Event Types Cached

The cache stores all feed-relevant events including:
- Kind 1: Short text notes
- Kind 6: Reposts
- Kind 7: Reactions
- Kind 9735: Zap receipts
- Kind 30023: Long-form articles
- And any other kinds configured in feed columns

## Testing

### Manual Testing

```typescript
// Get cache statistics
const stats = await storage.getCachedEventsStats();
console.log('Cache stats:', stats);

// Trigger manual cleanup
await cacheCleanup.triggerCleanup();

// Check cleanup status
const status = cacheCleanup.getStatus();
console.log('Cleanup status:', status);
```

### Verification

1. Open DevTools → Application → IndexedDB → nostria → eventsCache
2. Verify records are structured correctly
3. Check indexes are created: `by-account-column`, `by-cached-at`, `by-account`
4. Verify cleanup runs after 5 minutes

## Rollback

If issues arise, the migration can be manually reversed:

```typescript
// In browser console:
localStorage.removeItem('nostria-feed-cache-migrated');
// Refresh the app - but old cache data is gone
```

**Note**: Original localStorage cache is deleted after successful migration, so rollback will result in empty cache.

## Database Version

The IndexedDB database version was incremented from 7 to 8 to accommodate the new `eventsCache` table.

## Future Improvements

Potential enhancements for future versions:

1. **Smart Caching**: Cache more events for frequently accessed columns
2. **Compression**: Compress cached events to save space
3. **Selective Caching**: Only cache specific event kinds
4. **TTL-based Cleanup**: Remove events older than X days
5. **Background Sync**: Pre-fetch and cache events in background
6. **Cache Warming**: Proactively cache likely-to-be-viewed content

## Related Files

### Core Implementation
- `src/app/services/storage.service.ts` - IndexedDB schema and cache methods
- `src/app/services/cache-cleanup.service.ts` - Background cleanup service
- `src/app/services/feed.service.ts` - Feed cache integration

### Integration
- `src/app/app.ts` - App initialization and migration trigger

### Types
- `CachedFeedEvent` - Interface for cached event records
- `NostriaDBSchema` - Updated database schema

## Support

For issues or questions about the feed cache migration:
1. Check browser console for error logs
2. Verify IndexedDB support in browser
3. Check available storage quota
4. Review migration logs in console

## Changelog

### Version 8 (Current)
- ✅ Migrated feed cache from localStorage to IndexedDB
- ✅ Increased cache size from 5 to 200 events per column
- ✅ Added automatic cleanup every 5 minutes
- ✅ Implemented one-time migration from localStorage
- ✅ Added cache statistics and monitoring
- ✅ Made all cache operations async and non-blocking
