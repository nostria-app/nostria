# Media Queue Improvements

## Overview
Enhanced the media queue component to properly display YouTube video thumbnails and provide better fallback handling when artwork is unavailable.

## Changes Made

### 1. YouTube Thumbnail Support

**File:** `src/app/pages/media-queue/media-queue.component.ts`

#### Added YouTube ID Extraction Method
```typescript
private extractYouTubeId(url: string): string | null {
  if (!url) return null;
  
  // Handle youtube.com/embed/ format
  const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]+)/);
  if (embedMatch) return embedMatch[1];
  
  // Handle youtube.com/watch?v= format
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
  if (watchMatch) return watchMatch[1];
  
  // Handle youtu.be/ format
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  if (shortMatch) return shortMatch[1];
  
  return null;
}
```

This method handles three common YouTube URL formats:
- **Embed format:** `https://www.youtube.com/embed/VIDEO_ID`
- **Watch format:** `https://www.youtube.com/watch?v=VIDEO_ID`
- **Short format:** `https://youtu.be/VIDEO_ID`

#### Enhanced getArtwork Method
```typescript
getArtwork(item: MediaItem): string {
  if (!item.artwork || item.artwork === '/logos/youtube.png') {
    // Try to extract YouTube ID from various formats
    const youtubeId = this.extractYouTubeId(item.source || item.title);
    if (youtubeId) {
      return `https://img.youtube.com/vi/${youtubeId}/0.jpg`;
    }
  }
  return item.artwork || '';
}
```

The method now:
1. Checks if artwork is missing or is the old placeholder logo
2. Attempts to extract YouTube video ID from the source URL or title
3. Returns a proper YouTube thumbnail URL using the format: `https://img.youtube.com/vi/{VIDEO_ID}/0.jpg`
4. Falls back to the existing artwork or empty string

#### Updated addQueue Method
```typescript
// YouTube URL detection
if (result.url.indexOf('youtu.be') > -1 || result.url.indexOf('youtube.com') > -1) {
  const youtubes = [...result.url.matchAll(this.utilities.regexpYouTube)];
  const youtube = youtubes.map(i => {
    return { 
      url: `https://www.youtube.com/embed/${i[1]}`,
      id: i[1]
    };
  });

  for (const video of youtube) {
    this.media.enque({
      artist: '',
      artwork: `https://img.youtube.com/vi/${video.id}/0.jpg`,
      title: video.url,
      source: video.url,
      type: 'YouTube',
    });
  }
}
```

When adding YouTube videos to the queue:
- Extracts video ID during the enqueue process
- Sets artwork to proper YouTube thumbnail URL immediately
- Uses for-of loop (lint-compliant)

### 2. Fallback Icon Support

**File:** `src/app/pages/media-queue/media-queue.component.html`

The template already includes proper fallback handling:
```html
@if (hasArtwork(item)) {
  <img matListItemAvatar class="queue-artwork" 
       [src]="utilities.sanitizeImageUrl(getArtwork(item))" 
       alt="Artwork" />
} @else {
  <mat-icon matListItemAvatar class="queue-artwork-icon">music_note</mat-icon>
}
```

When artwork is unavailable or fails to load, a Material icon (`music_note`) is displayed instead.

### 3. Code Quality Improvements

**Removed empty lifecycle methods:**
- Removed empty `constructor()`
- Removed empty `ngOnInit()` with commented code
- Removed unnecessary `OnInit` interface implementation

**Result:** Cleaner, more maintainable code with no lint errors.

## YouTube Thumbnail API

This implementation uses YouTube's official thumbnail API endpoint:

```
https://img.youtube.com/vi/{VIDEO_ID}/0.jpg
```

### Available Thumbnail Sizes
- `0.jpg` - Full size (1280x720)
- `1.jpg`, `2.jpg`, `3.jpg` - Small thumbnails (120x90)
- `default.jpg` - Default quality (120x90)
- `mqdefault.jpg` - Medium quality (320x180)
- `hqdefault.jpg` - High quality (480x360)
- `sddefault.jpg` - Standard definition (640x480)
- `maxresdefault.jpg` - Maximum resolution (1920x1080, if available)

We use `0.jpg` for the best quality that's always available.

## Benefits

1. **Better User Experience:** YouTube videos now show proper thumbnails instead of generic logos
2. **Fallback Handling:** Music note icon appears when artwork is unavailable
3. **Format Support:** Handles multiple YouTube URL formats (youtube.com, youtu.be, embed URLs)
4. **Backward Compatible:** Existing non-YouTube media items continue to work as before
5. **Clean Code:** Removed lint errors and empty methods

## Testing

To test the improvements:

1. Add a YouTube video using any of these URL formats:
   - `https://www.youtube.com/watch?v=VIDEO_ID`
   - `https://youtu.be/VIDEO_ID`
   - `https://www.youtube.com/embed/VIDEO_ID`

2. Verify that the proper video thumbnail appears in the media queue

3. Add a media item with no artwork to verify the music note fallback icon appears

## Related Files

- `src/app/pages/media-queue/media-queue.component.ts` - Main component logic
- `src/app/pages/media-queue/media-queue.component.html` - Template with fallback handling
- `src/app/services/utilities.service.ts` - Contains `regexpYouTube` pattern for URL matching
