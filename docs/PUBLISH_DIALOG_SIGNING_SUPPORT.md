# Publish Dialog - Event Signing Support

## Summary

Extended the publish dialog component to support signing unsigned Nostr events before publishing.

## Changes Made

### 1. Import UnsignedEvent Type
- Added `UnsignedEvent` import from `nostr-tools` alongside the existing `Event` import
- This type represents events that haven't been signed yet (missing `id` and `sig` fields)

### 2. Updated `parseCustomEvent()` Method
- Modified return type from `Event | null` to `Event | UnsignedEvent | null`
- Removed validation requirements for `id` and `sig` fields (now optional)
- Made `pubkey` field optional as well (will be added during signing if missing)
- Events can now be parsed whether they're signed or unsigned

### 3. Enhanced `publish()` Method
- Added logic to detect if an event needs signing by checking for `id` and `sig` fields
- When an unsigned event is detected:
  - Calls `nostrService.signEvent()` to sign the event
  - Shows signing dialog to user (handled by NostrService)
  - Updates the custom event JSON display with the signed version
  - Handles signing errors gracefully with user-friendly error messages
- Signed events are used as-is without modification

### 4. Updated UI Hints
- Changed hint text from "Paste a complete signed Nostr event JSON" to "Paste a Nostr event JSON (signed or unsigned - will be signed if needed)"
- Updated placeholder to show an example unsigned event instead of a signed one

## How It Works

When a user pastes an event JSON in custom mode:

1. **If the event has both `id` and `sig` fields**: The event is already signed and will be published directly
2. **If the event is missing `id` or `sig`**: The event will be signed using the user's configured signing method (extension, nsec, or remote signer) before publishing

The signing process uses the existing `NostrService.signEvent()` method which:
- Supports browser extensions (NIP-07)
- Supports nsec private keys
- Supports remote signers (NIP-46)
- Shows appropriate signing dialogs to the user
- Handles errors and user cancellation

## Benefits

- Users can now publish unsigned events without manually signing them first
- More flexible workflow for testing and development
- Maintains security by using the established signing infrastructure
- Clear feedback to users about what's happening (signing vs. direct publish)
