# Account Avatar Display Fix

## Problem
Profile images/avatars were not consistently showing up in the account switcher list in the profile sidenav. Most of the time, accounts would display the fallback icon instead of their actual profile picture. Additionally:
- The "last used" time showed full date/time instead of a user-friendly "ago" format
- Profile names were not displayed, only npub identifiers
- Writing to signals during template rendering caused NG0600 errors

## Root Cause
The issues were caused by several factors:

1. **Synchronous Profile Access**: The template used `getAccountProfileSync()` which only returned profiles that were already pre-loaded into the `accountProfiles` signal.

2. **Pre-loading Race Conditions**: The profile pre-loading mechanism in the effect could fail or complete after the template had already rendered, leaving the UI without profile data.

3. **No Fallback Mechanism**: When a profile wasn't pre-loaded, there was no fallback to check the cache or trigger a background load.

4. **Lack of Reactivity**: The template didn't properly track changes to the `accountProfiles` signal, so even when profiles were loaded later, the UI wouldn't update.

5. **Signal Writes During Render**: The original fix attempted to write to signals during template rendering, which Angular prohibits (NG0600 error).

6. **Poor UX**: Full timestamps instead of relative time, and missing profile names made the list harder to read.

## Solution
The fix involved several key improvements:

### 1. Enhanced `getAccountProfileSync` with Deferred Updates
**File**: `src/app/services/account-state.service.ts`

Added multi-tier fallback logic with deferred signal updates to avoid NG0600:
- First checks pre-loaded profiles in `accountProfiles` signal
- Falls back to cache if profile wasn't pre-loaded
- Uses `setTimeout` to defer signal updates to next tick (avoiding render-time writes)
- Triggers background loading if profile isn't found anywhere
- Returns undefined gracefully if profile isn't available yet

```typescript
getAccountProfileSync(pubkey: string): NostrRecord | undefined {
  // First check pre-loaded profiles
  const preloaded = this.accountProfiles().get(pubkey);
  if (preloaded) {
    return preloaded;
  }
  
  // Fallback to cache if not pre-loaded
  const cached = this.getCachedProfile(pubkey);
  if (cached) {
    // Schedule update for next tick to avoid writing during render
    setTimeout(() => {
      this.accountProfiles.update(profiles => {
        const newProfiles = new Map(profiles);
        newProfiles.set(pubkey, cached);
        return newProfiles;
      });
    }, 0);
    return cached;
  }
  
  // Trigger async load in background (deferred to next tick)
  setTimeout(() => this.loadAccountProfileInBackground(pubkey), 0);
  
  return undefined;
}
```

### 2. Background Profile Loading
**File**: `src/app/services/account-state.service.ts`

Added a new method to load profiles asynchronously in the background:
```typescript
private async loadAccountProfileInBackground(pubkey: string): Promise<void> {
  try {
    const profile = await this.loadAccountProfileInternal(pubkey);
    if (profile) {
      this.accountProfiles.update(profiles => {
        const newProfiles = new Map(profiles);
        newProfiles.set(pubkey, profile);
        return newProfiles;
      });
    }
  } catch (error) {
    console.warn('Failed to load account profile in background:', pubkey, error);
  }
}
```

### 3. Reactive Computed Signal in App Component
**File**: `src/app/app.ts`

Created a computed signal that combines accounts with their profiles and properly tracks the `accountProfiles` signal for reactivity:

```typescript
accountsWithProfiles = computed(() => {
  const accounts = this.accountState.accounts();
  const currentPubkey = this.accountState.account()?.pubkey;
  // Access accountProfiles to track reactivity when profiles are loaded
  void this.accountState.accountProfiles();
  
  return accounts
    .filter(account => account.pubkey !== currentPubkey)
    .map(account => ({
      account,
      profile: this.accountState.getAccountProfileSync(account.pubkey)
    }));
});
```

### 4. Improved Template with Better UX
**File**: `src/app/app.html`

Updated the template to:
- Use the new `accountsWithProfiles` computed signal
- Display profile names (display_name, name, or account.name) before falling back to npub
- Use the `ago` pipe for relative timestamps instead of full dates
- Convert JavaScript timestamps (milliseconds) to Nostr timestamps (seconds) for the ago pipe

```html
@for (item of accountsWithProfiles(); track item.account.pubkey) {
  @if (item.profile; as metadata) {
    <a mat-list-item (click)="switchAccount(item.account.pubkey); toggleProfileSidenav()" class="account-item">
      @if (metadata.data?.picture) {
        <div class="account-avatar" matListItemIcon>
          <img [src]="metadata.data.picture" alt="Profile picture" class="avatar-image" />
        </div>
      } @else {
        <div class="account-avatar" matListItemIcon>
          <mat-icon>account_circle</mat-icon>
        </div>
      }
      <span matListItemTitle>
        {{
        metadata.data?.display_name ||
        metadata.data?.name ||
        item.account.name ||
        (item.account.pubkey | npub)
        }}
      </span>
      <span matListItemLine class="account-source">
        {{ item.account.source }} - used {{ (item.account.lastUsed! / 1000) | ago }}
      </span>
    </a>
  } @else {
    <a mat-list-item (click)="switchAccount(item.account.pubkey); toggleProfileSidenav()" class="account-item">
      <div class="account-avatar" matListItemIcon>
        <mat-icon>account_circle</mat-icon>
      </div>
      <span matListItemTitle> {{ item.account.name || (item.account.pubkey | npub) }} </span>
      <span matListItemLine class="account-source">
        {{ item.account.source }} - used {{ (item.account.lastUsed! / 1000) | ago }}
      </span>
    </a>
  }
}
```

### 5. Added AgoPipe Import
**File**: `src/app/app.ts`

Imported and registered the `AgoPipe` for use in the template.

## Benefits

1. **Improved Reliability**: Profiles are now loaded from cache even if pre-loading fails
2. **Better User Experience**: 
   - Avatars appear immediately if data is cached
   - Profile names are displayed instead of just npub
   - Relative timestamps ("2 hours ago") instead of full dates
3. **Automatic Recovery**: Background loading ensures profiles eventually appear even if not immediately available
4. **Proper Reactivity**: UI updates automatically when profiles are loaded
5. **Performance**: Reduces duplicate calls by caching results in the signal
6. **No Runtime Errors**: Deferred signal updates prevent NG0600 errors

## Testing

To verify the fix works:
1. Add multiple accounts to your Nostria instance
2. Open the profile sidenav (click profile button in toolbar)
3. Verify that all accounts show:
   - Their profile pictures (not just icons)
   - Their profile names or account names (not just npub)
   - Relative timestamps like "2 hours ago" instead of "10/14/2025, 3:45 PM"
4. Switch between accounts and reopen the sidenav
5. Profile pictures and data should persist across sessions (cached)

## Related Files Modified

- `src/app/services/account-state.service.ts` - Enhanced profile loading logic with deferred updates
- `src/app/app.ts` - Added computed signal, helper method, and AgoPipe import
- `src/app/app.html` - Updated template to use new computed signal and display improvements
