# Message Button Navigation Fix

## Issue
The "Send private message" button on user profiles had a bug where clicking it didn't properly display the chat interface:
- First click: Chat would be created but not visually displayed, staying on `/messages` instead of navigating to `/messages/:chatId`
- Second click: Shows "Chat already exists" message but still no chat interface
- User couldn't see the chat header or message input area

## Root Cause
There were two main issues causing this bug:

1. **Conflicting Navigation**: When processing the `?pubkey=xxx` query parameter, the component would:
   - Call `startChatWithPubkey()` which eventually calls `selectChat()`
   - `selectChat()` would navigate to `/messages/:chatId`
   - But immediately after, the query param handler would also navigate to remove the `?pubkey` param
   - These two competing navigations would conflict, and the second one would win, leaving the user on `/messages` without the chatId

2. **Missing Route Monitoring**: The component wasn't listening to route parameter changes (`:id` in the URL path), only to query parameters. So even when navigation worked, the chat wouldn't be visually selected.

## Solution
Made two key changes:

### 1. Fixed Navigation Conflict
Removed the competing navigation that was trying to clear the query parameter immediately. Instead:
- Let `selectChat()` handle the complete navigation to `/messages/:chatId`
- Modified `selectChat()` to clear query params as part of its navigation
- This ensures only one navigation happens, avoiding conflicts

### 2. Added Route Monitoring
Added a `NavigationEnd` event listener in `ngOnInit()` that:
- Monitors when navigation completes
- Extracts the `chatId` from the URL path
- Looks up the chat in the messaging service
- Sets the `selectedChatId` signal to trigger the UI update
- Handles mobile view appropriately
- Marks the chat as read

This ensures that both direct navigation to `/messages/:chatId` and programmatic navigation via `selectChat()` properly display the chat interface.

## Code Changes
- Modified `ngOnInit()` in `messages.component.ts`:
  - Removed the competing `router.navigate()` call that was clearing query params
  - Added `NavigationEnd` event subscription to monitor URL changes
- Modified `selectChat()` in `messages.component.ts`:
  - Added `queryParams: {}` to clear query parameters during navigation
- Added import for `NavigationEnd` from `@angular/router`

## Testing
To test the fix:
1. Navigate to any user profile (not your own)
2. Click the "Send private message" button
3. Verify that:
   - URL changes to `/messages/:chatId` (not just `/messages`)
   - Chat interface appears immediately with user's profile information in the header
   - Empty message list is shown (new conversation)
   - Message input field is visible at the bottom
4. Type and send a message to confirm the chat is fully functional
5. Navigate away and click "Send private message" again
6. Verify it shows "Chat already exists" and properly displays the existing chat

