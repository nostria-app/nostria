# Media Dialog Photo Zoom Implementation

## Overview
Added clickable photo zoom functionality to the Media with Comments Dialog, allowing users to click on photos to view them in full-screen or preview mode.

## Changes Made

### 1. MediaWithCommentsDialogComponent

#### TypeScript (`media-with-comments-dialog.component.ts`)
- **Added imports**: `MatDialog`, `ImageDialogComponent`, `MediaPreviewDialogComponent`
- **Injected MatDialog service**: `private dialog = inject(MatDialog);`
- **Implemented `openImagePreview()` method**:
  - Checks if multiple images exist using `imageUrls().length`
  - For multiple images: Opens `MediaPreviewDialogComponent` with all images and current index
  - For single image: Opens `ImageDialogComponent` with the current image URL
  - Maintains title/alt text for accessibility

#### HTML Template (`media-with-comments-dialog.component.html`)
- **Made photo container clickable**:
  - Added `(click)="openImagePreview()"` to `.photo-container`
  - Added `clickable` CSS class for cursor styling
  - Added `$event.stopPropagation()` to navigation buttons and indicator dots to prevent triggering zoom when navigating carousel

#### Styles (`media-with-comments-dialog.component.scss`)
- **Added clickable styling**:
  ```scss
  .photo-container {
    &.clickable {
      cursor: pointer;
    }
  }
  ```

## User Experience

### Before
- Photos in the media dialog were static
- No way to zoom or view photos in full-screen from the dialog
- Users had to close dialog and click photo elsewhere to zoom

### After
- Clicking on any photo in the dialog opens zoom/preview
- Single photos open in `ImageDialogComponent` for full-screen viewing
- Multiple photos open in `MediaPreviewDialogComponent` carousel at the current index
- Navigation buttons (prev/next/dots) don't trigger zoom due to event propagation stopping
- Cursor changes to pointer to indicate clickability

## Technical Details

### Dialog Opening Logic
```typescript
openImagePreview(): void {
  const imageUrls = this.imageUrls();
  const currentIndex = this.currentImageIndex();

  if (imageUrls.length > 1) {
    // Multiple images - carousel preview
    const mediaItems = imageUrls.map((url, index) => ({
      url,
      type: 'image/jpeg',
      title: this.title() || `Photo ${index + 1}`,
    }));

    this.dialog.open(MediaPreviewDialogComponent, {
      data: { mediaItems, initialIndex: currentIndex },
      maxWidth: '100vw',
      maxHeight: '100vh',
      panelClass: 'media-preview-dialog',
    });
  } else if (imageUrls.length === 1) {
    // Single image - full-screen view
    this.dialog.open(ImageDialogComponent, {
      data: { 
        imageUrl: imageUrls[0],
        alt: this.title() || 'Photo'
      },
      maxWidth: '95vw',
      maxHeight: '95vh',
      panelClass: 'image-dialog-panel',
    });
  }
}
```

### Event Propagation Handling
- Navigation buttons and carousel indicators call `$event.stopPropagation()` to prevent clicks from bubbling to the photo container
- This ensures clicking navigation doesn't accidentally trigger the zoom dialog

## Related Components
- `ImageDialogComponent`: Full-screen single image viewer
- `MediaPreviewDialogComponent`: Multi-image carousel viewer
- `PhotoEventComponent`: Original photo event component with similar zoom behavior

## Notes
- Implementation follows the same pattern as `PhotoEventComponent.openImageDialog()`
- No need to check `showOverlay()` in dialog context since it's always in preview mode
- Maintains consistency with existing zoom behavior across the application
