# Video Thumbnail Black Frame Fix

## Problem

When uploading videos in the note editor dialog, the extracted thumbnails were completely black. This didn't happen in the media publish dialog.

## Root Cause

The note editor was extracting thumbnails from the **uploaded video URL** (remote server) instead of from the **local File object**. The issue occurred because:

1. Video file was uploaded to media server first
2. Thumbnail extraction attempted from the remote URL immediately after upload
3. The video at the remote URL wasn't fully available/decoded yet
4. Result: Black frame when trying to draw video to canvas

## Solution

Changed the thumbnail extraction process to happen **before** uploading the video, using a local object URL created from the File object. This ensures the video is fully loaded in the browser before thumbnail extraction.

### Flow Comparison

**Before (Broken):**
```
1. Upload video file to server
2. Get back remote URL
3. Try to extract thumbnail from remote URL ❌ (black frame)
4. Upload thumbnail
5. Create metadata with imeta tag
```

**After (Fixed):**
```
1. Create local object URL from File object
2. Extract thumbnail from local video ✅ (proper frame)
3. Generate blurhash from thumbnail
4. Upload video file to server
5. Upload thumbnail to server
6. Create metadata with imeta tag
```

## Implementation Changes

### 1. Updated `uploadFiles()` Method

**Pre-extract thumbnail for videos before upload:**

```typescript
// Pre-extract thumbnail for videos using the local file
let thumbnailData:
  | {
      blob: Blob;
      dimensions: { width: number; height: number };
      blurhash: string;
    }
  | undefined;

if (file.type.startsWith('video/')) {
  try {
    this.snackBar.open('Extracting video thumbnail...', '', { duration: 2000 });

    // Create object URL from the local file for thumbnail extraction
    const localVideoUrl = URL.createObjectURL(file);

    // Extract thumbnail from the local video file
    const thumbnailResult = await this.utilities.extractThumbnailFromVideo(localVideoUrl, 1);

    // Generate blurhash from the thumbnail
    const thumbnailFile = new File([thumbnailResult.blob], 'thumbnail.jpg', {
      type: 'image/jpeg',
    });
    const blurhashResult = await this.utilities.generateBlurhash(thumbnailFile);

    thumbnailData = {
      blob: thumbnailResult.blob,
      dimensions: thumbnailResult.dimensions,
      blurhash: blurhashResult.blurhash,
    };

    // Clean up the local object URL
    URL.revokeObjectURL(localVideoUrl);
    URL.revokeObjectURL(thumbnailResult.objectUrl);
  } catch (error) {
    console.error('Failed to extract video thumbnail:', error);
    // Continue with upload even if thumbnail extraction fails
  }
}

// Then proceed with video upload
const result = await this.mediaService.uploadFile(file, ...);
```

### 2. Updated `extractMediaMetadata()` Method

**Added optional `thumbnailData` parameter:**

```typescript
private async extractMediaMetadata(
  file: File,
  url: string,
  sha256?: string,
  mirrors?: string[],
  thumbnailData?: {  // NEW: Pre-extracted thumbnail data
    blob: Blob;
    dimensions: { width: number; height: number };
    blurhash: string;
  }
): Promise<MediaMetadata | null>
```

**Simplified video handling:**

```typescript
// Handle videos - use pre-extracted thumbnail data if available
if (file.type.startsWith('video/') && thumbnailData) {
  try {
    // Upload the thumbnail blob to get a permanent URL
    const thumbnailFile = new File([thumbnailData.blob], 'thumbnail.jpg', {
      type: 'image/jpeg',
    });

    const uploadResult = await this.mediaService.uploadFile(
      thumbnailFile,
      false,
      this.mediaService.mediaServers()
    );

    if (uploadResult.status === 'success' && uploadResult.item) {
      // Use pre-extracted blurhash and dimensions
      metadata.image = uploadResult.item.url;
      metadata.blurhash = thumbnailData.blurhash;
      metadata.dimensions = thumbnailData.dimensions;

      // Add thumbnail mirrors if available
      if (uploadResult.item.mirrors && uploadResult.item.mirrors.length > 0) {
        metadata.imageMirrors = uploadResult.item.mirrors;
      }
    }
  } catch (error) {
    console.error('Failed to upload video thumbnail:', error);
  }
}
```

## Key Improvements

1. **Proper Frame Extraction:** Thumbnails are now extracted from fully loaded local video files
2. **Better Performance:** Blurhash is calculated once during extraction, not after upload
3. **Cleaner Code:** Separation of concerns - thumbnail extraction happens before upload
4. **Error Resilience:** If thumbnail extraction fails, video upload continues normally
5. **Resource Cleanup:** Proper cleanup of temporary object URLs

## Benefits

- ✅ Thumbnails show actual video content (not black frames)
- ✅ Consistent behavior between note editor and media publish dialog
- ✅ Better user experience with progress indicators
- ✅ More efficient processing (extract once, upload once)

## Testing

### Test Case 1: Video Upload in Note Editor
1. Drag and drop a video file into the note editor
2. Wait for thumbnail extraction message
3. Verify thumbnail shows actual video content
4. Verify blurhash is generated
5. Verify imeta tag includes thumbnail URL

### Test Case 2: Multiple Video Uploads
1. Upload multiple videos simultaneously
2. Verify each gets its own thumbnail extracted
3. Verify no black frames in any thumbnail
4. Verify all imeta tags are correct

### Test Case 3: Video Upload Error Handling
1. Upload a corrupted video file
2. Verify thumbnail extraction fails gracefully
3. Verify video upload continues
4. Verify basic metadata is still created

## Related Files
- `src/app/components/note-editor-dialog/note-editor-dialog.component.ts` - Upload and metadata extraction
- `src/app/services/utilities.service.ts` - Thumbnail extraction utility
- `src/app/pages/media/media-publish-dialog/media-publish-dialog.component.ts` - Reference implementation

## Related Documentation
- `VIDEO_UPLOAD_IMETA_SUPPORT.md` - Initial video thumbnail support
- `IMETA_MIRROR_FALLBACK_SUPPORT.md` - Mirror URL support
- `MEDIA_UTILITIES_REFACTORING.md` - Centralized utilities
