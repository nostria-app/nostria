# Fix for Duplicate Discovery Relay Issue

## Problem Description

Nostria was creating duplicate Discovery Relay entries during auto-setup - one with a trailing slash (`/`) and one without. This occurred when users signed up with their own key and had no relay list defined.

### Example Issue
- User brings their own key with no relays
- System adds: `wss://discovery.eu.nostria.app`
- Later, another process adds: `wss://discovery.eu.nostria.app/`
- Result: Two entries for the same relay

## Root Causes

### 1. Inconsistent URL Format Across Codebase

Different parts of the codebase used different URL formats:

- **discovery-relay.ts**: `DEFAULT_BOOTSTRAP_RELAYS = ['wss://discovery.eu.nostria.app/']` ✅ (with `/`)
- **region.service.ts**: `return 'wss://discovery.${regionId}.nostria.app/'` ✅ (with `/`)
- **relays.component.ts**: `knownDiscoveryRelays = ['wss://discovery.eu.nostria.app']` ❌ (without `/`)
- **feed.service.ts**: `{ url: 'wss://discovery.eu.nostria.app' }` ❌ (without `/`)

### 2. Simple String Comparison Instead of Normalized Comparison

When checking if a discovery relay already exists, the code used simple string comparison:

```typescript
if (this.discoveryRelay.getRelayUrls().includes(discoveryRelayUrl)) {
  // Skip adding
}
```

This fails when one URL has a trailing slash and the other doesn't, even though they refer to the same relay.

## Solution

### 1. Standardize URL Format

Added trailing slashes to all discovery relay URLs in `relays.component.ts`:

```typescript
knownDiscoveryRelays = [
  'wss://discovery.eu.nostria.app/',    // Added trailing slash
  'wss://discovery.us.nostria.app/',    // Added trailing slash
];

nostriaRelayRegions = [
  { id: 'eu', name: 'Europe', discoveryRelay: 'wss://discovery.eu.nostria.app/' },
  { id: 'us', name: 'North America', discoveryRelay: 'wss://discovery.us.nostria.app/' },
];
```

Fixed `feed.service.ts`:
```typescript
const defaultDiscoveryRelays: RelayConfig[] = [
  { url: 'wss://discovery.eu.nostria.app/', read: true, write: false },
];
```

### 2. Use Normalized URL Comparison

Updated all discovery relay existence checks to use normalized URL comparison via `utilities.normalizeRelayUrl()`:

#### In `setupNostriaRelays()`:
```typescript
const normalizedDiscoveryUrl = this.utilities.normalizeRelayUrl(discoveryRelayUrl);
const existingDiscoveryRelays = this.discoveryRelay.getRelayUrls().map(url => 
  this.utilities.normalizeRelayUrl(url)
);

if (hadZeroRelays && !existingDiscoveryRelays.includes(normalizedDiscoveryUrl)) {
  // Add the relay
}
```

#### In `addDiscoveryRelay()`:
```typescript
const normalizedUrl = this.utilities.normalizeRelayUrl(url);
const existingDiscoveryRelays = this.discoveryRelay.getRelayUrls().map(relayUrl => 
  this.utilities.normalizeRelayUrl(relayUrl)
);

if (existingDiscoveryRelays.includes(normalizedUrl)) {
  this.showMessage('This Discovery Relay is already in your list');
  return;
}
```

#### In `findClosestRelay()`:
```typescript
const existingDiscoveryRelays = this.discoveryRelay.getRelayUrls().map(url => 
  this.utilities.normalizeRelayUrl(url)
);

const successfulPings = pingResults.map((result, index) => {
  const normalizedUrl = this.utilities.normalizeRelayUrl(relaysToCheck[index]);
  return {
    url: relaysToCheck[index],
    pingTime: result.status === 'fulfilled' ? result.value : Infinity,
    isAlreadyAdded: existingDiscoveryRelays.includes(normalizedUrl),
  };
});
```

## How URL Normalization Works

The `normalizeRelayUrl()` function in `utilities.service.ts` ensures consistent URL format:

```typescript
normalizeRelayUrl(url: string): string {
  try {
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      return '';
    }

    const parsedUrl = new URL(url);

    // If the URL has no pathname (or just '/'), ensure it ends with a slash
    if (parsedUrl.pathname === '' || parsedUrl.pathname === '/') {
      return url.endsWith('/') ? url : `${url}/`;
    }

    // URL already has a path, return as is
    return url;
  } catch (error) {
    return '';
  }
}
```

This function:
- Adds trailing slash to root URLs: `wss://discovery.eu.nostria.app` → `wss://discovery.eu.nostria.app/`
- Leaves URLs with paths unchanged: `wss://relay.example.com/sub/path` → `wss://relay.example.com/sub/path`
- Validates that URLs are proper WebSocket URLs

## Benefits

1. **Prevents Duplicates**: Users will no longer see duplicate discovery relays in their settings
2. **Consistent Behavior**: All relay URL comparisons now use normalized format
3. **Better User Experience**: Cleaner relay list, less confusion
4. **Robust**: Works regardless of whether URLs are entered with or without trailing slashes

## Files Modified

1. **src/app/pages/settings/relays/relays.component.ts**
   - Added trailing slashes to `knownDiscoveryRelays` and `nostriaRelayRegions`
   - Updated `setupNostriaRelays()` to use normalized URL comparison
   - Updated `addDiscoveryRelay()` to use normalized URL comparison
   - Updated `findClosestRelay()` to use normalized URL comparison

2. **src/app/services/feed.service.ts**
   - Added trailing slash to default discovery relay URL

## Testing Recommendations

To verify the fix works correctly:

1. **New User Setup**:
   - Create a new account with "bring your own key"
   - Go through auto-setup with zero relays
   - Select a Nostria region
   - Check Settings → Relays → Discovery Relays
   - Verify only ONE discovery relay for the selected region

2. **Manual Addition**:
   - Go to Settings → Relays → Discovery Relays
   - Try adding `wss://discovery.eu.nostria.app` (without slash)
   - If `wss://discovery.eu.nostria.app/` already exists, should see "already in your list"

3. **Find Closest Relay**:
   - Click "Find Closest Relay" button
   - Verify relays already in the list are marked as "Already Added"
   - This should work correctly regardless of trailing slash

## Future Considerations

While this fix addresses the immediate issue, consider:

1. **Migration**: Users who already have duplicate relays won't be automatically cleaned up by this fix. A one-time cleanup migration could be added.

2. **Prevention at API Level**: Consider normalizing URLs when they're added to the relay service, not just when comparing.

3. **Validation**: Add URL validation when users manually enter relay URLs to enforce trailing slash for root URLs.
