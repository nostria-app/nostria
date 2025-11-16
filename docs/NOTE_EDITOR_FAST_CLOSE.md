# Note Editor Fast Close on First Relay Success

## Overview
Modified the note editor dialog to close immediately after the first successful relay publish instead of waiting for all relays to complete. This significantly improves the user experience by reducing perceived latency during note publishing.

## Problem
Previously, the note editor dialog would wait for `signAndPublish()` to complete publishing to all relays before closing. This could take several seconds depending on relay response times, creating a poor user experience even though the user could already see the publishing status in the top loading indicator.

## Solution
Implemented event-driven dialog closing using the `PublishEventBus`:

1. **Subscribe to relay results**: Before calling `signAndPublish()`, subscribe to `relay-result` events from the `PublishEventBus`
2. **Close on first success**: When the first successful relay publish event is received, immediately:
   - Clear the auto-draft
   - Show success snackbar
   - Close the dialog
   - Navigate to the published event
   - Unsubscribe from further events
3. **Background publishing continues**: The `signAndPublish()` promise continues executing in the background, publishing to remaining relays

## Implementation Details

### Event Matching Strategy
Since we subscribe before the event is signed (and thus before it has an ID), we use a two-stage matching approach:

1. **Before signing**: Match by content (comparing event content with the current note content)
2. **After signing**: Once we have the event ID from the publish result, match by event ID for more accuracy

### Key Changes

#### Imports
Added `PublishEventBus`, `PublishRelayResultEvent`, and `Subscription` from the respective services.

#### Service Injection
```typescript
private publishEventBus = inject(PublishEventBus);
private publishSubscription?: Subscription;
```

#### Cleanup in ngOnDestroy
```typescript
if (this.publishSubscription) {
  this.publishSubscription.unsubscribe();
}
```

#### Modified publishNote Method
- Subscribes to `relay-result` events before calling `signAndPublish()`
- Tracks dialog state with `dialogClosed` flag
- Matches events using content initially, then event ID
- Closes dialog on first successful publish
- Continues background publishing to remaining relays
- Cleans up subscription after handling first success

## Benefits

1. **Faster UX**: Dialog closes as soon as first relay confirms, typically within 100-500ms
2. **Better perception**: User sees immediate feedback without waiting for slow relays
3. **Non-disruptive**: Background publishing continues seamlessly
4. **Maintains reliability**: Still publishes to all configured relays
5. **Consistent with app design**: Uses the existing top loading indicator for tracking ongoing publishes

## Edge Cases Handled

1. **No relay success**: If all relays fail, error handling still works as before
2. **Multiple events**: Event matching ensures we only react to our own event's relay results
3. **Memory leaks**: Proper subscription cleanup in ngOnDestroy and after first success
4. **Race conditions**: `dialogClosed` flag prevents duplicate close actions
5. **Event ID timing**: Handles both pre-signing (no ID) and post-signing (has ID) matching

## Testing Considerations

- Test with slow relays to verify dialog closes on first success
- Test with all relays failing to ensure error handling works
- Test with PoW enabled to ensure mining doesn't interfere
- Test rapid publish attempts to verify no duplicate publishes
- Verify navigation works correctly after fast close
- Confirm background publishing continues to all relays
