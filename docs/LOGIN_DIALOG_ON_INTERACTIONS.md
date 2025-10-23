# Login Dialog on Interactions

## Overview

Enhanced user interaction flow by showing the login/create account dialog when users attempt to interact with content (Like, Zap, Reply, or Repost) without an active account.

## Changes Made

### 1. Event Component - Like Button (`event.component.ts`)

Updated the `toggleLike` method to check for an active account before processing the like action:

- **Before**: The method would silently return if no user was logged in
- **After**: Shows the login dialog when there's no active account, prompting users to sign in or create an account

```typescript
async toggleLike(event?: MouseEvent) {
  // ... existing code ...
  
  const userPubkey = this.accountState.pubkey();
  if (!userPubkey) {
    // Show login dialog if no account is active
    await this.layout.showLoginDialog();
    return;
  }
  
  // ... rest of the method ...
}
```

### 2. Reply Button Component (`reply-button.component.ts`)

Added authentication check to the `onClick` method:

- **Imports Added**:
  - `AccountStateService` - to check for active account
  - `LayoutService` - to show the login dialog

- **Changes**:
  - Modified method signature from `onClick()` to `async onClick()` to support async dialog display
  - Added check for active account before creating a reply
  - Shows login dialog if no account is active

```typescript
async onClick(event?: MouseEvent): Promise<void> {
  // ... existing code ...
  
  const userPubkey = this.accountState.pubkey();
  if (!userPubkey) {
    await this.layout.showLoginDialog();
    return;
  }
  
  // ... rest of the method ...
}
```

### 3. Repost Button Component (`repost-button.component.ts`)

Added authentication checks to all interaction methods:

- **Imports Added**:
  - `LayoutService` - to show the login dialog

- **Changes**:
  - Updated `createRepost()` method to check for active account
  - Updated `deleteRepost()` method to check for active account
  - Updated `createQuote()` method to check for active account
  - Shows login dialog if no account is active for any of these actions
  - Removed unused `kinds` import

### 4. Zap Button Component (`zap-button.component.ts`)

Added authentication check to the zap click handler:

- **Imports Added**:
  - `AccountStateService` - to check for active account
  - `LayoutService` - to show the login dialog

- **Changes**:
  - Injected `AccountStateService` and `LayoutService`
  - Added check at the beginning of `onZapClick()` method
  - Shows login dialog before processing the zap if no account is active

```typescript
async onZapClick(event: MouseEvent): Promise<void> {
  event.stopPropagation();
  
  const userPubkey = this.accountState.pubkey();
  if (!userPubkey) {
    await this.layout.showLoginDialog();
    return;
  }
  
  // ... rest of the method ...
}
```

## User Experience

### Before
- Clicking Like, Zap, Reply, or Repost with no active account would do nothing
- No feedback to the user about why the action didn't work
- Users might not realize they need to be logged in

### After
- Clicking any of these buttons without an active account opens the login dialog
- Clear call-to-action for users to either:
  - Create a new account
  - Sign in with an existing account
- Seamless workflow - after logging in, users can immediately interact with content

## Technical Details

- All authentication checks use `accountState.pubkey()` to determine if a user is logged in
- The `layout.showLoginDialog()` method is used consistently across all components
- The login dialog is awaited to ensure proper async handling
- After showing the dialog, methods return early to prevent processing without authentication

## Testing Recommendations

1. **Without Active Account**:
   - Click Like button → Login dialog should appear
   - Click Zap button → Login dialog should appear
   - Click Reply button → Login dialog should appear
   - Click Repost button → Login dialog should appear
   - Click Quote button → Login dialog should appear

2. **With Active Account**:
   - All buttons should function normally without showing login dialog
   - Actions should complete successfully

3. **After Logging In**:
   - Verify buttons become functional
   - Test all interaction types work correctly

## Files Modified

1. `src/app/components/event/event.component.ts`
2. `src/app/components/event/reply-button/reply-button.component.ts`
3. `src/app/components/event/repost-button/repost-button.component.ts`
4. `src/app/components/zap-button/zap-button.component.ts`

## Related Services

- **AccountStateService**: Provides `pubkey()` to check authentication status
- **LayoutService**: Provides `showLoginDialog()` to display the login/create account dialog
