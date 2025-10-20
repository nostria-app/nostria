# User Profile Enhancements - Clickable Links and Hover Card

## Summary

Enhanced the user-profile component with comprehensive interactive features:
1. Made the profile name and NIP-05/npub alias clickable, linking to the user's profile page
2. Implemented a rich hover card with profile details, follow actions, and context menu
3. Added mutual following detection and display
4. Integrated report and block functionality
5. Fixed hover card positioning and visibility issues

## Changes Made

### 1. Clickable Profile Elements

#### Template Changes (`user-profile.component.html`)
- Wrapped the `<app-profile-display-name>` component in an anchor tag with routing to the profile page
- Wrapped the npub/NIP-05 alias display in an anchor tag with routing to the profile page
- Both links use `[routerLink]="['/p', npubValue()]"` to navigate to the profile

#### Style Changes (`user-profile.component.scss`)
- Added `.user-profile-name-link` styles with hover underline effect
- Added `.user-profile-npub-link` styles with hover underline effect
- Both links maintain the inherit color and block display for proper layout
- Hover effects provide visual feedback with text decoration

### 2. Enhanced Profile Hover Card

#### New Component: `ProfileHoverCardComponent`
Created a comprehensive standalone component at `src/app/components/user-profile/hover-card/`:

**Features:**
- **Rich Profile Display:**
  - Banner image with placeholder fallback for missing banners
  - Profile avatar (80x80px)
  - Display name and NIP-05/npub alias
  - About section (truncated to 4 lines with ellipsis)
  - Mutual following indicator with named profiles

- **Interactive Elements:**
  - Follow/Unfollow button with loading state
  - "View Profile" button for navigation
  - Context menu (three-dot menu) with:
    - Report profile option
    - Block user option
  - Menu stays open when clicked, doesn't close the hover card

- **Mutual Following Detection:**
  - Compares current user's following list with target profile's following list
  - Displays count and names of mutual connections
  - Shows up to 2 named profiles (e.g., "Followed by Jon and Wanja and 39 others")
  - Uses NIP-03 (kind 3) events to fetch following lists

- **Smart Behavior:**
  - Loading and error states with appropriate UI
  - Optimized image loading using cache service
  - Responsive design with theme integration

**Files:**
- `profile-hover-card.component.ts` - Component logic with all interactions
- `profile-hover-card.component.html` - Template with Material Design components
- `profile-hover-card.component.scss` - Styling with theme variables and responsive design

#### User Profile Component Integration

**Fixed Hover Card Issues:**
1. **Proper Hiding:** Implemented state tracking for mouse position over both trigger and card
2. **Viewport Positioning:** Added multiple fallback positions and viewport margin
3. **Off-screen Prevention:** Enabled CDK's `withPush(true)` and `withViewportMargin(16)`

**Position Strategy:**
- **Primary:** Below center (most common)
- **Secondary:** Above center (when no space below)
- **Tertiary:** Below left-aligned (near left edge)
- **Quaternary:** Below right-aligned (near right edge)

**Hover Management:**
- Tracks separate signals for trigger and card hover states
- 500ms delay before showing (prevents accidental triggers)
- 150ms delay before hiding (smooth transitions)
- Properly cleans up all timers and event listeners

**New Dependencies:**
- `@angular/cdk/overlay` - For overlay positioning and management
- `@angular/cdk/portal` - For dynamic component creation
- `MatMenuModule` - For context menu
- `StorageService` - For fetching following lists
- `AccountStateService` - For follow/unfollow actions
- `ReportingService` - For report and block functionality

**New Methods:**
- `onMouseEnter(event, triggerElement)` - Handles mouse enter with proper state management
- `onMouseLeave()` - Handles mouse leave with delayed closing
- `showHoverCard(triggerElement)` - Creates overlay with improved positioning
- `scheduleClose()` - Checks menu state before closing overlay
- `closeHoverCard()` - Disposes overlay and resets state

**Menu State Management:**
- Tracks `isMenuOpen` signal in hover card component
- Parent component checks menu state before closing
- Recursive scheduling prevents premature closure
- Menu can be opened and used without closing the card

**Template Updates:**
- Added hover event listeners to avatar link
- Added hover event listeners to profile content section
- Template references (`#avatarElement`, `#contentElement`) for precise positioning
- Menu trigger events (`menuOpened`, `menuClosed`) for state tracking

### 3. Mutual Following Feature

**Implementation:**
- Fetches both users' following lists (kind 3 events)
- Calculates intersection of following lists
- Loads profile data for up to 2 mutual contacts
- Displays formatted text similar to Facebook/X:
  - "Followed by [Name]" (1 mutual)
  - "Followed by [Name1] and [Name2]" (2 mutual)
  - "Followed by [Name1], [Name2] and X others" (3+ mutual)

**Performance Considerations:**
- Only fetches following list when hover card is shown
- Limits profile loading to first 2 mutual contacts
- Caches profile data using existing data service

### 4. Follow/Unfollow Integration

**Features:**
- Shows current follow status from account state
- Toggle button with loading spinner during action
- Changes button text and icon based on follow state
- Integrates with existing `AccountStateService`
- Updates UI immediately on success

### 5. Report and Block Functionality

**Context Menu:**
- Three-dot menu button positioned in top-right
- Material Design menu with proper theming
- Two options: Report Profile and Block User
- Menu remains open and doesn't close the hover card

**Report Profile:**
- Creates NIP-56 report event
- Publishes to account relays
- Shows toast notification on success/failure
- Default report type: "spam"

**Block User:**
- Adds user to mute list (NIP-51)
- Updates local mute list state
- Publishes updated mute list
- Shows toast notification

## User Experience

### Clickable Links
- Users can now click on the profile name to navigate to the profile page
- Users can click on the NIP-05 alias or npub to navigate to the profile page
- Visual feedback on hover (underline) indicates clickability
- Consistent with existing avatar click behavior

### Hover Card
- **Desktop Experience:**
  - Rich profile preview on hover
  - Appears with 500ms delay to avoid accidental triggers
  - Smart positioning avoids screen edges
  - Can hover over card to keep it open
  - Smooth transitions when moving between trigger and card

- **Positioning:**
  - Automatically adjusts based on available space
  - Maintains 16px margin from viewport edges
  - Pushes into view if would be off-screen
  - Supports 4 different position variants

- **Visual Design:**
  - Consistent banner height with placeholder fallback
  - Material Design components throughout
  - Theme-aware colors and shadows
  - Proper spacing and visual hierarchy

### Mutual Following
- Helps users understand social connections
- Shows familiar names from their network
- Encourages engagement with mutual contacts
- Similar UX to Facebook and X (Twitter)

### Quick Actions
- Follow/unfollow without leaving current view
- One-click access to moderation tools
- Clear visual feedback for all actions
- Loading states prevent duplicate actions

## Technical Details

### Overlay Positioning
The hover card uses Angular CDK's flexible positioning with fallback strategies:
```typescript
.withPositions([
  { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top' },
  { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom' },
  { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' },
])
.withViewportMargin(16)
.withPush(true)
```

### State Management
Uses Angular signals for reactive state:
- `isFollowing` - Current follow status
- `isLoadingFollowing` - Loading state for follow actions
- `mutualFollowing` - Array of mutual contact pubkeys
- `mutualFollowingProfiles` - Profile data for display
- `isMouseOverTrigger` - Tracks trigger hover state
- `isMouseOverCard` - Tracks card hover state

### Performance Considerations
- Profile data fetched on demand when hover card shows
- Following lists cached by storage service
- Image optimization uses existing cache service
- Overlay properly disposed when no longer needed
- Debounced hover detection prevents excessive renders
- Limits mutual contact profile loading to 2 profiles

### Nostr Protocol Integration
- **NIP-03:** Contact list (kind 3) for following lists
- **NIP-51:** Mute list (kind 10000) for blocking
- **NIP-56:** Report events (kind 1984) for reporting

## Future Enhancements

1. **Following Count:** Display actual following count from profile's kind 3 event
2. **Enhanced Mutual Display:** Show profile avatars in addition to names
3. **Keyboard Navigation:** Support keyboard triggers for accessibility
4. **Animation:** Add subtle fade-in/fade-out animations
5. **Mobile Optimization:** Long-press gesture for mobile hover card
6. **Report Dialog:** More detailed report options with custom messages
7. **Cached Mutual Data:** Cache mutual following calculations
8. **Activity Status:** Show last active timestamp if available

## Testing Recommendations

1. Test hover behavior across different views (list, details, grid)
2. Verify overlay positioning at all viewport edges
3. Test click-through on all clickable elements
4. Verify proper cleanup on navigation
5. Test with profiles that have missing data
6. Test scrolling behavior (should close hover card)
7. Verify image loading and error states
8. Test follow/unfollow actions
9. Verify mutual following calculations
10. Test report and block functionality
11. Check hover card visibility with mouse movements
12. Verify positioning doesn't go off-screen
