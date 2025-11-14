# On-the-Fly Blurhash Generation for Media Privacy

## Overview

This document describes the implementation of on-the-fly blurhash generation for images and videos that don't have a blurhash in their `imeta` tags. This feature ensures that when "Always Blur" or "Blur Non-Following" media privacy modes are enabled, all media content can be properly blurred even if it lacks pre-generated blurhash data.

## Problem

The media privacy feature allows users to:
- **Show Always**: Display all media immediately
- **Blur Non-Following**: Blur media from accounts you don't follow
- **Always Blur**: Blur all media by default

Previously, the blur effect relied on blurhash values stored in the event's `imeta` tags. However, many events don't include blurhash data, which meant:
- Images without blurhash would show a blank placeholder when blurred
- The blur effect was inconsistent across different content
- Users couldn't get a proper preview of what the blurred content looks like

## Solution

We implemented client-side blurhash generation using the existing `UtilitiesService.generateBlurhash()` method. When blur mode is active and an image/video lacks a blurhash, the application automatically generates one on-the-fly.

## Implementation Details

### 1. Photo Event Component (`photo-event.component.ts`)

**Changes:**
- Added `UtilitiesService` injection
- Added `generatedBlurhashes` signal to store runtime-generated blurhashes
- Added effect that triggers blurhash generation when blur is needed
- Updated `blurhashes` computed to prioritize tag blurhashes, then fall back to generated ones
- Added `generateBlurhashForImage()` method

**Key Code:**
```typescript
// Store generated blurhashes for images without imeta blurhash
private generatedBlurhashes = signal<Map<string, string>>(new Map());

constructor() {
  // Generate blurhashes on-the-fly when needed
  effect(() => {
    const shouldBlur = this.shouldBlurMedia();
    const imageUrls = this.imageUrls();
    const blurhashes = this.blurhashes();

    // Only generate if we should blur and there are missing blurhashes
    if (shouldBlur) {
      imageUrls.forEach((url, index) => {
        if (!blurhashes[index] && !this.generatedBlurhashes().has(url)) {
          this.generateBlurhashForImage(url);
        }
      });
    }
  });
}

// Computed blurhashes for all images
blurhashes = computed(() => {
  const event = this.event();
  if (!event) return [];

  const imageUrls = this.imageUrls();
  const generated = this.generatedBlurhashes();
  
  return imageUrls.map((url, index) => {
    // First try to get blurhash from event tags
    const tagBlurhash = this.getBlurhash(event, index);
    if (tagBlurhash) return tagBlurhash;
    
    // Otherwise, use generated blurhash if available
    return generated.get(url) || null;
  });
});

private async generateBlurhashForImage(url: string): Promise<void> {
  try {
    const result = await this.utilities.generateBlurhash(url, 4, 3);
    
    this.generatedBlurhashes.update(map => {
      const newMap = new Map(map);
      newMap.set(url, result.blurhash);
      return newMap;
    });
  } catch (error) {
    console.warn('Failed to generate blurhash for image:', url, error);
  }
}
```

### 2. Video Event Component (`video-event.component.ts`)

**Changes:**
- Added `UtilitiesService` injection
- Added `generatedBlurhash` signal to store runtime-generated blurhash for thumbnail
- Added effect that triggers blurhash generation when blur is needed
- Updated `blurhashDataUrl` computed to prioritize tag blurhash, then fall back to generated one
- Added `generateBlurhashForThumbnail()` method

**Key Code:**
```typescript
// Store generated blurhashes for thumbnails without blurhash
private generatedBlurhash = signal<string | null>(null);

constructor() {
  // Generate blurhash on-the-fly when needed
  effect(() => {
    const shouldBlur = this.shouldBlurMedia();
    const videoInfo = this.videoData();

    // Only generate if we should blur, there's a thumbnail, and no existing blurhash
    if (shouldBlur && videoInfo?.thumbnail && !videoInfo.blurhash && !this.generatedBlurhash()) {
      this.generateBlurhashForThumbnail(videoInfo.thumbnail);
    }
  });
}

// Computed blurhash data URL for performance
blurhashDataUrl = computed(() => {
  const videoInfo = this.videoData();
  
  // Use tag blurhash if available
  if (videoInfo?.blurhash) {
    return this.generateBlurhashDataUrl(videoInfo.blurhash, 400, 225);
  }
  
  // Otherwise use generated blurhash if available
  const generated = this.generatedBlurhash();
  if (generated) {
    return this.generateBlurhashDataUrl(generated, 400, 225);
  }
  
  return null;
});

private async generateBlurhashForThumbnail(thumbnailUrl: string): Promise<void> {
  try {
    const result = await this.utilities.generateBlurhash(thumbnailUrl, 4, 3);
    this.generatedBlurhash.set(result.blurhash);
  } catch (error) {
    console.warn('Failed to generate blurhash for video thumbnail:', thumbnailUrl, error);
  }
}
```

### 3. Note Content Component (`note-content.component.ts`)

**Changes:**
- Added `SettingsService`, `AccountStateService`, and blurhash `decode` import
- Added `authorPubkey` input to determine if content should be blurred
- Added `generatedBlurhashes` signal to store runtime-generated blurhashes
- Added `revealedImages` signal to track which images/videos have been revealed
- Added `shouldBlurImages` computed based on privacy settings
- Added effect that triggers blurhash generation for image and video tokens
- Updated `openImageDialog()` to reveal images instead of opening when blurred
- Added helper methods: `isImageRevealed()`, `revealImage()`, `getBlurhashDataUrl()`, `generateBlurhashForImage()`, `generateBlurhashForVideo()`

**Template Changes (`note-content.component.html`):**

For images:
```html
} @else if (token.type === 'image') {
<div class="media-container image-container" 
     [class.blurred]="shouldBlurImages() && !isImageRevealed(token.content)"
     [class.revealing]="shouldBlurImages() && isImageRevealed(token.content)">
  @if (shouldBlurImages() && getBlurhashDataUrl(token.content); as blurhashUrl) {
  <img [src]="blurhashUrl" alt="Blurred preview" class="blurhash-placeholder" loading="lazy" />
  }
  <img [src]="token.content" 
       alt="Content image" 
       loading="lazy" 
       (click)="openImageDialog(token.content)"
       [class.clickable-image]="!shouldBlurImages() || isImageRevealed(token.content)"
       [class.hidden]="shouldBlurImages() && !isImageRevealed(token.content)" />
  @if (shouldBlurImages() && !isImageRevealed(token.content)) {
  <div class="reveal-overlay" (click)="revealImage(token.content); $event.stopPropagation()">
    <mat-icon>visibility</mat-icon>
    <span>Click to reveal</span>
  </div>
  }
</div>
```

For videos (new):
```html
} @else if (token.type === 'video') {
<div class="media-container video-container" 
     [class.blurred]="shouldBlurImages() && !isImageRevealed(token.content)"
     [class.revealing]="shouldBlurImages() && isImageRevealed(token.content)">
  @if (shouldBlurImages() && getBlurhashDataUrl(token.content); as blurhashUrl) {
  <img [src]="blurhashUrl" alt="Blurred preview" class="blurhash-placeholder" loading="lazy" />
  }
  <video controls [class.hidden]="shouldBlurImages() && !isImageRevealed(token.content)">
    <source [src]="token.content" type="video/{{ getVideoType(token.content) }}" />
    Your browser does not support the video element.
  </video>
  @if (shouldBlurImages() && !isImageRevealed(token.content)) {
  <div class="reveal-overlay" (click)="revealImage(token.content); $event.stopPropagation()">
    <mat-icon>visibility</mat-icon>
    <span>Click to reveal</span>
  </div>
  }
</div>
```

**Video Blurhash Generation:**

For videos in regular events, the component extracts the first frame (at 1 second) to generate a thumbnail, then creates a blurhash from that thumbnail:

```typescript
private async generateBlurhashForVideo(url: string): Promise<void> {
  try {
    // Extract thumbnail from video at 1 second
    const thumbnailResult = await this.utilities.extractThumbnailFromVideo(url, 1);
    
    // Generate blurhash from the thumbnail blob
    const result = await this.utilities.generateBlurhash(thumbnailResult.blob, 4, 3);

    this.generatedBlurhashes.update(map => {
      const newMap = new Map(map);
      newMap.set(url, result.blurhash);
      return newMap;
    });
    
    // Clean up the object URL
    URL.revokeObjectURL(thumbnailResult.objectUrl);
  } catch (error) {
    console.warn('Failed to generate blurhash for video:', url, error);
  }
}
```

**Styles Updated (`note-content.component.scss`):**
```scss
.image-container,
.video-container {
  position: relative;
  overflow: hidden;
  display: inline-block;
  max-width: 100%;

  video,
  img {
    display: block;
    max-width: 100%;
    height: auto;
  }

  .blurhash-placeholder {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    opacity: 0;
    transition: opacity 0.3s ease;
    pointer-events: none;
  }

  &.blurred {
    .blurhash-placeholder {
      opacity: 1 !important;
      filter: blur(20px);
    }

    .hidden {
      opacity: 0;
    }
  }

  &.revealing {
    .blurhash-placeholder {
      opacity: 0;
      transition: opacity 0.6s ease-out;
    }

    img:not(.blurhash-placeholder),
    video {
      opacity: 1;
      transition: opacity 0.6s ease-out;
    }
  }

  .reveal-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    color: white;
    cursor: pointer;
    -webkit-backdrop-filter: blur(2px);
    backdrop-filter: blur(2px);
    transition: background-color 0.3s ease;

    &:hover {
      background: rgba(0, 0, 0, 0.7);
    }

    mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      margin-bottom: 8px;
    }

    span {
      font-size: 14px;
      font-weight: 500;
    }
  }
}
```

### 4. Content Component Updates

**Changes to `content.component.html`:**
- Updated `app-note-content` usage to pass `authorPubkey` input
- Main content: `[authorPubkey]="event()?.pubkey"`
- Mentioned events: `[authorPubkey]="mention.event.event.pubkey"`

## Blurhash Generation Parameters

The blurhash generation uses the following parameters optimized for performance and visual quality:

- **Component X**: 4 (horizontal detail)
- **Component Y**: 3 (vertical detail)
- **Canvas size**: 64x64 pixels (scaled to maintain aspect ratio)

These parameters balance quality and performance for on-the-fly generation.

## Performance Considerations

1. **Lazy Generation**: Blurhashes are only generated when blur mode is active
2. **Caching**: Generated blurhashes are stored in signals to avoid regeneration
3. **Effect Guards**: The effect checks if a blurhash already exists before generating
4. **Async Processing**: Generation happens asynchronously to avoid blocking the UI

## User Experience Flow

1. User enables "Always Blur" or "Blur Non-Following" in settings
2. When viewing content with images/videos:
   - If media has blurhash in tags: Use existing blurhash immediately
   - If media lacks blurhash: Generate one on-the-fly
3. User sees blurred preview with "Click to reveal" overlay
4. User clicks to reveal individual images/videos
5. Smooth transition from blurred to clear

## Benefits

- **Consistent UX**: All media can be blurred regardless of blurhash availability
- **Privacy**: Users can protect themselves from unwanted content
- **Performance**: Only generates blurhash when needed
- **Backwards Compatible**: Works with both old and new events
- **No Server Changes**: All processing happens client-side

## Testing

To test this feature:

1. Go to Settings → General → Media Privacy
2. Select "Always Blur Media"
3. View posts with images (both with and without imeta blurhash tags)
4. Verify all images show blurred previews
5. Click "Click to reveal" to unblur individual images
6. Verify smooth transition animation

## Future Improvements

Potential enhancements:
- Cache generated blurhashes in IndexedDB for persistence
- Pre-generate blurhashes for timeline images in the background
- Allow users to adjust blur intensity
- Add option to auto-reveal after X seconds
