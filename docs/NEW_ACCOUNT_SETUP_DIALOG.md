# New Account Setup Dialog Implementation

## Overview

This document describes the implementation of an automatic account setup feature that detects when a user logs in with a key that has no relay configuration and offers to set up the account with default settings.

## Problem Statement

When users log in using a private key (nsec), browser extension, or Nostr Connect with a brand new key that has no history on the Nostr network, the application couldn't find any relay configuration on the Discovery Relays. This left users without any functional relay setup, making it difficult for them to interact with the network.

## Solution

We implemented a confirmation dialog that appears when no relay configuration is detected during login. The dialog:

1. Explains to the user that no relay configuration was found
2. Lists what will be configured automatically
3. Asks for user consent before proceeding
4. Sets up the account with default settings if the user agrees

## Components Added

### 1. SetupNewAccountDialogComponent

**Location:** `src/app/components/setup-new-account-dialog/`

A new Angular Material dialog component that presents the user with information about the setup process and asks for confirmation.

**Files:**
- `setup-new-account-dialog.component.ts` - Component logic
- `setup-new-account-dialog.component.html` - Dialog template
- `setup-new-account-dialog.component.scss` - Dialog styles

**Key Features:**
- Clear explanation of why the dialog is shown
- Lists what will be configured (account relay, discovery relay, media server, DM relay)
- **Automatic region detection** based on server latency
- **Region selection UI** allowing users to choose their preferred region
- Interactive region list with latency information displayed
- Loading indicator during region detection
- Cancel and Confirm actions
- Returns object with `confirmed` boolean and selected `region` ID

**Region Detection:**
- Automatically checks latency to all available servers when dialog opens
- Displays the fastest region as "Recommended"
- Shows latency information for each region (e.g., "125ms")
- Allows users to manually select a different region if desired
- Expandable/collapsible region list for better UX
- Keyboard accessible (Tab, Enter, Space navigation)

## Methods Added to NostrService

### 1. `setupNewAccountWithDefaults(user: NostrUser, region?: string): Promise<void>`

Sets up a new account with default configuration including:
- Account relay initialization
- Discovery relay configuration
- Relay list event (kind 10002) creation and publishing
- Media server configuration (BUD-03)
- Direct messages relay list (NIP-17)

The method:
- Uses the provided region or falls back to user's region or 'us'
- Signs events using the appropriate method (nsec or extension)
- Publishes events to both account relay and discovery relay
- Saves events to local storage
- Marks the account as activated

### 2. `hasRelayConfiguration(pubkey: string): Promise<boolean>`

Checks if a user has any relay configuration by:
1. Checking local storage for kind 10002 (Relay List) events
2. Checking local storage for kind 3 (Contacts) events with relay information
3. Attempting to discover relays from discovery relays
4. Returns `true` if any relays are found, `false` otherwise

## LoginDialogComponent Updates

The login dialog component was updated to check for relay configuration after successful login in the following methods:

### 1. `loginWithExtension()`
- After successful extension login, checks for relay configuration
- Shows setup dialog if no relays found

### 2. `loginWithNsec()`
- After successful nsec login, checks for relay configuration
- Shows setup dialog if no relays found

### 3. `loginWithNostrConnect()`
- After successful Nostr Connect login, checks for relay configuration
- Shows setup dialog if no relays found

### 4. `loadCredentialsFromFile()`
- After loading and logging in with credentials from file, checks for relay configuration
- Shows setup dialog if no relays found

### 5. `showSetupNewAccountDialog(user: NostrUser): Promise<void>`

Private helper method that:
- Opens the setup confirmation dialog
- Waits for user response (returns object with `confirmed` and `region` properties)
- If user confirms:
  - Uses the region selected by the user in the dialog
  - Calls `setupNewAccountWithDefaults()` with the selected region
  - Shows success message
- If user declines:
  - Shows informational message about configuring relays later
  - Allows user to continue without setup

**Note:** The region detection and selection now happens **inside** the setup dialog, not in the login dialog.

## User Flow

1. User logs in with a new/unused key via extension, nsec, Nostr Connect, or file
2. Login succeeds and account is set
3. System checks if relay configuration exists for the pubkey
4. If no relays found:
   - Setup confirmation dialog is displayed
   - Dialog automatically starts detecting best region based on latency
   - Loading spinner shows "Detecting best region based on latency..."
   - Once detection completes, recommended region is displayed
   - User can click on recommended region to expand and see all available regions
   - Each region shows its name and latency (e.g., "USA 125ms", "Europe 167ms")
   - User can select a different region if desired
   - User reads explanation and decides whether to proceed
5. If user confirms:
   - System uses the region selected by the user
   - Account is configured with appropriate relays for that region
   - Events are created, signed, and published
   - Success message shown
6. If user declines:
   - Account continues without automatic setup
   - User can manually configure relays in settings later

## Technical Details

### Region Detection
The setup dialog uses the existing `DiscoveryService` to detect the best region based on server latency:
- Latency check is performed when the dialog opens
- All available servers are queried and sorted by response time
- The fastest server is automatically selected and marked as "Recommended"
- Users can view all regions with their latencies and manually select a different one
- Selected region is passed to `setupNewAccountWithDefaults()` for configuration

### Event Signing
The setup method uses the existing `signEvent()` method from NostrService, which properly handles different account types:

- **nsec accounts**: Creates `UnsignedEvent` (with pubkey) and signs using `finalizeEvent()`
- **extension accounts**: Creates `EventTemplate` (WITHOUT pubkey) for NIP-07 compliance
  - Extensions add the pubkey themselves when signing
  - This prevents the `s.startsWith is not a function` error
- **remote accounts**: Creates `UnsignedEvent` (with pubkey) and signs using BunkerSigner
- **preview accounts**: Throws an error (not supported for signing)

The signing method now correctly distinguishes between:
- `EventTemplate` (no pubkey) - for NIP-07 extensions
- `UnsignedEvent` (with pubkey) - for nsec and remote signing

This ensures compatibility with browser extensions that expect proper `EventTemplate` objects per NIP-07 specification.

This ensures consistency with the rest of the application and avoids code duplication.

## Troubleshooting

### Extension Signing Issues

**Problem**: `Error: s.startsWith is not a function` when signing with browser extension

**Root Cause**: Extension was receiving event objects with `pubkey` property that it couldn't process. According to NIP-07, browser extensions expect an `EventTemplate` (which doesn't include `pubkey`), not an `UnsignedEvent` (which does include `pubkey`).

**Solution**: The `sign()` method now creates different event types based on the account source:

**For Extensions (NIP-07):**
```typescript
const eventTemplate: EventTemplate = {
  kind: event.kind,
  created_at: this.currentDate(),
  tags: event.tags,
  content: event.content,
  // NO pubkey - extension adds it
};
```

**For nsec/remote signing:**
```typescript
const cleanEvent: UnsignedEvent = {
  kind: event.kind,
  created_at: this.currentDate(),
  tags: event.tags,
  content: event.content,
  pubkey: eventPubkey, // Pubkey included
};
```

This distinction is critical because:
- NIP-07 extensions retrieve the pubkey from the user's extension account
- The extension adds the pubkey during the signing process
- Passing a pubkey to the extension causes it to try to process it incorrectly

### Key Differences

| Type | Used For | Includes pubkey? | Used By |
|------|----------|------------------|---------|
| `EventTemplate` | Extension signing | ❌ No | NIP-07 extensions (Alby, nos2x) |
| `UnsignedEvent` | Direct signing | ✅ Yes | nsec signing, remote signing |
| `Event` | Signed events | ✅ Yes | Final signed result |

### Event Publishing
All configuration events are:
1. Saved to local storage first (for offline access)
2. Published to the account relay
3. Published to the discovery relay (for relay list events)

### Events Created

The following events are created and published during setup:

1. **Relay List (kind 10002)**
   - Contains the user's account relay
   - Published to both account and discovery relays

2. **Media Server List (kind 10063)**
   - BUD-03: User Server List
   - Contains the user's media server URL

3. **Direct Messages Relay List (kind 10050)**
   - NIP-17: Private Direct Messages
   - Contains the DM relay URL

## Benefits

1. **Better User Experience**: New users are guided through the setup process
2. **Informed Consent**: Users understand what's happening before it happens
3. **Flexibility**: Users can decline and configure manually later
4. **Automatic Configuration**: Reduces friction for new users
5. **Regional Optimization**: Uses latency detection to choose best servers automatically
6. **Transparency**: Shows actual latency measurements for each region
7. **User Control**: Allows manual region selection if user prefers a specific location
8. **Visual Feedback**: Loading indicators and clear status messages throughout the process
9. **Accessibility**: Full keyboard navigation support for region selection

## Future Enhancements

Potential improvements for future iterations:

1. ~~Allow users to choose region manually in the setup dialog~~ ✅ **IMPLEMENTED**
2. Provide more detailed information about each relay being configured
3. Add option to configure multiple relays instead of just one
4. Remember user's choice to not show the dialog again
5. Provide a settings option to re-run the setup process
6. Show more detailed server information (location, capacity, features)
7. Allow testing connection to selected region before confirming
8. Save user's region preference for future account setups
