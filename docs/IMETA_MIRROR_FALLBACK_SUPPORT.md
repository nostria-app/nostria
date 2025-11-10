# IMETA Mirror and Fallback URL Support

## Overview
Enhanced the NIP-92/NIP-94 `imeta` tag implementation to support mirror URLs as fallback sources and changed thumbnail field from `thumb` to `image` for better spec compliance.

## Changes Made

### 1. Updated `buildImetaTag` in `utilities.service.ts`

**Changed thumbnail field:**
- **Before:** Used `thumb` field for video thumbnails
- **After:** Uses `image` field for preview captures (screen captures)
- **Reason:** Better alignment with NIP-94 specification where `image` represents a preview image with full dimensions

**Added mirror support:**
- `imageMirrors?: string[]` - Mirror URLs for preview images (multiple `image` entries)
- `fallbackUrls?: string[]` - Mirror URLs for main media files (multiple `fallback` entries)

**Updated parameter type:**
```typescript
buildImetaTag(metadata: {
  url: string;
  mimeType?: string;
  blurhash?: string;
  dimensions?: { width: number; height: number };
  alt?: string;
  sha256?: string;
  size?: number;
  duration?: number;
  image?: string;          // Changed from 'thumbnail'
  imageMirrors?: string[]; // NEW: Multiple preview image URLs
  fallbackUrls?: string[]; // NEW: Mirror URLs for main file
}): string[] | null
```

**Tag generation logic:**
```typescript
// Single preview image
if (metadata.image) {
  tag.push(`image ${metadata.image}`);
}

// Additional mirror URLs for preview images
if (metadata.imageMirrors && metadata.imageMirrors.length > 0) {
  metadata.imageMirrors.forEach(mirrorUrl => {
    tag.push(`image ${mirrorUrl}`);
  });
}

// Mirror URLs for main media file
if (metadata.fallbackUrls && metadata.fallbackUrls.length > 0) {
  metadata.fallbackUrls.forEach(fallbackUrl => {
    tag.push(`fallback ${fallbackUrl}`);
  });
}
```

### 2. Updated `MediaMetadata` Interface in `note-editor-dialog.component.ts`

**Changed fields:**
```typescript
interface MediaMetadata {
  url: string;
  mimeType?: string;
  blurhash?: string;
  dimensions?: { width: number; height: number };
  alt?: string;
  sha256?: string;
  image?: string;          // Changed from 'thumbnail'
  imageMirrors?: string[]; // NEW: Mirror URLs for preview image
  fallbackUrls?: string[]; // NEW: Mirror URLs for main file
  thumbnailBlob?: Blob;    // Temporary, before upload
}
```

### 3. Enhanced `extractMediaMetadata` in `note-editor-dialog.component.ts`

**Added mirrors parameter:**
```typescript
private async extractMediaMetadata(
  file: File,
  url: string,
  sha256?: string,
  mirrors?: string[]  // NEW: Mirror URLs from upload
): Promise<MediaMetadata | null>
```

**For images:**
- Extracts metadata using utilities service
- Adds mirror URLs as `fallbackUrls`

**For videos:**
- Extracts thumbnail at 1-second mark
- Uploads thumbnail to get permanent URL
- Uses `image` field for thumbnail URL (not `thumb`)
- Adds thumbnail's mirror URLs as `imageMirrors`
- Adds main video's mirror URLs as `fallbackUrls`

**Example implementation:**
```typescript
// For videos
if (uploadResult.status === 'success' && uploadResult.item) {
  const blurhashResult = await this.utilities.generateBlurhash(thumbnailFile);
  
  metadata.image = uploadResult.item.url;  // Preview capture
  metadata.blurhash = blurhashResult.blurhash;
  metadata.dimensions = blurhashResult.dimensions;
  
  // Add thumbnail mirrors
  if (uploadResult.item.mirrors && uploadResult.item.mirrors.length > 0) {
    metadata.imageMirrors = uploadResult.item.mirrors;
  }
}
```

### 4. Updated Upload Flow in `note-editor-dialog.component.ts`

**Passes mirror URLs to metadata extraction:**
```typescript
const metadata = await this.extractMediaMetadata(
  file,
  result.item.url,
  result.item.sha256,
  result.item.mirrors  // Mirror URLs from upload
);
```

### 5. Updated Return Type in `utilities.service.ts`

**Added `fallbackUrls` to return type:**
```typescript
async extractMediaMetadata(
  file: File,
  url: string
): Promise<{
  url: string;
  mimeType: string;
  blurhash?: string;
  dimensions?: { width: number; height: number };
  fallbackUrls?: string[];  // NEW: Support for mirror URLs
}>
```

## Example Output

### Image with Mirrors
```javascript
[
  "imeta",
  "url https://cdn1.example.com/image.jpg",
  "m image/jpeg",
  "blurhash LKN]Rv%2Tw=w]~RBVZRi};RPxuwH",
  "dim 1920x1080",
  "x a5d8f7b9c2e1d4f3a6b8c9d2e1f4a6b8c9d2e1f4a6b8c9d2e1f4a6b8c9d2e1f4",
  "fallback https://cdn2.example.com/image.jpg",
  "fallback https://cdn3.example.com/image.jpg"
]
```

### Video with Thumbnail and Mirrors
```javascript
[
  "imeta",
  "url https://cdn1.example.com/video.mp4",
  "m video/mp4",
  "blurhash LKN]Rv%2Tw=w]~RBVZRi};RPxuwH",
  "dim 1920x1080",
  "x a5d8f7b9c2e1d4f3a6b8c9d2e1f4a6b8c9d2e1f4a6b8c9d2e1f4a6b8c9d2e1f4",
  "image https://cdn1.example.com/thumbnail.jpg",
  "image https://cdn2.example.com/thumbnail.jpg",
  "fallback https://cdn2.example.com/video.mp4",
  "fallback https://cdn3.example.com/video.mp4"
]
```

## NIP-94 Compliance

### Field Mappings
- `url` - Primary media file URL (required)
- `m` - MIME type
- `blurhash` - Compact image placeholder
- `dim` - Dimensions (width x height)
- `x` - SHA-256 hash (hex)
- `image` - Preview image URL (screen capture for videos)
  - Multiple `image` entries supported for mirrors
- `fallback` - Alternative download URLs (mirrors)
  - Multiple `fallback` entries supported

### Key Differences from Previous Implementation
1. **`image` instead of `thumb`:** Better semantic meaning for preview captures
2. **Multiple `image` entries:** Support for mirrored thumbnail URLs
3. **`fallback` entries:** Support for mirrored main file URLs
4. **Spec compliance:** Follows NIP-94 field definitions more accurately

## Benefits

1. **Redundancy:** Multiple mirror URLs increase reliability
2. **Load distribution:** Clients can choose from multiple sources
3. **Offline resilience:** More fallback options if primary server is down
4. **Spec compliance:** Proper use of `image` and `fallback` per NIP-94

## Testing

### Test Case 1: Image Upload with Mirrors
1. Upload an image to media server with mirrors configured
2. Verify `imeta` tag includes:
   - Primary image URL
   - All mirror URLs as `fallback` entries

### Test Case 2: Video Upload with Mirrors
1. Upload a video to media server with mirrors configured
2. Verify `imeta` tag includes:
   - Primary video URL
   - Video mirror URLs as `fallback` entries
   - Thumbnail URL as `image`
   - Thumbnail mirror URLs as additional `image` entries

### Test Case 3: Single Server (No Mirrors)
1. Upload media to server without mirrors
2. Verify `imeta` tag works correctly with only primary URLs
3. Ensure no empty `fallback` or `imageMirrors` fields

## Related Files
- `src/app/services/utilities.service.ts` - Core metadata utilities
- `src/app/components/note-editor-dialog/note-editor-dialog.component.ts` - Note editor integration
- `src/app/services/media.service.ts` - MediaItem interface with mirrors array

## Related Documentation
- `NOTE_EDITOR_IMETA_SUPPORT.md` - Initial imeta implementation
- `VIDEO_UPLOAD_IMETA_SUPPORT.md` - Video thumbnail support
- `MEDIA_UTILITIES_REFACTORING.md` - Centralized utilities

## NIP References
- **NIP-92:** Media Attachments (imeta tags in kind 1 events)
- **NIP-94:** File Metadata (comprehensive file metadata standard)
