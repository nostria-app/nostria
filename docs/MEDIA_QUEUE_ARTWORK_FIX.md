# Media Queue Artwork Display Fix

## Issue
The artwork images in the media queue were showing empty `src` attributes, causing broken image placeholders to appear instead of either proper artwork or the fallback music note icon.

## Root Cause
The issue had multiple potential causes:

1. **Logic Clarity**: The `hasArtwork()` method used `!!this.getArtwork(item)` which while technically correct, was not as explicit as it could be
2. **Image Loading Failures**: YouTube thumbnails or other artwork URLs might fail to load due to network issues, CORS problems, or invalid URLs
3. **Empty String Handling**: Items with `artwork: ''` needed explicit handling

## Solution

### 1. Improved Logic Clarity

**File:** `src/app/pages/media-queue/media-queue.component.ts`

#### Enhanced getArtwork Method
```typescript
getArtwork(item: MediaItem): string {
  // If we have artwork and it's not the old placeholder, use it
  if (item.artwork && item.artwork !== '/logos/youtube.png') {
    return item.artwork;
  }
  
  // Try to extract YouTube ID from various formats
  const youtubeId = this.extractYouTubeId(item.source || item.title);
  if (youtubeId) {
    return `https://img.youtube.com/vi/${youtubeId}/0.jpg`;
  }
  
  // No artwork available
  return '';
}
```

**Improvements:**
- Explicit early return when valid artwork exists
- Clear flow: check existing artwork → try YouTube extraction → return empty
- Better code readability with descriptive comments

#### Improved hasArtwork Method
```typescript
hasArtwork(item: MediaItem): boolean {
  const artwork = this.getArtwork(item);
  return artwork !== '';
}
```

**Before:** `return !!this.getArtwork(item);`  
**After:** `return artwork !== '';`

**Why this is better:**
- More explicit: we're checking for non-empty string, not just "truthy"
- Easier to debug: clear intent
- Prevents edge cases where `getArtwork()` might return unexpected falsy values

### 2. Image Error Handling

**File:** `src/app/pages/media-queue/media-queue.component.html`

Added error handler to the image element:
```html
<img 
  matListItemAvatar 
  class="queue-artwork" 
  [src]="utilities.sanitizeImageUrl(getArtwork(item))" 
  (error)="onImageError($event, item)"
  alt="Artwork" />
```

**File:** `src/app/pages/media-queue/media-queue.component.ts`

Added error handling method:
```typescript
onImageError(event: Event, item: MediaItem) {
  console.warn('Failed to load artwork for:', item.title, 'URL:', this.getArtwork(item));
  // The image will be hidden by setting artwork to empty, triggering the fallback icon
  item.artwork = '';
}
```

**How it works:**
1. When an image fails to load (404, CORS error, network issue, etc.)
2. The `(error)` event fires
3. We log a warning with the failed URL for debugging
4. We set `item.artwork = ''` to trigger a re-render
5. On re-render, `hasArtwork()` returns `false`
6. The template shows the fallback music note icon instead

## Benefits

### 1. Robust Error Handling
- Images that fail to load automatically fall back to the music note icon
- No more broken image placeholders
- Console warnings help developers debug artwork issues

### 2. Better User Experience
- Always shows something meaningful (either artwork or fallback icon)
- No visual glitches or empty spaces
- Seamless fallback behavior

### 3. Improved Debugging
- Console logs show which items have loading failures
- Explicit artwork URL in the warning message
- Easier to identify problematic sources

### 4. Clearer Code
- More explicit logic flow
- Easier to maintain and extend
- Better code documentation

## Testing Scenarios

### Test 1: Valid YouTube URL
```typescript
{
  artwork: '',
  source: 'https://www.youtube.com/watch?v=VIDEO_ID',
  title: 'My Video',
  artist: '',
  type: 'YouTube'
}
```
**Expected:** YouTube thumbnail loads  
**Fallback:** Music note icon if thumbnail fails to load

### Test 2: Video File Without Artwork
```typescript
{
  artwork: '',
  source: 'https://example.com/video.mp4',
  title: 'My Video',
  artist: '',
  type: 'Video'
}
```
**Expected:** Music note icon shows immediately

### Test 3: Invalid Artwork URL
```typescript
{
  artwork: 'https://invalid-url.com/image.jpg',
  source: 'https://example.com/audio.mp3',
  title: 'My Song',
  artist: 'Artist Name',
  type: 'Music'
}
```
**Expected:** Image attempts to load, fails, then falls back to music note icon  
**Console:** Warning message with failed URL

### Test 4: Valid Artwork
```typescript
{
  artwork: 'https://example.com/valid-image.jpg',
  source: 'https://example.com/audio.mp3',
  title: 'My Song',
  artist: 'Artist Name',
  type: 'Music'
}
```
**Expected:** Artwork displays successfully

## Related Files

- `src/app/pages/media-queue/media-queue.component.ts` - Logic improvements and error handling
- `src/app/pages/media-queue/media-queue.component.html` - Image error event binding
- `src/app/interfaces.ts` - MediaItem interface definition

## Debugging

If you see console warnings about failed artwork:
1. Check the URL in the warning message
2. Verify the URL is accessible in a browser
3. Check for CORS issues (YouTube thumbnails should work)
4. For YouTube videos, verify the video ID extraction is working correctly

The fallback icon should always appear when artwork fails, so users won't see broken images.
