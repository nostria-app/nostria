# Video Thumbnail Management in Publish Dialog

## Overview
Added comprehensive video thumbnail management to the media publish dialog with automatic blurhash generation for both images and videos. Thumbnails are now uploaded during publish rather than immediately, and image dimensions are automatically detected and included in NIP-92/NIP-71 imeta tags.

## Key Features

### Automatic Blurhash Generation
- **Images**: Blurhash automatically generated when publish dialog opens
- **Video thumbnails**: Blurhash automatically generated after extraction, upload, or URL input
- **Manual trigger**: Users can regenerate blurhash if needed
- **Dimensions detection**: Image dimensions automatically read and stored

### Deferred Thumbnail Upload
- Extracted thumbnails stored as blobs (not uploaded immediately)
- Upload happens during publish action
- Reduces unnecessary uploads if user cancels
- Object URLs used for preview before upload

### Image Dimensions in Imeta
- Automatically detects image/thumbnail dimensions
- Adds `dim WxH` property to imeta tag
- Format: `dim 3024x4032` (width x height)
- Included for both images (kind 20) and video thumbnails (kind 21/22)

## Features

### Thumbnail Sources
Users can add thumbnails through three methods:

1. **Upload File**: Select an image file from disk
2. **Extract from Video**: Capture a frame from the currently loaded video
3. **Enter URL**: Provide a direct URL to a thumbnail image

### Blurhash Generation
- Automatic blurhash encoding from thumbnail images and pictures
- Displays encoded blurhash value
- Included in NIP-71 imeta tag when publishing
- Manual regeneration available via button

### UI Components

#### Thumbnail Section (Videos Only)
- Appears between media preview and form fields
- Only shown for video content (kind 21/22)
- Compact design matching existing dialog style

#### Thumbnail Controls
- **Add button**: Menu with three source options
- **URL input field**: Appears when "Enter URL" is selected
- **Thumbnail preview**: Shows selected/uploaded thumbnail
- **Generate blurhash button**: Creates/regenerates blurhash from thumbnail
- **Remove button**: Clears thumbnail and blurhash

## Implementation Details

### TypeScript (media-publish-dialog.component.ts)

#### New Signals
```typescript
thumbnailUrl = signal<string | undefined>(this.data.thumbnailUrl);
thumbnailBlob = signal<Blob | undefined>(undefined); // Store extracted thumbnail blob
thumbnailDimensions = signal<{ width: number; height: number } | undefined>(undefined);
thumbnailUrlInput = signal<string | null>(null);
thumbnailUrlInputValue = ''; // For ngModel binding
blurhash = signal<string | undefined>(undefined);
generatingBlurhash = signal(false);
extractingThumbnail = signal(false);
```

#### Constructor
```typescript
constructor() {
  // Auto-generate blurhash for images on init
  if (this.isImage()) {
    this.loadImageAndGenerateBlurhash(this.data.mediaItem.url);
  }
}
```

#### Thumbnail Methods

**extractThumbnailFromVideo()**
- Creates hidden video element with crossOrigin
- Seeks to 1 second or 10% duration
- Captures frame to canvas at original video dimensions
- Converts to JPEG blob (90% quality)
- Stores blob (no upload)
- Creates object URL for preview
- Stores dimensions
- Auto-generates blurhash

**onThumbnailFileSelected()**
- Validates image file type
- Stores file as blob
- Creates object URL for preview
- Auto-generates blurhash and detects dimensions

**setThumbnailFromUrl()**
- Sets thumbnailUrl from input field
- Clears blob (using external URL)
- Auto-generates blurhash and detects dimensions

**generateBlurhashFromCanvas(canvas)** (private)
- Generates blurhash directly from canvas
- Used after video frame extraction
- Resizes to 32px width for encoding
- Maintains aspect ratio

**loadImageAndGenerateBlurhash(url)** (private)
- Loads image from URL
- Stores original dimensions
- Generates blurhash from resized canvas
- Used for file uploads and URL inputs

**generateBlurhash()** (public)
- Manual blurhash regeneration
- Calls loadImageAndGenerateBlurhash internally

**removeThumbnail()**
- Clears thumbnailUrl, thumbnailBlob, thumbnailDimensions, and blurhash signals

### Updated Interface (MediaPublishOptions)
```typescript
export interface MediaPublishOptions {
  kind: 20 | 21 | 22;
  title: string;
  content: string;
  alt?: string;
  contentWarning?: string;
  hashtags: string[];
  location?: string;
  geohash?: string;
  duration?: number;
  thumbnailUrl?: string; // For videos - external URL
  thumbnailBlob?: Blob; // For videos - to be uploaded during publish
  thumbnailDimensions?: { width: number; height: number };
  blurhash?: string; // For both images and videos
  imageDimensions?: { width: number; height: number }; // For pictures
}
```

### Publish Method Updates
```typescript
publish(): void {
  // ... existing code ...

  // Include thumbnail blob if available (for upload during publish)
  if (this.thumbnailBlob()) {
    options.thumbnailBlob = this.thumbnailBlob();
  }

  // Include thumbnail dimensions if available
  if (this.thumbnailDimensions()) {
    options.thumbnailDimensions = this.thumbnailDimensions();
  }

  // Include blurhash if generated
  if (this.blurhash()) {
    options.blurhash = this.blurhash();
  }

  // For images, include dimensions
  if (this.isImage() && this.thumbnailDimensions()) {
    options.imageDimensions = this.thumbnailDimensions();
  }
}
```

### NIP-92/71 Integration (media.component.ts)

Updated `buildMediaEvent()` to handle thumbnail upload and dimensions:

```typescript
private async buildMediaEvent(item: MediaItem, options: MediaPublishOptions) {
  // Upload thumbnail blob if provided (for videos)
  let thumbnailUrl = options.thumbnailUrl;
  if (options.thumbnailBlob && (options.kind === 21 || options.kind === 22)) {
    try {
      const thumbnailFile = new File([options.thumbnailBlob], 'thumbnail.jpg', { type: 'image/jpeg' });
      const uploadResult = await this.mediaService.uploadFile(
        thumbnailFile,
        false,
        this.mediaService.mediaServers()
      );

      if (uploadResult.status === 'success' && uploadResult.item) {
        thumbnailUrl = uploadResult.item.url;
      }
    } catch (error) {
      console.error('Failed to upload thumbnail during publish:', error);
    }
  }

  // ... build imeta tag ...

  // Add dimensions for images
  if (options.imageDimensions && options.kind === 20) {
    imetaTag.push(`dim ${options.imageDimensions.width}x${options.imageDimensions.height}`);
  }

  // Add blurhash for images
  if (options.blurhash && options.kind === 20) {
    imetaTag.push(`blurhash ${options.blurhash}`);
  }

  // For videos, add thumbnail with dimensions
  if (thumbnailUrl && (options.kind === 21 || options.kind === 22)) {
    imetaTag.push(`image ${thumbnailUrl}`);
    
    if (options.thumbnailDimensions) {
      imetaTag.push(`dim ${options.thumbnailDimensions.width}x${options.thumbnailDimensions.height}`);
    }
  }

  // For videos, add blurhash
  if (options.blurhash && (options.kind === 21 || options.kind === 22)) {
    imetaTag.push(`blurhash ${options.blurhash}`);
  }
}
```

## Data Flow

### Images (Kind 20)
1. **Dialog Opens**: Auto-generate blurhash from image URL
2. **Load Image**: Detect dimensions (width x height)
3. **Generate Blurhash**: Create blurhash from 32px canvas
4. **Publish**: Include blurhash and dimensions in imeta tag

### Videos (Kind 21/22)
1. **Upload Dialog**: User uploads video → optional thumbnail extraction
2. **Extraction**: Capture frame → store blob → create object URL → auto-generate blurhash
3. **Storage**: Blob and dimensions stored in signals
4. **Publish Dialog**: Preview shows object URL, blurhash displayed
5. **User Modifies**: Can upload file/extract again/enter URL → auto-regenerates blurhash
6. **Publish**: Upload blob to Blossom → get URL → include in imeta with blurhash and dimensions

## NIP-92/71 Compliance

### Imeta Tag Format for Images (Kind 20)
```
["imeta",
  "url <image-url>",
  "m <mime-type>",
  "x <sha256>",
  "size <bytes>",
  "dim <width>x<height>",        // Image dimensions
  "blurhash <encoded-hash>",     // Blurhash of image
  "alt <description>"
]
```

### Imeta Tag Format for Videos (Kind 21/22)
```
["imeta",
  "url <video-url>",
  "m <mime-type>",
  "x <sha256>",
  "size <bytes>",
  "image <thumbnail-url>",       // Uploaded thumbnail
  "dim <width>x<height>",        // Thumbnail dimensions
  "blurhash <encoded-hash>",     // Blurhash of thumbnail
  "duration <seconds>",
  "alt <description>"
]
```

### Thumbnail Priority (Display)
1. Image URL (from imeta tag)
2. Blurhash (progressive placeholder)
3. Video preload="metadata" (fallback)

## User Experience

### Image Publishing Workflow
1. Open publish dialog
2. Blurhash auto-generates (loading indicator shown)
3. User fills in title and metadata
4. Publish with blurhash and dimensions

### Video Publishing Workflow
1. Upload video → optionally extract thumbnail
2. Open publish dialog
3. Thumbnail preview shows (object URL if extracted)
4. Blurhash already generated if thumbnail exists
5. User can modify thumbnail source
6. On source change → auto-regenerates blurhash
7. Publish → uploads thumbnail blob → includes URL, blurhash, dimensions

### Loading States
- "Extracting thumbnail..." during frame capture
- Spinner in blurhash generation
- Disabled states during async operations

### Validation
- File input accepts only images
- URL input validated before setting
- Empty/invalid values prevented

## Technical Notes

### Canvas Blurhash Encoding
- Resizes to 32px width for encoding efficiency
- Maintains aspect ratio
- Uses 4x3 component count (standard)
- ImageData extracted from canvas
- Encode function from blurhash library

### Video Frame Capture
- Sets crossOrigin="anonymous" for CORS
- Seeks to 1s or 10% of duration
- Uses loadeddata and seeked events
- Canvas size: original video dimensions
- JPEG quality: 0.9

### Object URLs
- Created from blobs for preview
- Memory efficient
- Cleaned up when dialog closes or thumbnail removed
- Not persisted - only for preview

### Deferred Upload Benefits
- No wasted uploads if user cancels
- Faster dialog opening
- Blob stored in memory until publish
- Upload only happens on successful publish

### Dimension Detection
- Uses Image.width and Image.height properties
- Canvas.width and Canvas.height for video frames
- Stored as {width, height} object
- Format: `dim WIDTHxHEIGHT` in imeta tag

## Future Enhancements

Potential improvements:
- Blurhash visualization/preview
- Custom component count selection
- Thumbnail editing (crop, resize)
- Batch blurhash generation
- Caching blurhash values
- Progress indicator for large images
