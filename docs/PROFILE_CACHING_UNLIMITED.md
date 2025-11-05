# Unlimited Profile Caching for Following Lists

## Summary

Removed cache size limits for followed user profiles to ensure all profiles from a user's following list remain in memory for tagging in Notes, DMs, and other features.

## Problem

Previously, the cache service had a default `maxSize` of 200 entries. When a user followed more than 200 people, the Least Recently Used (LRU) eviction policy would remove older profiles from the cache, making them unavailable for user mentions and tagging features.

## Solution

### 1. Increased Default Cache Size
**File**: `src/app/services/cache.ts`

Changed the default cache size from 200 to 10,000 entries to accommodate large following lists:

```typescript
private readonly defaultOptions: Required<CacheOptions> = {
  maxSize: 10000, // Increased from 200 to support large following lists
  ttl: 5 * 60 * 1000, // 5 minutes
  persistent: false,
};
```

### 2. Made Following Profiles Persistent
**File**: `src/app/services/account-state.service.ts`

Updated `addToCache()` and `addToAccounts()` methods to use persistent cache options for followed profiles:

```typescript
// Add to cache with persistent options (no expiration, no size limit eviction)
// Following profiles should stay in cache for the entire session
this.cache.set(cacheKey, profile, {
  persistent: true,
  maxSize: Infinity, // No limit for followed profiles
});
```

## How It Works

### Profile Loading Flow

1. **Account Switch**: When a user switches accounts, the `followingList` signal updates with the new account's contact list
2. **Effect Trigger**: The effect in `application.service.ts` detects the change
3. **Profile Processing**: 
   - First time: Calls `startProfileProcessing()` to fetch all profiles from relays
   - Subsequent times: Calls `loadProfilesFromStorageToCache()` to load from IndexedDB
4. **Cache Storage**: Each profile is added to cache with:
   - `persistent: true` - Never expires based on time
   - `maxSize: Infinity` - Never evicted due to cache size limits

### Cache Behavior

- **Persistent Profiles**: Following list profiles never expire and are never evicted
- **Other Profiles**: Other cached data (non-following) still uses the 10,000 entry limit with 5-minute TTL
- **Session-Based**: Cache is cleared when the app restarts, but persists for the entire session

## Benefits

1. **Complete Following List**: All followed user profiles remain in cache, regardless of list size
2. **Fast Mentions**: User tagging in Notes, DMs, and other features has instant access to all profiles
3. **No Re-fetching**: Once loaded, profiles don't need to be re-fetched during the session
4. **Smart Updates**: Newer profile versions automatically replace older cached versions

## Technical Details

### Cache Entry Structure

```typescript
interface CacheEntry<T> {
  value: T;
  timestamp: number;
  expiresAt: number | null; // null for persistent entries
  lastAccessed: number;
}
```

### Profile Cache Key Format

```typescript
const cacheKey = `metadata-${pubkey}`;
```

### Eviction Prevention

When `maxSize: Infinity` is passed:
```typescript
if (this.cache.size >= config.maxSize && !this.cache.has(key)) {
  this.evictLeastRecentlyUsed();
}
```
This condition never triggers because `this.cache.size >= Infinity` is always false.

## Performance Considerations

- **Memory Usage**: Following lists with thousands of users will consume more memory, but this is acceptable for desktop/mobile apps
- **Initial Load Time**: First-time profile loading may take longer for large following lists, but this only happens once per session
- **Background Loading**: Subsequent account switches load from IndexedDB, which is much faster

## Testing Recommendations

1. Test with accounts following 500+ users
2. Verify all profiles are available for mention/tagging features
3. Check memory usage with very large following lists (2000+ users)
4. Confirm profiles persist throughout the session
5. Verify cache clears properly on app restart
