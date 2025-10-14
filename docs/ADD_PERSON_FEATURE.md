# Add Person to Following Feature

## Overview

Added a new feature to the People page that allows users to add new people to their following list by searching with their public key (npub or hex format).

## Implementation

### New Components

#### `add-person-dialog.component.ts`

A standalone Angular Material dialog component that:

1. **Accepts Input**: Users can paste either an npub, nprofile, or hex public key
2. **Discovers User**: Queries the Discovery Relay service to fetch user's relay list and metadata
3. **Shows Preview**: Displays the user profile preview using the existing `UserProfileComponent`
4. **Follows User**: Allows the user to follow the discovered person or cancel

**States**:
- `input`: Initial state for entering the public key
- `loading`: While discovering user information
- `preview`: Shows user profile with Follow/Cancel options
- `success`: Confirmation after successful follow
- `error`: Error state with message

**Key Features**:
- Supports npub, nprofile, and hex public key formats
- Uses `nip19.decode()` for parsing Nostr identifiers
- Queries Discovery Relay for user relay URLs
- Attempts to fetch metadata from cache/storage first, then discovers if needed
- Checks if already following and prevents duplicate follows
- Integrates with `AccountStateService.follow()` for publishing the updated contact list

### Updated Components

#### `people.component.ts`

- Added MatDialog injection
- Added `openAddPersonDialog()` method to open the dialog
- Dialog result handling refreshes the people list after successful follow

#### `people.component.html`

- Added "Add Person" button in the header controls section
- Button includes person_add icon and tooltip
- Positioned alongside existing view options and filters

#### `people.component.scss`

- Added styling for the new button to properly align with existing controls

## User Flow

1. User clicks "Add Person" button on People page
2. Dialog opens with input field
3. User pastes npub/nprofile/hex public key
4. User clicks "Search" or presses Enter
5. System queries Discovery Relay for user's relays
6. System fetches user metadata (profile information)
7. User profile preview is displayed
8. User clicks "Follow" to add to following list
9. System publishes updated contact list (kind 3 event)
10. Dialog shows success message and auto-closes
11. People list refreshes to show the new person

## Technical Details

### Discovery Process

1. Parse input to extract pubkey (handles npub, nprofile, hex)
2. Query `DiscoveryRelayService.getUserRelayUrls(pubkey)` to get relay list
3. Check cache via `NostrService.getMetadataForUser(pubkey, true)`
4. If not cached, call `NostrService.discoverMetadata(pubkey, true)`
5. Display profile using cached/discovered metadata

### Following Process

1. Check if already following via `AccountStateService.isFollowing()`
2. Call `AccountStateService.follow(pubkey)` to update following list
3. Service automatically publishes updated kind 3 (Contacts) event
4. Service handles relay list updates and notifications

## Dependencies

- `nostr-tools` - For nip19 decoding (npub/nprofile parsing)
- `@angular/material/dialog` - Dialog component infrastructure
- Existing services:
  - `DiscoveryRelayService` - For querying discovery relays
  - `NostrService` - For metadata discovery
  - `AccountStateService` - For following/contact list management
  - `LoggerService` - For debugging and error tracking

## Error Handling

- Invalid public key format validation
- Failed discovery relay queries
- Missing metadata handling (allows follow even without metadata)
- Already following detection
- Failed follow operation handling
