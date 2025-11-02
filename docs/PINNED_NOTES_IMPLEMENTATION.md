# Pinned Notes Implementation (NIP-51 Kind 10001)

## Overview
Implemented support for pinned notes (kind 10001) following NIP-51 specification. Users can now pin up to 3 notes to their profile, which will be displayed prominently at the top of their timeline in a compact, horizontal layout.

## Features

### 1. Pinned List Service (`pinned.service.ts`)
Created a new service to manage pinned notes:
- Fetches pinned list (kind 10001) from storage and user relays
- Provides methods to pin/unpin notes
- Returns the 3 most recent pinned notes (from bottom of list)
- Automatically saves and publishes changes to account relays
- Follows NIP-51: new items appended to end (chronological order)

### 2. Event Menu Integration
Enhanced `EventMenuComponent` to add pin/unpin functionality:
- "Pin Note" / "Unpin Note" menu items appear when:
  - User is on their own profile
  - Event is a text note (kind:1)
  - Event belongs to the current user
- Clicking toggles pin status with feedback messages

### 3. Profile Notes Display
Updated `ProfileNotesComponent` to show pinned notes:
- Fetches pinned notes when profile loads
- Displays top 3 pinned notes in a horizontal grid
- Compact rendering mode for pinned events
- Clear visual separation with pin icon and "PINNED" header
- Responsive layout: stacked on mobile, 3-column grid on desktop

### 4. Compact Event Display
Implemented compact styling for pinned events:
- Smaller avatars (28px)
- Reduced font sizes (0.875rem)
- Content truncated to 4 lines
- Hidden media/article previews
- Smaller action buttons
- Hover effects for better interactivity

## Technical Details

### NIP-51 Compliance
- Kind 10001: Pinned Notes list (replaceable event)
- Expected tags: `['e', eventId]` for kind:1 notes
- Chronological order: oldest first, newest last
- Display: last 3 items in reverse order (most recent first)

### Data Flow
1. **Loading Pinned Notes:**
   - Check storage for kind 10001 event
   - If not found, fetch from user relays
   - Cache in storage for performance
   - Extract last 3 event IDs
   - Fetch full events and display

2. **Pinning a Note:**
   - Append event ID to end of tags array
   - Sign and publish updated list
   - Update local cache
   - Show success notification

3. **Unpinning a Note:**
   - Remove event ID from tags array
   - Sign and publish updated list
   - Update local cache
   - Show success notification

### Relay Subscription
Added kind 10001 to `NostrService.subscribeToAccountMetadata()` filter to receive real-time updates for the current account's pinned list.

## Files Modified

### New Files
- `src/app/services/pinned.service.ts` - Core pinned notes management

### Modified Files
- `src/app/services/nostr.service.ts` - Added kind 10001 to account subscription
- `src/app/components/event/event-menu/event-menu.component.ts` - Added pin/unpin menu items
- `src/app/components/event/event-menu/event-menu.component.html` - Pin/unpin UI
- `src/app/pages/profile/profile-notes/profile-notes.component.ts` - Pinned notes loading
- `src/app/pages/profile/profile-notes/profile-notes.component.html` - Pinned notes display
- `src/app/pages/profile/profile-notes/profile-notes.component.scss` - Compact styling

## Usage

### As a User
1. Navigate to your own profile
2. Open the context menu ("...") on any of your posts
3. Select "Pin Note" to add it to your profile
4. The note appears at the top of your timeline
5. Select "Unpin Note" to remove it

### Display Behavior
- Maximum 3 pinned notes shown
- Most recently pinned appears first (leftmost)
- Compact layout with hover effects
- Hidden on profiles with no pinned notes
- Responsive: horizontal on desktop, stacked on mobile

## Future Enhancements
- Drag-and-drop reordering of pinned notes
- Preview while pinning to see how it looks
- Pin notes from other pages (not just profile)
- Analytics on pinned note engagement
