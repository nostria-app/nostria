# Share Profile URL Fix

## Problem
The `shareProfileUrl` function in `layout.service.ts` was incorrectly reading the username from the current logged-in account instead of the username of the profile being viewed. This meant that when viewing another user's profile and clicking "Share > Profile URL", it would share the current user's username URL instead of the viewed profile's username URL.

## Solution
Modified the implementation to properly track and pass the viewed profile's username:

### Changes Made

1. **Profile Header Component** (`profile-header.component.ts`):
   - Added `profileUsername` signal to store the username of the profile being viewed
   - Updated `fetchPremiumStatus()` method to also fetch and store the username from the `PublicAccount` API response
   - The username is now properly tracked for both own profile (from account state) and other profiles (from API)

2. **Layout Service** (`layout.service.ts`):
   - Updated `shareProfileUrl()` function signature to accept an optional `username` parameter
   - Changed logic to use the passed username parameter instead of reading from current account state
   - Prioritizes username URL format when username is available, falls back to npub format otherwise

3. **Profile Header Template** (`profile-header.component.html`):
   - Updated the "Share > Profile URL" menu item to pass `this.profileUsername()` to the `shareProfileUrl()` function

## Behavior

### Before Fix
- When viewing any profile, clicking "Share > Profile URL" would generate a URL based on the **current logged-in user's** username
- Example: Viewing Alice's profile but sharing `https://nostria.app/u/bob` (current user's username)

### After Fix
- When viewing a profile, clicking "Share > Profile URL" generates a URL based on the **viewed profile's** username (if available)
- Example: Viewing Alice's profile shares `https://nostria.app/u/alice` (correct username)
- Falls back to npub format if the profile doesn't have a username: `https://nostria.app/p/npub1...`

## Technical Details

The fix leverages the existing premium status fetching mechanism which already queries the `PublicAccount` API endpoint. This endpoint returns both the `tier` (premium status) and `username` fields. By capturing and storing the username in a signal, the profile header component can now pass the correct username when sharing profile URLs.

The implementation maintains backward compatibility - if no username is provided, the function falls back to using the npub format for the URL.
