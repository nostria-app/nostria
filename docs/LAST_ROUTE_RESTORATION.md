# Last Route Restoration Implementation

## Overview
The app now restores the last opened route when closing and reopening, providing a seamless user experience by returning users to where they left off.

## Implementation Details

### 1. Account Local State Service
Added `lastRoute` field to store the last visited route per account:

**Interface Update (`AccountLocalState`)**:
- Added `lastRoute?: string` field to track the last route for each account

**New Methods**:
- `getLastRoute(pubkey: string): string | undefined` - Retrieves the last route for an account
- `setLastRoute(pubkey: string, route: string | null | undefined): void` - Saves the last route for an account

### 2. Route Tracking (App Component)
Added router event subscription in the constructor to track navigation changes:

```typescript
// Track route changes to save last route for each account
this.router.events
  .pipe(filter(event => event instanceof NavigationEnd))
  .subscribe((event: NavigationEnd) => {
    const pubkey = this.accountState.pubkey();
    if (pubkey && event.urlAfterRedirects) {
      this.accountLocalState.setLastRoute(pubkey, event.urlAfterRedirects);
    }
  });
```

### 3. Route Restoration (App Component Constructor)
Added an Angular effect to restore the last route after the account is loaded and authenticated:

```typescript
// Track account changes to reset the restoration flag
let lastPubkey: string | undefined = undefined;
effect(() => {
  const pubkey = this.accountState.pubkey();
  if (pubkey !== lastPubkey) {
    lastPubkey = pubkey;
    this.hasRestoredRoute = false;
  }
});

// Effect to restore last route when account is loaded
effect(() => {
  const authenticated = this.app.authenticated();
  const initialized = this.app.initialized();
  const pubkey = this.accountState.pubkey();

  if (authenticated && initialized && pubkey && !this.hasRestoredRoute) {
    this.hasRestoredRoute = true;
    
    const currentUrl = this.router.url;
    const isRootOrFeeds = currentUrl === '/' || currentUrl.startsWith('/?') || currentUrl === '';
    
    if (isRootOrFeeds) {
      const lastRoute = this.accountLocalState.getLastRoute(pubkey);
      if (lastRoute && lastRoute !== '/' && lastRoute !== currentUrl) {
        setTimeout(() => {
          this.router.navigateByUrl(lastRoute);
        }, 100);
      }
    }
  }
}, { allowSignalWrites: true });
```

**Key Implementation Details**:
- Uses Angular's `effect()` to reactively respond to authentication/initialization state
- Includes a `hasRestoredRoute` flag to ensure restoration happens only once per session
- Resets the flag when the account changes to allow restoration for the new account
- Uses `setTimeout` to avoid navigation during Angular's change detection cycle
- Checks for deep links before restoring to prevent overriding push notifications

## Deep Link Protection
The restoration logic includes protection for deep links to ensure that:

1. **Push notifications** work correctly - if a user clicks a notification, they go directly to the intended content
2. **Shared links** work as expected - opening the app from a shared profile/event link navigates to that content
3. **Protocol handlers** are respected - `nostr:` protocol links navigate to the correct destination

The protection works by only restoring the last route when the current URL is the root path (`/`) or a query parameter variation (like `/?tab=something`). If the user is already on a specific route (like `/p/npub...` or `/e/note...`), the restoration is skipped.

## Storage
- Last routes are stored in localStorage under the key `nostria-state`
- Data is organized per account (pubkey)
- Persists across app sessions

## Benefits
1. **Seamless Experience**: Users return to exactly where they left off
2. **Per-Account Memory**: Each account maintains its own last route
3. **Deep Link Compatible**: Push notifications and shared links still work correctly
4. **Automatic**: No user action required - works transparently

## Example Scenarios

### Scenario 1: Normal App Usage
1. User browses to `/p/npub1abc...`
2. User closes the app
3. User reopens the app
4. Result: User is taken back to `/p/npub1abc...`

### Scenario 2: Push Notification
1. User is on `/messages`
2. User closes the app
3. User receives a push notification about a new follower
4. User taps notification (which has a deep link to `/p/npub1xyz...`)
5. Result: User is taken to `/p/npub1xyz...` (not `/messages`)

### Scenario 3: Shared Link
1. User has the app open on `/people`
2. User receives a shared link to an event via messaging app
3. User taps the link
4. Result: User is taken to the event (not `/people`)
