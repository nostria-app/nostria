# Live Chat Pagination Implementation

## Overview

This document describes the implementation of pagination in the live stream chat component to improve performance and reduce initial load times.

## Problem Statement

The live stream chat was loading up to 1000 messages initially, which could cause performance issues with:
- Excessive rendering time for large message lists
- High memory usage
- Slow initial load times for streams with many chat messages

## Solution

Implemented dynamic pagination that:
1. Loads only the 50 most recent messages initially
2. Dynamically loads 50 older messages when the user scrolls to the top
3. Shows a loading indicator while fetching
4. Preserves scroll position when inserting older messages

## Technical Implementation

### Constants

```typescript
private readonly INITIAL_LIMIT = 50;        // Initial messages to load
private readonly LOAD_MORE_LIMIT = 50;      // Messages per pagination request
private readonly SCROLL_THRESHOLD = 100;    // Pixels from top to trigger load
```

### Key Components

#### 1. Pagination State

- `oldestMessageTimestamp`: Tracks the timestamp of the oldest loaded message
- `isLoadingOlderMessages`: Signal indicating if a pagination request is in progress
- `hasMoreMessages`: Signal indicating if there are more messages to load
- `boundScrollHandler`: Stored reference to scroll handler for proper cleanup

#### 2. Scroll Detection

The component monitors scroll position and triggers loading when:
- User scrolls within 100px of the top
- Not currently loading messages
- There are more messages available to load

```typescript
private onScroll(): void {
  const scrollTop = container.scrollTop;
  if (scrollTop < this.SCROLL_THRESHOLD && !this.isLoadingOlderMessages() && this.hasMoreMessages()) {
    this.loadOlderMessages();
  }
}
```

#### 3. Loading Older Messages

The `loadOlderMessages()` method:
1. Creates a Nostr filter with `until` parameter set to `oldestMessageTimestamp - 1`
2. Subscribes to relays for older messages
3. Waits 2 seconds for relay responses (typical Nostr response time)
4. Processes received messages (kind 1311 chat and kind 9735 zaps)
5. Inserts older messages while preserving scroll position
6. Updates pagination state

#### 4. Scroll Position Preservation

When inserting older messages at the top of the list:
```typescript
const previousScrollHeight = container.scrollHeight;
// ... insert messages ...
const newScrollHeight = container.scrollHeight;
const scrollDiff = newScrollHeight - previousScrollHeight;
container.scrollTop = scrollDiff;
```

This ensures the user's viewport remains stable and focused on the same messages they were viewing.

#### 5. End Detection

Pagination automatically stops when:
- No messages are returned from relays (no more history)
- Fewer messages than requested are returned (reached the beginning)

### UI Components

#### Loading Indicator

A spinner with text appears at the top of the chat during pagination:

```html
@if (isLoadingOlderMessages()) {
  <div class="loading-older-messages">
    <mat-icon class="spinner">autorenew</mat-icon>
    <span>Loading older messages...</span>
  </div>
}
```

The spinner uses a CSS animation:
```css
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
```

## Performance Improvements

### Before
- Initial load: 1000 messages
- Rendering time: High for busy streams
- Memory usage: High
- Initial display: Slow

### After
- Initial load: 50 messages
- Rendering time: Significantly reduced
- Memory usage: Lower initial footprint, grows only on demand
- Initial display: Fast

Memory is still capped at 500 messages to prevent unbounded growth.

## User Experience

1. **Fast Initial Load**: Users see chat immediately with the 50 most recent messages
2. **Smooth Scrolling**: Scroll position is maintained when loading older messages
3. **Clear Feedback**: Loading indicator shows when fetching history
4. **Automatic Detection**: No manual "Load More" button needed
5. **End Indication**: Implicitly stops when no more messages exist

## Code Quality

### Event Listener Management

Proper cleanup implemented using stored function reference:
```typescript
ngAfterViewInit() {
  this.boundScrollHandler = this.onScroll.bind(this);
  container.addEventListener('scroll', this.boundScrollHandler);
}

ngOnDestroy() {
  container.removeEventListener('scroll', this.boundScrollHandler);
}
```

### Documentation

All magic numbers converted to named constants with explanatory comments.

### Error Handling

Try-catch blocks ensure pagination failures don't break the chat:
```typescript
try {
  // ... pagination logic ...
} catch (error) {
  console.error('[LiveChat] Error loading older messages:', error);
} finally {
  this.isLoadingOlderMessages.set(false);
}
```

## Nostr Protocol Considerations

### Filter Parameters

Uses standard Nostr filter parameters:
- `kinds`: [1311, 9735] (chat messages and zaps)
- `#a`: [eventAddress] (for specific stream)
- `limit`: 50 (per request)
- `until`: timestamp (for pagination)

### Relay Response Time

2-second timeout is based on typical Nostr relay response patterns. This balances:
- Giving slower relays time to respond
- Not making users wait too long
- Preventing indefinite hangs

## Testing Considerations

To test this feature:
1. Join a live stream with an active chat
2. Verify only ~50 messages load initially
3. Scroll to the top of the chat
4. Verify loading indicator appears
5. Verify older messages are loaded and inserted
6. Verify scroll position is maintained
7. Continue scrolling up to test multiple pagination cycles
8. Verify pagination stops when reaching the beginning

## Future Enhancements

Potential improvements:
1. Adaptive timeout based on relay connection status
2. Prefetch next page when user is near the threshold
3. Visual indicator when reaching the beginning of chat
4. Configurable page size in settings
5. Virtual scrolling for very long chat histories

## Files Modified

- `src/app/components/live-chat/live-chat.component.ts`
- `src/app/components/live-chat/live-chat.component.html`
- `src/app/components/live-chat/live-chat.component.scss`

## Related Documentation

- Nostr NIPs for live streaming
- Angular signals documentation
- RelayPoolService documentation
