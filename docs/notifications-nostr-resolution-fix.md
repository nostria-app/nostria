# Fix: Resolved Nostr Identifiers in Notifications

## Problem
Notifications were displaying raw Nostr identifiers instead of readable names and content:
- `nostr:nprofile1qy88wumn8ghj...` instead of `@Username`
- `nostr:nevent1qvzqqqqqqypzp...` instead of `note:12345678...`

## Solution
Created a `resolveNostr` pipe that transforms Nostr identifiers into human-readable text.

### Before
```
SondreB reacted 👍 nostr:nprofile1qy88wumn8ghj7mn0wd68ytnrwp3k7mfsqy...
CR45H 0V3RR1D3 mentioned... nostr:nevent1qvzqqqqqqypzp0vhxgm9xqg...
```

### After  
```
SondreB reacted 👍 @Alice
CR45H 0V3RR1D3 mentioned... note:a1b2c3d4...
```

## How it Works

The `resolveNostr` pipe:
1. Detects `nostr:npub`, `nostr:nprofile`, `nostr:note`, and `nostr:nevent` identifiers in text
2. For profiles (npub/nprofile):
   - Checks the profile cache for display name
   - Returns `@DisplayName` if found
   - Falls back to `@npub1abc...` (truncated) if not cached
   - Triggers background loading for uncached profiles
3. For events (note/nevent):
   - Returns `note:12345678...` (truncated event ID)
   - Avoids showing full event cards which would break notification layout

## Files Modified
- `src/app/pipes/resolve-nostr.pipe.ts` - New pipe for resolving identifiers
- `src/app/pages/notifications/notifications.component.ts` - Import pipe
- `src/app/pages/notifications/notifications.component.html` - Use pipe on message display
- `src/app/pipes/resolve-nostr.pipe.spec.ts` - Unit tests

## Technical Details

### Why Not Use message-content Component?
The existing `message-content.component.ts` renders `nevent`/`note` as Material Card elements, which are block-level and would break the fixed-height notification item layout. The pipe approach keeps text inline and maintains the notification list performance.

### Non-Pure Pipe
The pipe is marked as `pure: false` because it depends on asynchronously loaded profile data. As profiles load in the background, the pipe will re-evaluate and update the display with actual names instead of truncated npubs.

### Performance
- First render: Shows truncated identifiers from cache or falls back to npub format
- Background: Triggers async profile loading for uncached profiles
- Subsequent renders: Shows full display names as profiles become available
- Uses DataService's caching layer to minimize relay requests

## Testing
Run the application and navigate to the notifications page to see resolved identifiers in action.
