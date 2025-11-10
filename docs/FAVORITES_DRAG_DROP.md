# Favorites Drag-and-Drop Reordering

## Overview
Added drag-and-drop functionality to the favorites sidebar, allowing users to reorder their favorites to customize prioritization. The top 5 favorites appear in the preview, so reordering affects which profiles are shown in the preview.

## Implementation

### Component Changes
**`favorites-overlay.component.ts`**
- Imported Angular CDK Drag-Drop module: `CdkDragDrop`, `DragDropModule`, `moveItemInArray`
- Added `onFavoriteDrop()` handler that:
  - Validates the position changed
  - Creates a reordered copy of the favorites array
  - Calls `FavoritesService.reorderFavorites()` to persist the new order
  - Triggers reactivity through the existing `favoritesVersion` signal

### Service Changes
**`favorites.service.ts`**
- Added `reorderFavorites(newOrder: string[])` method
- Validates the new order matches the current favorites (same length and pubkeys)
- Updates localStorage via `AccountLocalStateService`
- Increments `favoritesVersion` signal to trigger reactive updates

### Template Changes
**`favorites-overlay.component.html`**
- Added `cdkDropList` directive to the `.favorites-grid` container
- Added `cdkDrag` directive to each `.favorite-item` button
- Bound `(cdkDropListDropped)` event to `onFavoriteDrop()` handler

### Style Changes
**`favorites-overlay.component.scss`**
- Added drag preview styles with elevated shadow and opacity
- Added placeholder styles with dashed border during drag
- Added smooth animations for item transitions
- Changed cursor to `grab` on hover and `grabbing` when dragging

## User Experience
- Users can drag favorites by clicking and holding any favorite item
- Visual feedback shows:
  - Grab cursor on hover
  - Grabbing cursor while dragging  
  - Semi-transparent preview while dragging
  - Dashed placeholder in the grid showing where item will drop
- Smooth animations when items rearrange
- Order persists to localStorage per account
- Top 5 in the new order appear in the preview

## Technical Notes
- Uses Angular CDK's drag-drop module (lightweight, built-in)
- Maintains existing reactivity pattern with `favoritesVersion` signal
- Validates order integrity before persisting
- Only applies to Favorites section, not Following section
