# Search Bar UI Improvements

## Overview
Enhanced the search bar in the main toolbar to provide more space and a cleaner, more integrated look by hiding other toolbar icons and positioning action buttons inside the search input.

## Changes Made

### 1. Hide Icons When Search is Active
When the search input is opened (`layout.search()` is true), the following icons are now hidden to provide more space:
- Notification icon (bell)
- Apps menu icon (grid)
- Profile icon (avatar/account circle)
- Update button
- Profile caching indicator
- Publishing indicator

### 2. Integrated Action Buttons
The QR code scanner and close buttons are now positioned **inside** the search input field instead of as separate toolbar buttons:
- Both buttons appear on the right side of the search input
- QR scanner button is positioned first (left)
- Close button is positioned last (right)
- Buttons have a clean, integrated appearance within the rounded search input

### 3. Styling Details
- Search input has increased right padding (96px) to accommodate the two buttons
- Action buttons are absolutely positioned within the search container
- Button sizes: 40x40px for a compact appearance
- Icon sizes: 20x20px
- QR button positioned at `right: 48px`
- Close button positioned at `right: 4px`
- Buttons inherit theme colors and maintain hover states

## Technical Implementation

### HTML Changes (`app.html`)
- Moved QR and close buttons inside the `.search-container` div
- Added `.search-action-button` class with specific positioning classes
- Added `!layout.search()` condition to notification, apps, and profile button visibility

### SCSS Changes (`app.scss`)
- Updated `.search-container` to use flexbox layout
- Increased search input right padding for button space
- Added `.search-action-button` styles with absolute positioning
- Added specific positioning for `.qr-button` and `.close-button`

## User Experience Benefits
1. **More Search Space**: By hiding unnecessary icons, the search input can expand fully
2. **Cleaner Interface**: Action buttons integrated within the search input create a more polished look
3. **Better Focus**: Reduced visual clutter when searching helps users focus on their search task
4. **Intuitive Controls**: Buttons positioned inside the input follow common search UI patterns
