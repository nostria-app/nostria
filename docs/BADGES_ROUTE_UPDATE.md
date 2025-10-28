# Badges Route Update

## Summary
Updated badges routing to support cleaner URLs with pubkey in the path while maintaining backwards compatibility with the legacy query parameter approach.

## Changes Made

### 1. Route Configuration (`app.routes.ts`)
Added badges route to the `profileChildren` array:
```typescript
{ path: 'badges', component: BadgesComponent, title: 'Badges' }
```

This enables the new URL structure:
- **New:** `/p/:npub/badges` (e.g., `/p/npub1abc.../badges`)
- **Legacy:** `/badges?pubkey=xxx` (still supported for backwards compatibility)

### 2. BadgesComponent Logic (`badges.component.ts`)
Updated the constructor to handle both routing approaches:

```typescript
// Get pubkey from route params (new: /p/:id/badges) or query params (legacy: /badges?pubkey=xxx)
let pubkeyParam = this.route.snapshot.queryParamMap.get('pubkey');
if (!pubkeyParam) {
  // Check if we're under a profile route (parent :id param)
  const parentId = this.route.parent?.snapshot.paramMap.get('id');
  if (parentId) {
    // Convert npub to hex if needed
    pubkeyParam = this.utilities.safeGetHexPubkey(parentId) || parentId;
  }
}
```

**Logic Flow:**
1. First checks for query parameter `pubkey` (legacy approach)
2. If not found, checks parent route's `:id` parameter (new approach)
3. Converts npub to hex format if needed using `safeGetHexPubkey()`
4. Falls back to current user's pubkey if neither is provided

## Benefits

### Cleaner URLs
The new path-based approach provides more intuitive URLs:
- Before: `https://nostria.space/badges?pubkey=82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2`
- After: `https://nostria.space/p/npub1...xyz/badges`

### Backwards Compatibility
Existing bookmarks and links using the query parameter approach continue to work without breaking.

### Consistency
Aligns with other profile-related routes:
- `/p/:npub/notes`
- `/p/:npub/reads`
- `/p/:npub/following`
- `/p/:npub/badges` ← New!

## Testing

Both URL formats should work correctly:
1. Navigate to your own badges: `/badges` or `/p/YOUR_NPUB/badges`
2. Navigate to another user's badges: `/badges?pubkey=THEIR_HEX` or `/p/THEIR_NPUB/badges`
3. Verify profile info displays at the top
4. Confirm all tabs (Accepted, Received, Given, Created) load correctly
5. Check that Edit/Issue buttons only appear for your own badges
