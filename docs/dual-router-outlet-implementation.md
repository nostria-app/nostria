# Dual Router-Outlet Layout Implementation

## Overview

Implemented a side-by-side dual router-outlet layout for the feeds page, allowing events and profiles to be displayed alongside the feeds without leaving the page.

## Changes Made

### 1. App Template (app.html)
- Added conditional rendering based on `layout.useDualOutletLayout()` signal
- Implemented two-column layout with:
  - Left outlet: Main primary router-outlet (for feeds)
  - Right outlet: Named "detail" router-outlet (for events/profiles)
- Both outlets render side-by-side on desktop, with right outlet taking precedence on mobile

### 2. App Styles (app.scss)
- Added `.dual-outlet-container` with flexbox layout
- Set equal width (flex: 1) for both left and right outlet wrappers
- Centered container with max-width of 1800px
- Added subtle border separation between outlets
- Mobile responsive: stacks vertically and hides left outlet when right is active

### 3. Routing Configuration (app.routes.ts)
- Marked feeds routes with `useDualOutlet: true` in route data
- Added named outlet routes for 'detail' outlet:
  - `e/:id` (events)
  - `p/:id` (profiles)
  - `u/:username` (profiles by username)
- Kept standard routes for direct access (non-feeds navigation)

### 4. Layout Service (layout.service.ts)
- Added `useDualOutletLayout` signal to track layout state
- Updated `openGenericEvent()` to navigate to detail outlet when on feeds
- Updated `openProfile()` to navigate to detail outlet when on feeds
- Falls back to dialog for profiles/people pages, standard navigation elsewhere

### 5. App Component (app.ts)
- Subscribe to router events to detect feeds page navigation
- Automatically enable/disable dual outlet layout based on current route
- Clear detail outlet when navigating away from feeds pages

## User Experience

### On Feeds Page
- Click an event → Opens in right panel alongside feeds
- Click a profile → Opens in right panel alongside feeds
- Feeds remain loaded and scrollable on the left
- Close detail by navigating to Music or other main features

### Desktop (≥1024px)
- Two equal-width columns, centered together
- Maximum combined width of 1800px
- Visual separation with subtle border

### Mobile (<1024px)
- Right outlet (detail) takes full width when active
- Left outlet (feeds) hidden when detail is shown
- Automatic fallback to single-column view

## Benefits

1. **Context Preservation**: Feeds stay loaded while browsing events
2. **Improved Navigation**: Easy to view multiple posts without losing place
3. **Better UX**: Similar to Twitter/X's side-by-side view
4. **Backward Compatible**: Standard navigation still works for direct links
5. **Responsive**: Gracefully adapts to mobile screens

## Technical Notes

- Uses Angular's named router outlets feature
- Leverages signals for reactive layout state management
- No breaking changes to existing routing
- Detail outlet cleared automatically on navigation to non-feeds pages
