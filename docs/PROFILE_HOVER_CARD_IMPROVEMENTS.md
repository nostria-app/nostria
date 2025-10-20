# Profile Hover Card Improvements

## Issues Fixed

### 1. Follow/Unfollow Button Icon Alignment

**Problem:** The icons in the Follow and Unfollow buttons were not properly aligned with the text.

**Cause:** The button content (icon and text) were wrapped in `ng-container` without proper flex layout styling.

**Solution:** Added flex layout styling to buttons in the `.actions` class:

```scss
button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  mat-icon {
    margin: 0;
  }
}
```

This ensures:
- Button content uses flexbox layout
- Items are vertically centered (`align-items: center`)
- Items are horizontally centered (`justify-content: center`)
- 8px gap between icon and text
- Icon margin is reset to prevent Material Design default spacing from misaligning

### 2. Mutual Following Not Showing

**Problem:** The "Also followed by" section was not showing for many profiles, even after visiting their profile pages and their following lists being loaded.

**Root Cause:** The `loadMutualFollowing()` method only checked local storage (`storage.getEventByPubkeyAndKind`) for the target user's kind 3 (following list) event. If the event wasn't cached locally, mutual follows would never display.

**Solution:** Updated `loadMutualFollowing()` to use `UserDataService` as a fallback, which fetches from relays if not in cache:

```typescript
// Try storage first (fast)
let targetFollowingEvent = await this.storage.getEventByPubkeyAndKind(pubkey, 3);

if (!targetFollowingEvent) {
  // Not in cache, fetch from relays
  const record = await this.userDataService.getEventByPubkeyAndKind(pubkey, 3);
  targetFollowingEvent = record?.event || null;
}
```

**Why This Works:**
- **First attempt:** Check local storage (instant if cached)
- **Fallback:** Fetch from Nostr relays via `UserDataService`
- **Result:** Mutual follows will now display even for profiles not previously cached

**Note:** There will be a slight delay when hovering over uncached profiles while the kind 3 event is fetched from relays, but this is preferable to never showing mutual follows at all.

## Files Modified

1. **profile-hover-card.component.scss**
   - Added flex layout styling for buttons

2. **profile-hover-card.component.ts**
   - Added `UserDataService` import and injection
   - Updated `loadMutualFollowing()` to fetch from relays as fallback

## Technical Details

### Service Differences

**StorageService.getEventByPubkeyAndKind:**
- Only checks IndexedDB cache
- Returns `Event | null`
- Fast but limited to cached data

**UserDataService.getEventByPubkeyAndKind:**
- Checks cache first, then queries relays
- Returns `NostrRecord | null` (contains `event` property)
- Slower but comprehensive

### NostrRecord Structure

```typescript
interface NostrRecord {
  event: Event;
  data: any; // Parsed content
}
```

When using `UserDataService`, we extract the event: `record?.event || null`

## User Experience Impact

**Before:**
- Button icons appeared slightly misaligned
- Mutual follows only shown if target's following list was already cached
- Many profiles would never show "Also followed by" section

**After:**
- Button icons perfectly aligned with text
- Mutual follows fetch from relays on-demand
- "Also followed by" displays for all profiles (with slight delay for uncached ones)

## Future Considerations

If performance becomes an issue with fetching kind 3 events on hover:
1. Could add a loading indicator for mutual follows section
2. Could pre-fetch kind 3 events when profile metadata is loaded
3. Could implement a background sync for frequently viewed profiles
