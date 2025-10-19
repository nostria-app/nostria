# Notification Activity Filter Implementation

## Overview

Added a filtering mechanism to the Activity tab in the Notifications page, allowing users to selectively hide or show different types of notification events. This feature is similar to the feed filtering implementation in the main menu.

## Implementation Details

### Components Modified

#### `notifications.component.ts`

**New Features:**

1. **Notification Filters Signal**
   - Added `notificationFilters` signal to track which notification types are enabled
   - All notification types are enabled by default
   - Filter state is maintained in component memory (not persisted)

2. **Filter Methods**
   - `toggleNotificationFilter(type)`: Toggles a specific notification type filter on/off
   - `getNotificationTypeLabel(type)`: Returns user-friendly labels for notification types
   - `getNotificationTypeIcon(type)`: Returns appropriate Material icons for each type
   - `getFilterableNotificationTypes()`: Returns array of content notification types that can be filtered

3. **Updated Computed Signal**
   - Modified `contentNotifications()` to apply filters when displaying notifications
   - Only shows notifications whose type is enabled in the filter

**Filterable Notification Types:**
- Following events (`NEW_FOLLOWER`)
- Mentions (`MENTION`)
- Reposts (`REPOST`)
- Replies (`REPLY`)
- Reactions (`REACTION`)
- Zap events (`ZAP`)

**User-Friendly Labels:**
- NEW_FOLLOWER → "Following events"
- MENTION → "Mentions"
- REPOST → "Reposts"
- REPLY → "Replies"
- REACTION → "Reactions"
- ZAP → "Zap events"

#### `notifications.component.html`

**UI Changes:**

1. **Gear Icon in Tab Label**
   - Added a settings gear icon button next to "Activity" tab label
   - Icon appears inline with tab content
   - Click opens filter menu without changing tabs

2. **Filter Menu**
   - Material menu with header "Filter Activity"
   - Lists all filterable notification types
   - Each item shows:
     - Checkbox icon (checked/unchecked)
     - Type-specific icon
     - User-friendly label
   - Clicking toggles the filter on/off
   - **Menu remains open** for multiple selections (using stopPropagation on mousedown)

#### `notifications.component.scss`

**New Styles:**

1. **Tab Label Layout**
   - `.tab-label`: Flexbox layout for tab content with filter button
   - `.filter-button`: Styled gear icon with hover effect, proper padding and alignment fixes

2. **Filter Menu**
   - `.filter-menu-header`: Header section with icon and title
   - `.type-icon`: Icon styling for notification type indicators in menu items
   - `.filter-menu-item`: Menu item styling with hover effects

## User Experience

### How It Works

1. **Accessing Filters**
   - Navigate to Notifications page
   - Click the gear icon next to "Activity" in the tab
   - Filter menu opens showing all notification types

2. **Filtering Notifications**
   - Check/uncheck notification types to show/hide them
   - Changes apply immediately
   - Notification count badge updates to reflect visible notifications
   - **Menu stays open for multiple selections** - click multiple filters without the menu closing

3. **Visual Feedback**
   - Checked items are currently visible
   - Unchecked items are hidden
   - Each type has a descriptive icon for quick recognition
   - Gear icon is properly aligned in the tab button

## Technical Notes

### Design Decisions

1. **In-Memory Storage**
   - Filter preferences are not persisted across sessions
   - This keeps the implementation simple and stateless
   - Users see all notifications by default on each visit

2. **Reactive Updates**
   - Uses Angular signals for reactive updates
   - Filter changes immediately recompute visible notifications
   - No need for manual refresh or page reload

3. **Similar to Feeds Pattern**
   - Follows the same UX pattern as feed filtering in main menu
   - Consistent gear icon placement
   - Similar menu structure and interaction

4. **Menu Persistence**
   - Menu stays open when clicking filter items
   - Uses `stopPropagation()` on both `click` and `mousedown` events
   - Allows users to toggle multiple filters without reopening the menu
   - Menu can be closed by clicking outside or pressing Escape

5. **Icon Alignment**
   - Gear icon properly centered using flexbox
   - Fixed padding and line-height issues
   - Consistent visual appearance across different screen sizes

### Future Enhancements

Potential improvements for future iterations:

1. **Persist Filter State**
   - Store preferences in `LocalSettingsService`
   - Remember user's filter choices across sessions

2. **Quick Filter Presets**
   - "All notifications"
   - "Important only" (mentions, replies, zaps)
   - "Social only" (follows, reactions, reposts)

3. **Filter System Notifications**
   - Currently only content notifications are filterable
   - Could extend to system notifications tab

4. **Filter Count Indicator**
   - Show number of active filters in the gear icon
   - Visual indicator when filters are applied

## Testing Recommendations

1. Verify all notification types can be toggled
2. Confirm filtered notifications don't appear in the list
3. Check that badge count updates correctly
4. Test menu interaction (stays open for multiple selections)
5. Verify default state (all types enabled)
6. Test on mobile and desktop layouts
