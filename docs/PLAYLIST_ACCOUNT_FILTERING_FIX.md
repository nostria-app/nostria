# Playlist Account Filtering and Deduplication Fix

## Problem

The playlist editor was displaying playlists from other accounts, not just the current user's playlists. Additionally, duplicate playlists (older versions of replaceable events) were not being properly removed from storage.

## Root Cause

1. **Cross-Account Pollution**: When loading playlists from localStorage, the service loaded ALL stored playlists regardless of which account they belonged to. This caused playlists from previously logged-in accounts to appear in the current user's playlist list.

2. **Duplicate Entries**: Nostr replaceable events (kind 32100 for playlists) use a unique identifier based on `kind:pubkey:d-tag`. When the same playlist was updated and fetched multiple times, older versions were not being removed from storage, leading to duplicate entries.

## Solution

Added a `cleanupPlaylists()` method to the `PlaylistService` that:

1. **Filters by Account**: Removes all playlists that don't belong to the current user (keeping only playlists where `pubkey` matches the current user or `isLocal` is true for draft playlists)

2. **Deduplicates by Replaceable Event ID**: For each unique `kind:pubkey:d-tag` combination, keeps only the newest version (based on `created_at` timestamp)

3. **Reactive Cleanup**: Executes automatically when:
   - The service initializes
   - The user switches accounts (using an effect that watches `app.accountState.pubkey()`)

## Implementation Details

### New Method: `cleanupPlaylists()`

```typescript
private cleanupPlaylists(): void {
  const currentPubkey = this.getCurrentUserPubkey();
  if (!currentPubkey) {
    console.warn('No current user pubkey available for playlist cleanup');
    return;
  }

  const playlists = this._playlists();
  
  // Step 1: Filter out playlists from other accounts
  const filteredPlaylists = playlists.filter(playlist => 
    playlist.isLocal || playlist.pubkey === currentPubkey
  );

  // Step 2: Remove duplicates based on kind:pubkey:dtag
  const playlistMap = new Map<string, Playlist>();
  for (const playlist of filteredPlaylists) {
    const key = `${playlist.pubkey}:${playlist.id}`;
    const existing = playlistMap.get(key);
    if (!existing || playlist.created_at > existing.created_at) {
      playlistMap.set(key, playlist);
    }
  }

  const cleanedPlaylists = Array.from(playlistMap.values());

  // Update state if anything changed
  if (cleanedPlaylists.length !== playlists.length) {
    this._playlists.set(cleanedPlaylists);
    this.savePlaylistsToStorage();
  }
}
```

### Integration Points

1. **Initialization**: Called in `initialize()` after loading from storage
2. **Account Change Effect**: Watches for pubkey changes and cleans up automatically

```typescript
constructor() {
  // ... existing code ...

  // Clean up playlists when account changes
  effect(() => {
    const pubkey = this.app.accountState.pubkey();
    if (pubkey) {
      this.cleanupPlaylists();
    }
  });
}
```

## Testing Recommendations

1. Log in with Account A, create/fetch playlists
2. Log out and log in with Account B
3. Verify that only Account B's playlists are visible
4. Fetch the same playlist multiple times (causing updates)
5. Verify that only the newest version is kept

## Benefits

- ✅ Users only see their own playlists
- ✅ No duplicate playlists from replaceable events
- ✅ Automatic cleanup on account switching
- ✅ Reduced storage usage by removing old/irrelevant data
- ✅ Improved performance with fewer playlists to process
