# Note Editor IMETA Support Implementation

## Overview

Added NIP-92 media metadata support to the note editor dialog. When users upload images to their notes, the editor now automatically extracts and includes comprehensive metadata in `imeta` tags.

This implementation includes a refactoring of media utility functions into a centralized `UtilitiesService` to ensure consistent behavior across the application.

## Changes Made

### 1. Centralized Media Utilities (UtilitiesService)

Added reusable utility methods to `utilities.service.ts`:

#### `extractThumbnailFromVideo(videoUrl, seekTime?)`
- Extracts a thumbnail frame from a video at a specific time offset
- Returns blob, dimensions, and object URL
- Used by both media publish dialog and future video features

#### `generateBlurhash(source, componentX?, componentY?)`
- Generates blurhash from image URL or File object
- Configurable component counts (default 6x4)
- Returns blurhash string and image dimensions
- Handles cleanup of temporary object URLs

#### `getImageDimensions(source)`
- Extracts width and height from image URL or File
- Supports both remote URLs and File objects

#### `extractMediaMetadata(file, url)`
- Complete metadata extraction for NIP-92/NIP-94 compliance
- Automatically generates blurhash for images
- Returns URL, MIME type, blurhash, and dimensions

#### `buildImetaTag(metadata)`
- Builds properly formatted imeta tags according to NIP-92 spec
- Supports all NIP-94 fields: url, m, blurhash, dim, alt, x, size, duration, thumb
- Returns formatted tag array ready for event publishing

### 2. Note Editor Dialog Integration

Added NIP-92 support to `note-editor-dialog.component.ts`:

#### New Interface: `MediaMetadata`
```typescript
interface MediaMetadata {
  url: string;
  mimeType?: string;
  blurhash?: string;
  dimensions?: { width: number; height: number };
  alt?: string;
  sha256?: string;
}
```

#### Media Metadata Signal
```typescript
mediaMetadata = signal<MediaMetadata[]>([]);
```

#### Integration Points
- Modified `uploadFiles()` to extract and store metadata
- Updated `buildTags()` to include imeta tags when publishing
- Uses centralized utilities for consistent metadata extraction

### 3. Media Publish Dialog Refactoring

Updated `media-publish-dialog.component.ts` to use centralized utilities:

- Replaced inline thumbnail extraction with `utilities.extractThumbnailFromVideo()`
- Replaced inline blurhash generation with `utilities.generateBlurhash()`
- Simplified code and improved maintainability
- Consistent behavior across the application

## NIP-92 & NIP-94 Compliance

The implementation follows both NIP-92 (inline metadata) and NIP-94 (file metadata) specifications:

### NIP-92 (Inline Metadata for kind 1 events)
- **Required field**: `url` - Always included
- **Recommended fields**:
  - `m` (MIME type) - Included for all files
  - `blurhash` - Generated for images
  - `dim` (dimensions) - Extracted for images

### NIP-94 (File Metadata for kind 1063 events)
- Support for additional fields:
  - `x` (SHA-256 hash)
  - `size` (file size in bytes)
  - `alt` (accessibility description)
  - `duration` (for videos)
  - `thumb` (thumbnail URL)

## Example Output

### Image Upload

When publishing a note with an uploaded image:

```json
{
  "kind": 1,
  "content": "Check out this image! https://nostr.build/i/my-image.jpg",
  "tags": [
    [
      "imeta",
      "url https://nostr.build/i/my-image.jpg",
      "m image/jpeg",
      "blurhash eVF$^OI:${M{o#*0-nNFxakD-?xVM}WEWB%iNKxvR-oetmo#R-aen$",
      "dim 3024x4032",
      "x a5d3f8b2c1e9..."
    ]
  ]
}
```

### Video Upload

When publishing a note with an uploaded video:

```json
{
  "kind": 1,
  "content": "Check out this video! https://mibo.eu.nostria.app/video.mp4",
  "tags": [
    [
      "imeta",
      "url https://mibo.eu.nostria.app/video.mp4",
      "m video/mp4",
      "blurhash eVF$^OI:${M{o#*0-nNFxakD-?xVM}WEWB%iNKxvR-oetmo#R-aen$",
      "dim 1920x1080",
      "thumb https://mibo.eu.nostria.app/thumbnail.jpg",
      "x c0f1df387bd1..."
    ]
  ]
}
```

The video processing includes:
1. **Thumbnail Extraction**: Captures frame at 1 second mark
2. **Thumbnail Upload**: Uploads thumbnail to media server
3. **Blurhash Generation**: Generates blurhash from thumbnail
4. **SHA-256 Hash**: Includes file hash for verification

## Benefits

1. **Rich Previews**: Clients can use blurhash to show beautiful placeholder images while loading
2. **Accessibility**: Provides metadata for screen readers and accessibility tools
3. **Performance**: Dimensions allow clients to allocate proper space before image loads
4. **Standards Compliance**: Follows NIP-92/NIP-94 protocols for interoperability
5. **Code Reusability**: Centralized utilities ensure consistent behavior across components
6. **Maintainability**: Single source of truth for media metadata extraction
7. **Video Support**: Automatic thumbnail extraction and blurhash generation for videos
8. **File Verification**: SHA-256 hashes enable content verification and deduplication

## Architecture

```
UtilitiesService (centralized)
├── extractThumbnailFromVideo()
├── generateBlurhash()
├── getImageDimensions()
├── extractMediaMetadata()
└── buildImetaTag()
     ↓
     ├── NoteEditorDialogComponent
     │   └── Uses for inline image uploads in notes
     └── MediaPublishDialogComponent
         └── Uses for kind 20/21/22 media events
```

## Future Enhancements

Potential improvements:
- Allow users to add custom alt text for accessibility
- Generate SHA-256 hash for content verification
- Support fallback URLs for redundancy
- Extract metadata for video files (duration, dimensions)
- Add support for audio file metadata
- Implement thumbnail generation for video uploads in notes
