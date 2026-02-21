# Fix: Input Field Focus Loss After Sending DM on Desktop

## Problem
When sending a Direct Message on desktop by pressing Enter, the input field loses focus. Users must manually click the input field to continue typing, which interrupts the conversation flow.

## Solution
Added automatic focus restoration to the message input field after sending a message.

## Technical Details

### Before
```typescript
// Clear the input and reply context
this.newMessageText.set('');
this.replyingToMessage.set(null);
this.mediaPreviews.set([]);

// Determine which encryption to use...
```

### After
```typescript
// Clear the input and reply context
this.newMessageText.set('');
this.replyingToMessage.set(null);
this.mediaPreviews.set([]);

// Restore focus to the input field after sending (desktop behavior)
setTimeout(() => {
  this.messageInput?.nativeElement?.focus();
}, 0);

// Determine which encryption to use...
```

## Why setTimeout with 0ms?
The `setTimeout` with 0ms delay defers the focus operation to the next tick of the event loop. This ensures the focus happens after Angular's change detection cycle completes and the input value has been cleared. This is the same pattern already used successfully in the `setReplyTo()` method.

## User Experience Impact
- ✅ Users can now send messages and immediately continue typing
- ✅ No need to manually click the input field after each message
- ✅ Matches expected behavior of modern messaging applications
- ✅ Improves conversation flow and typing efficiency

## Testing
- Builds successfully
- Passes code review
- No security vulnerabilities introduced
- Follows existing patterns in the codebase

## Files Changed
- `src/app/pages/messages/messages.component.ts` - Added 4 lines to restore focus after sending
