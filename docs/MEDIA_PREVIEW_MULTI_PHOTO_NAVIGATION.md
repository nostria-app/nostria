# Media Preview Multi-Photo Navigation

## Overview
Enhanced the media preview dialog to support navigation between multiple photos when viewing photo events (NIP-68 kind 20 events). The feature includes visual navigation controls, keyboard shortcuts, and touch/swipe gestures.

## Implementation

### Components Modified

#### 1. MediaPreviewDialogComponent
**File:** `src/app/components/media-preview-dialog/media-preview.component.ts`

##### Interface Changes
- Updated `MediaPreviewData` interface to support both single and multiple media items
- Added `MediaItem` interface for structured media data
- New properties:
  - `mediaItems?: MediaItem[]` - Array of media items to display
  - `initialIndex?: number` - Starting index for multi-media viewing

##### Component Features
- **State Management:**
  - `currentIndex` signal tracks the currently displayed photo
  - `mediaItems` computed property normalizes single/multiple media to array
  - `currentMedia` computed property returns the active media item
  - `hasMultipleItems`, `hasPrevious`, `hasNext` computed properties for navigation state

- **Navigation Methods:**
  - `next()` - Navigate to next photo
  - `previous()` - Navigate to previous photo
  - `goToIndex(index)` - Jump to specific photo

- **Keyboard Navigation:**
  - `ArrowLeft` - Previous photo
  - `ArrowRight` - Next photo
  - `Escape` - Close dialog

- **Touch/Swipe Navigation:**
  - Swipe left - Next photo
  - Swipe right - Previous photo
  - 50px threshold for swipe detection
  - Touch event handlers: `onTouchStart()`, `onTouchEnd()`, `handleSwipe()`

#### 2. Media Preview Template
**File:** `src/app/components/media-preview-dialog/media-preview.component.html`

##### Navigation UI
- Center navigation controls in header toolbar:
  - Left chevron button (disabled when on first photo)
  - Photo counter display: "X / Y" format
  - Right chevron button (disabled when on last photo)
- Touch event handlers on container for swipe detection
- Only displays navigation UI when multiple items exist

#### 3. Media Preview Styles
**File:** `src/app/components/media-preview-dialog/media-preview.component.scss`

##### Added Styles
- `.navigation-controls` - Flexbox container for navigation elements
- `.media-counter` - Counter text styling with minimum width
- `.nav-button` - Navigation button styles with disabled state

#### 4. PhotoEventComponent
**File:** `src/app/components/event-types/photo-event.component.ts`

##### Modified Method: `openImageDialog()`
- Detects multiple images from `imageUrls()` computed property
- When multiple images exist:
  - Creates `mediaItems` array with all photos
  - Opens `MediaPreviewDialogComponent` with full array
  - Passes `initialIndex` to show clicked photo
- Falls back to `ImageDialogComponent` for single images

## Usage Example

### Photo Event with Multiple Images
```typescript
// When user clicks a photo in a NIP-68 kind 20 event
openImageDialog(imageUrl: string, alt: string): void {
  const imageUrls = this.imageUrls();
  const clickedIndex = imageUrls.indexOf(imageUrl);
  
  if (imageUrls.length > 1) {
    const mediaItems = imageUrls.map((url, index) => ({
      url,
      type: 'image/jpeg',
      title: altTexts[index] || `Photo ${index + 1}`,
    }));
    
    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaItems,
        initialIndex: clickedIndex,
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      panelClass: 'media-preview-dialog',
    });
  }
}
```

## NIP-68 Support
Properly parses `imeta` tags from kind 20 photo events:
- Extracts URLs from each `imeta` tag
- Retrieves per-image alt text
- Supports blurhash placeholders
- Maintains image order from event tags

## User Experience

### Navigation Methods
1. **Click Navigation:**
   - Click left/right chevron buttons in header
   
2. **Keyboard Navigation:**
   - Press left/right arrow keys to navigate
   - Press Escape to close dialog
   
3. **Touch Navigation:**
   - Swipe left/right on touch devices
   - 50px swipe threshold for activation

### Visual Feedback
- Navigation buttons disabled at boundaries
- Photo counter shows current position: "2 / 10"
- Smooth transitions between photos
- Video loading indicator resets on navigation

## Backward Compatibility
The implementation maintains full backward compatibility:
- Single media items continue to work with legacy data structure
- `mediaUrl`, `mediaType`, `mediaTitle` properties still supported
- Automatically converts single items to array internally
- No breaking changes to existing callers

## Technical Notes
- Uses Angular signals for reactive state management
- Computed properties ensure efficient reactivity
- Touch events use native browser TouchEvent API
- HostListener for keyboard events
- Material Design icon buttons for navigation
- Swipe detection implemented with threshold-based logic
