# Video Upload Support in Note Editor - IMETA Enhancement

## Summary

Enhanced the note editor's IMETA tag support to handle video uploads with the same rich metadata as the media publish dialog.

## What Was Added

### For Video Uploads

When a user drags and drops a video file into the note editor, the system now:

1. **Uploads the video** to the configured media server
2. **Extracts a thumbnail** at the 1-second mark from the uploaded video
3. **Uploads the thumbnail** to the media server
4. **Generates blurhash** from the thumbnail for beautiful placeholders
5. **Includes SHA-256 hash** for file verification and deduplication
6. **Builds complete IMETA tag** with all metadata

### IMETA Tag Structure

#### Before (only basic metadata):
```json
[
  "imeta",
  "url https://mibo.eu.nostria.app/video.mp4",
  "m video/mp4"
]
```

#### After (full metadata):
```json
[
  "imeta",
  "url https://mibo.eu.nostria.app/video.mp4",
  "m video/mp4",
  "blurhash eVF$^OI:${M{o#*0-nNFxakD-?xVM}WEWB%iNKxvR-oetmo#R-aen$",
  "dim 1920x1080",
  "thumb https://mibo.eu.nostria.app/thumbnail.jpg",
  "x c0f1df387bd1ebdabfc80a2fd4f6e5f96ab185214b2c08f696f59ab76ebbefc2"
]
```

## Technical Implementation

### Updated Interface

```typescript
interface MediaMetadata {
  url: string;
  mimeType?: string;
  blurhash?: string;
  dimensions?: { width: number; height: number };
  alt?: string;
  sha256?: string; // SHA-256 hash from upload
  thumbnail?: string; // Thumbnail URL for videos
  thumbnailBlob?: Blob; // Thumbnail blob (temporary)
}
```

### Enhanced extractMediaMetadata Method

```typescript
private async extractMediaMetadata(
  file: File, 
  url: string, 
  sha256?: string
): Promise<MediaMetadata | null>
```

**For Images:**
- Uses existing `utilities.extractMediaMetadata()`
- Generates blurhash and dimensions
- Includes SHA-256 hash

**For Videos:**
- Extracts thumbnail at 1-second mark
- Uploads thumbnail to media server
- Generates blurhash from thumbnail
- Stores thumbnail dimensions
- Includes SHA-256 hash
- Cleans up temporary object URLs

### Upload Flow Enhancement

1. User drops video file
2. Video is uploaded to media server
3. Upload result includes:
   - `url`: Video URL
   - `sha256`: File hash
   - `type`: MIME type
   - `size`: File size
4. Metadata extraction begins:
   - Thumbnail extraction from video
   - Thumbnail upload to server
   - Blurhash generation from thumbnail
   - All metadata compiled
5. IMETA tag built with complete metadata
6. Tag added to event when publishing

## Files Modified

1. **note-editor-dialog.component.ts**
   - Enhanced `MediaMetadata` interface
   - Updated `extractMediaMetadata()` to handle videos
   - Added SHA-256 hash parameter
   - Added thumbnail extraction and upload logic

2. **NOTE_EDITOR_IMETA_SUPPORT.md**
   - Added video upload example
   - Updated benefits section
   - Documented video processing flow

## NIP Compliance

### NIP-92 (Media Attachments)
✅ `url` - Video URL  
✅ `m` - MIME type (video/mp4, etc.)  
✅ `blurhash` - Generated from thumbnail  
✅ `dim` - Thumbnail dimensions  
✅ `thumb` - Thumbnail URL  
✅ `x` - SHA-256 hash  

### NIP-94 (File Metadata)
✅ Full compatibility with file metadata standard  
✅ SHA-256 for content verification  
✅ Thumbnail support for videos  

## User Experience

### Before
- Video uploads showed only URL and MIME type
- No visual preview metadata
- No file verification
- Poor client-side preview support

### After
- Rich metadata enables beautiful blurhash placeholders
- Thumbnail URLs for quick previews
- SHA-256 hash for content verification
- Consistent experience with media publish dialog
- Better accessibility with dimensions

## Benefits

1. **Rich Previews**: Clients can show blurhash placeholders while videos load
2. **Thumbnails**: Dedicated thumbnail URLs for video previews
3. **Performance**: Dimensions help clients allocate proper space
4. **Verification**: SHA-256 hashes enable content verification
5. **Deduplication**: Hash-based duplicate detection
6. **Consistency**: Same metadata quality as dedicated media events
7. **Accessibility**: Complete metadata for assistive technologies

## Testing Recommendations

### Manual Testing
1. Drag and drop various video formats (MP4, WebM, MOV)
2. Verify thumbnail generation message appears
3. Check published event includes all metadata fields
4. Confirm thumbnail URL is valid and accessible
5. Test with different video lengths and resolutions

### Edge Cases
- Very short videos (< 1 second)
- Large video files
- Corrupted video files
- Multiple videos in one note
- Mixed image and video uploads

## Future Enhancements

### Potential Improvements
- Configurable thumbnail extraction time (currently 1 second)
- Multiple thumbnail options for user selection
- Video duration extraction and inclusion
- Video dimensions extraction
- Support for video transformations (compression, format conversion)
- Preview generation for audio files
- Animated GIF thumbnail for short clips

## Related Features

- **Media Publish Dialog**: Uses same utilities for consistency
- **Utilities Service**: Centralized thumbnail and blurhash generation
- **Media Service**: Handles SHA-256 calculation and file uploads
- **NIP-92 Support**: Inline metadata for all media types
- **NIP-94 Support**: File metadata standard compliance
