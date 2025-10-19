# Proof-of-Work Browser Extension Signing Fix

## Issue Description

When attempting to publish a note with Proof-of-Work using a browser extension (NIP-07), the event would fail to publish after signing. The signing process would complete successfully, but the event would never be sent to relays, or the extension would hang indefinitely.

## Root Causes

There were two critical issues preventing PoW events from being signed correctly:

### Issue 1: Timestamp Overwriting

The `NostrService.sign()` method was overwriting the `created_at` timestamp with `this.currentDate()` for all signing methods. This was problematic for PoW because:

1. **PoW Mining Process**: During mining, a specific `created_at` timestamp is used
2. **Event ID Calculation**: The event ID (hash) depends on all event fields including `created_at`
3. **Nonce Validation**: The nonce in the PoW is only valid for the specific timestamp used during mining
4. **Invalidation**: Changing the timestamp after mining invalidates the entire proof-of-work

### Issue 2: Event ID Recalculation (Critical)

When sending events to browser extensions for signing, we were not including the pre-calculated event `id`. According to NIP-07, extensions should add the `id`, `pubkey`, and `sig` fields. However, this caused a critical problem for PoW events:

1. **During Mining**: We calculate a specific event ID with leading zero bits
2. **Sending to Extension**: We send the event without the `id` field
3. **Extension Recalculates**: The extension recalculates the event ID from scratch
4. **ID Changes**: Even with the same data, any variation in serialization or the extension using its own pubkey changes the ID
5. **PoW Invalidated**: The new ID no longer has the required leading zero bits, breaking the proof-of-work

## Solution

### Fix 1: Preserve Timestamp

### Fix 1: Preserve Timestamp

Modified the `NostrService.sign()` method to preserve the `created_at` timestamp if it already exists in the event being signed.

**File**: `src/app/services/nostr.service.ts`

```typescript
// Extension signing
const eventTemplate: any = {
  kind: event.kind,
  created_at: event.created_at ?? this.currentDate(),  // Preserves if exists
  tags: event.tags,
  content: event.content,
};
```

This pattern was applied to all three signing methods:
- Browser Extension (NIP-07)
- Remote Signing (NIP-46)
- NSEC Signing

### Fix 2: Include Pre-Calculated ID for PoW Events (Critical)

For events with a `nonce` tag (indicating PoW), we now include the pre-calculated event `id` and `pubkey` when sending to the extension. This prevents the extension from recalculating the ID and breaking the proof-of-work.

**File**: `src/app/services/nostr.service.ts`

```typescript
// If this is a mined PoW event (has nonce tag and pubkey), include the ID
const hasNonceTag = event.tags.some(tag => tag[0] === 'nonce');
if (hasNonceTag && 'pubkey' in event) {
  // Calculate and include the event ID for PoW events
  const { getEventHash } = await import('nostr-tools');
  eventTemplate.id = getEventHash(event as UnsignedEvent);
  eventTemplate.pubkey = (event as UnsignedEvent).pubkey;
}
```

This ensures:
- The extension receives the correct event ID that was mined
- The extension only needs to add the signature
- The proof-of-work remains valid

## Impact

### Positive Effects:
- ✅ PoW events can now be signed and published successfully with browser extensions
- ✅ Timestamp is preserved during the signing process
- ✅ Event ID is preserved for PoW events, maintaining proof-of-work validity
- ✅ Works with all account types (extension, remote, nsec)
- ✅ Extension only needs to add the signature, not recalculate the ID

### Backward Compatibility:
- ✅ Events without a pre-set `created_at` still get the current timestamp
- ✅ Non-PoW events work exactly as before (no `id` or `pubkey` included)
- ✅ No breaking changes to existing functionality

## Testing

To verify the fix:
1. Enable PoW in note editor advanced options
2. Set a target difficulty (e.g., 20 bits)
3. Click "Generate Proof" and wait for mining to complete
4. Click "Publish Note"
5. Sign the event using your browser extension
6. Verify the event is published to relays successfully
7. Check the published event has the correct nonce tag and difficulty

## Implementation Date

October 19, 2025

## Related Files

- `src/app/services/nostr.service.ts` - Core signing logic
- `src/app/services/pow.service.ts` - PoW mining implementation
- `src/app/components/note-editor-dialog/note-editor-dialog.component.ts` - UI integration

## References

- [NIP-13: Proof of Work](https://github.com/nostr-protocol/nips/blob/master/13.md)
- [NIP-07: Browser Extension Signing](https://github.com/nostr-protocol/nips/blob/master/07.md)
- [NIP-46: Remote Signing](https://github.com/nostr-protocol/nips/blob/master/46.md)
