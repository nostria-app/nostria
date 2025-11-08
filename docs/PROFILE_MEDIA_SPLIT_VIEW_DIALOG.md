# Profile Media Split-View Dialog Implementation

## Overview

Implemented an Instagram-style split-view dialog for media (photos and videos) in the profile media page. When clicking on media items in the profile, they now open in a popup with the media displayed on the left and comments on the right, instead of navigating to the generic event viewer.

## Changes Made

### 1. New Component: MediaWithCommentsDialogComponent

**Location:** `src/app/components/media-with-comments-dialog/`

Created a new dialog component with the following features:
- **Split-view layout**: Media on the left, comments on the right (similar to Instagram)
- **Responsive design**: Switches to stacked layout on mobile (media top, comments bottom)
- **Auto-expanding comments**: Comments automatically load and display when dialog opens
- **Close button**: Positioned at top-right with backdrop blur effect
- **Support for both photos and videos**: Dynamically renders media based on event kind
- **Self-contained rendering**: Renders media directly without nested components to avoid circular dependencies

**Files created:**
- `media-with-comments-dialog.component.ts`
- `media-with-comments-dialog.component.html`
- `media-with-comments-dialog.component.scss`

**Architecture note**: The dialog component extracts and renders media data directly from the event rather than using `PhotoEventComponent` or `VideoEventComponent`. This design avoids circular dependency issues where the dialog imports the event components, and the event components import the dialog.

### 2. Photo Event Component Updates

**Location:** `src/app/components/event-types/photo-event.component.ts`

**Changes:**
- Added import for `MediaWithCommentsDialogComponent`
- Modified `openImageDialog()` method to check for `showOverlay` input
- Modified `openEventPage()` method to check for `showOverlay` input
- When `showOverlay` is true, both methods now open the split-view dialog instead of navigating or showing the simple image preview

### 3. Video Event Component Updates

**Location:** `src/app/components/event-types/video-event.component.ts`

**Changes:**
- Added import for `MediaWithCommentsDialogComponent` and `MatDialog`
- Modified `expandVideo()` method to check for `showOverlay` input
- Modified `openEventPage()` method to check for `showOverlay` input
- When `showOverlay` is true, both methods now open the split-view dialog instead of expanding inline or navigating

### 4. Comments List Component Enhancement

**Location:** `src/app/components/comments-list/comments-list.component.ts`

**Changes:**
- Added new `autoExpand` input parameter (boolean, default false)
- Updated `ngAfterViewInit()` to check `autoExpand` and automatically load and display comments
- This ensures comments are immediately visible in the dialog without user interaction

### 5. Global Dialog Styles

**Location:** `src/styles.scss`

**Added:**
- Styles for `.media-with-comments-dialog` class
- Responsive styles for mobile (max-width: 900px) to make dialog full-screen
- Proper overflow and padding handling for the dialog container

## Layout Details

### Desktop Layout (> 900px)
- **Grid layout**: `1fr 400px` (media takes remaining space, comments fixed at 400px)
- **Dialog dimensions**: 1400px width, 90vh height
- **Media side**: Centered with padding, scrollable if content exceeds viewport
- **Comments side**: Fixed width with header and scrollable content area

### Tablet Layout (901px - 1200px)
- **Grid layout**: `1fr 350px` (narrower comments sidebar)

### Mobile Layout (≤ 900px)
- **Grid layout**: `1fr / auto` (stacked vertically)
- **Media side**: Takes available space
- **Comments side**: Limited to 50vh max-height with scrolling
- **Dialog**: Full-screen (100vw x 100vh)

## User Experience

### Profile Media Page
1. User navigates to a profile's media tab
2. Media items are displayed in a grid with overlay indicators
3. Clicking on a photo or video opens the split-view dialog
4. User can view the media and read/write comments simultaneously
5. Close button or ESC key closes the dialog

### Dialog Features
- **Photo events**: Display with carousel support for multiple images
- **Video events**: Display with play controls and thumbnail
- **Comments**: Auto-load and display on the right side
- **Responsive**: Adapts layout based on screen size
- **Accessible**: Keyboard navigation and ARIA labels

## Technical Notes

- The dialog uses Angular Material's `MatDialog` service
- Panel class `media-with-comments-dialog` is used for styling
- Comments automatically expand via the `autoExpand` input
- The `showOverlay` input determines whether to show the split-view dialog or use default behavior
- All existing functionality (navigation, simple preview) is preserved when `showOverlay` is false

## Browser Compatibility

The implementation uses modern CSS features:
- CSS Grid for layout
- CSS variables for theming
- Backdrop-filter for blur effects (with webkit prefix where needed)
- Responsive with media queries

All features degrade gracefully in older browsers.
