# Media Publishing Feature (NIP-68 & NIP-71)

## Overview

This document describes the implementation of media publishing functionality that allows users to publish images and videos from their media library to Nostr as dedicated media events according to NIP-68 (Picture Events) and NIP-71 (Video Events).

## Implementation Date
November 8, 2025

## Nostr Protocol Standards

### NIP-68: Picture-first feeds (kind 20)
Picture events are designed for image-first clients (like Instagram, Flickr) where the picture takes center stage. These events use kind 20.

**Required fields:**
- `title` tag: Short title of the post
- `.content`: Description of the post
- `imeta` tags: Image metadata (URL, MIME type, hash, dimensions, alt text, etc.)

**Optional fields:**
- `alt`: Accessibility description
- `content-warning`: Warning about sensitive content
- `t`: Hashtags
- `location`: Geographic location
- `g`: Geohash
- `m`: MIME type for filtering
- `x`: SHA-256 hash for queryability

### NIP-71: Video Events (kind 21 & 22)

Video events are designed for video-first clients (like YouTube, TikTok). There are two types:

- **Kind 21**: Normal/horizontal videos (landscape orientation)
- **Kind 22**: Short-form vertical videos (portrait - stories, reels, shorts)

**Required fields:**
- `title` tag: Title of the video
- `.content`: Summary/description of the video
- `imeta` tags: Video metadata (URL, MIME type, hash, dimensions, duration, bitrate, etc.)

**Optional fields:**
- `alt`: Accessibility description
- `published_at`: Unix timestamp of first publication
- `duration`: Video duration in seconds (recommended)
- `content-warning`: Warning about sensitive content
- `t`: Hashtags
- `location`: Geographic location
- `g`: Geohash

## Components Created

### 1. MediaPublishDialogComponent
**Location:** `src/app/pages/media/media-publish-dialog/`

A dialog component that provides a form for configuring media publication settings.

**Features:**
- Media preview (image or video)
- Event kind selection (for videos: choose between kind 21 or 22)
- Title input (required)
- Description/content input
- Alt text for accessibility
- Duration input (for videos)
- Content warning
- Hashtag management with chips
- Location and geohash inputs
- Real-time validation

**Interface:**
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
  duration?: number; // For videos (in seconds)
}
```

## Implementation Details

### Media Details Component Updates

**File:** `src/app/pages/media/media-details/media-details.component.ts`

Added the following functionality:

1. **New Services Injected:**
   - `NostrService`: For creating and signing events
   - `PublishService`: For publishing events to relays

2. **New Methods:**
   - `publishMedia()`: Opens the publish dialog and handles the publishing flow
   - `buildMediaEvent()`: Constructs a NIP-68 or NIP-71 compliant event with proper imeta tags

3. **Event Building Logic:**
   - Adds `title` tag (required)
   - Builds `imeta` tag with:
     - URL of the media file
     - MIME type (`m`)
     - SHA-256 hash (`x`)
     - File size (`size`)
     - Alt text (`alt`) if provided
     - Duration (`duration`) for videos
     - Fallback URLs from mirrors
   - Adds `published_at` timestamp
   - Adds optional tags: `alt`, `content-warning`, `t` (hashtags), `location`, `g` (geohash)
   - Adds `m` tag for MIME type filtering (kind 20 only)
   - Adds `x` tag for hash queryability

### UI Updates

**File:** `src/app/pages/media/media-details/media-details.component.html`

Added a "Publish" button to the media actions section:
- Positioned between "Mirror" and "Delete" buttons
- Uses primary color to indicate it's an important action
- Opens the MediaPublishDialogComponent when clicked

## User Flow

1. User navigates to the Media Library
2. User selects an image or video to view details
3. User clicks the "Publish" button
4. MediaPublishDialogComponent opens with:
   - Preview of the media
   - Pre-selected event kind based on media type
   - Form fields for metadata
5. User fills in:
   - Title (required)
   - Description (optional)
   - Alt text (recommended for accessibility)
   - Duration (for videos, optional but recommended)
   - Content warning (if NSFW or sensitive)
   - Hashtags
   - Location and geohash (optional)
6. User clicks "Publish"
7. System:
   - Builds the event according to NIP-68/71
   - Signs the event
   - Publishes to user's relays
   - Shows success/error notification

## Event Structure Examples

### Picture Event (kind 20)

```json
{
  "kind": 20,
  "content": "Beautiful sunset over the ocean",
  "tags": [
    ["title", "Sunset at the Beach"],
    ["imeta",
      "url https://media.example.com/sunset.jpg",
      "m image/jpeg",
      "x abc123def456...",
      "size 2048000",
      "alt A vibrant sunset with orange and pink hues over calm ocean waters",
      "fallback https://backup.example.com/sunset.jpg"
    ],
    ["published_at", "1731024000"],
    ["alt", "A vibrant sunset with orange and pink hues over calm ocean waters"],
    ["t", "sunset"],
    ["t", "ocean"],
    ["location", "Santa Monica, CA, USA"],
    ["m", "image/jpeg"],
    ["x", "abc123def456..."]
  ]
}
```

### Video Event (kind 21)

```json
{
  "kind": 21,
  "content": "Tutorial on how to build a Nostr client",
  "tags": [
    ["title", "Building a Nostr Client - Part 1"],
    ["imeta",
      "url https://media.example.com/tutorial.mp4",
      "m video/mp4",
      "x def789abc012...",
      "size 52428800",
      "duration 1805.5",
      "alt Video tutorial showing code examples and explanations",
      "fallback https://backup.example.com/tutorial.mp4"
    ],
    ["published_at", "1731024000"],
    ["alt", "Video tutorial showing code examples and explanations"],
    ["t", "tutorial"],
    ["t", "nostr"],
    ["t", "development"],
    ["x", "def789abc012..."]
  ]
}
```

### Short Video Event (kind 22)

```json
{
  "kind": 22,
  "content": "Quick tip for optimizing Nostr queries",
  "tags": [
    ["title", "Nostr Query Optimization Tip"],
    ["imeta",
      "url https://media.example.com/tip.mp4",
      "m video/mp4",
      "x ghi345jkl678...",
      "size 5242880",
      "duration 45.2"
    ],
    ["published_at", "1731024000"],
    ["t", "tips"],
    ["t", "nostr"],
    ["x", "ghi345jkl678..."]
  ]
}
```

## Technical Considerations

### Media Metadata Requirements

The system leverages existing `MediaItem` data:
- `sha256`: Used for the `x` tag (hash)
- `type`: Used for the `m` tag (MIME type)
- `url`: Used as the primary URL in imeta
- `size`: Used for the `size` property in imeta
- `mirrors`: Used for `fallback` URLs in imeta

### Publishing Strategy

- Uses the existing `PublishService` for publishing events
- Publishes to all user's configured relays
- Shows relay publishing notifications through the notification service
- Provides feedback on success/failure

### Accessibility

- Encourages users to add alt text for images and videos
- Alt text is added both as an imeta property and as a separate tag
- Helps make content accessible to screen readers and assistive technologies

### Performance

- Dialog opens immediately with media preview
- Publishing happens asynchronously
- User receives feedback through snackbar notifications
- No blocking operations in the UI

## Future Enhancements

Potential improvements for future iterations:

1. **Dimension Detection**: Automatically detect and add image/video dimensions to imeta tags
2. **Blurhash Generation**: Generate and include blurhash for image previews
3. **Thumbnail Generation**: For videos, generate and upload thumbnail images
4. **Bitrate Detection**: For videos, detect and include bitrate information
5. **Multiple Media**: Support publishing multiple images in a single kind 20 event
6. **Text Tracks**: Support for WebVTT captions/subtitles (NIP-71 `text-track` tag)
7. **Participant Tagging**: Add UI for tagging participants in media (`p` tags)
8. **Time Segments**: For videos, add support for chapter/segment markers
9. **Language Detection**: Auto-detect and tag language for accessibility
10. **Draft Saving**: Save draft publications for later
11. **Template System**: Save and reuse publication templates
12. **Batch Publishing**: Publish multiple media items at once

## Files Modified

### New Files
- `src/app/pages/media/media-publish-dialog/media-publish-dialog.component.ts`
- `src/app/pages/media/media-publish-dialog/media-publish-dialog.component.html`
- `src/app/pages/media/media-publish-dialog/media-publish-dialog.component.scss`

### Modified Files
- `src/app/pages/media/media-details/media-details.component.ts`
- `src/app/pages/media/media-details/media-details.component.html`

## Testing Checklist

- [ ] Publish an image as kind 20 with all optional fields
- [ ] Publish an image as kind 20 with only required fields
- [ ] Publish a normal video as kind 21
- [ ] Publish a short video as kind 22
- [ ] Verify imeta tags include all provided information
- [ ] Verify SHA-256 hash is correctly included
- [ ] Verify MIME type is correctly set
- [ ] Verify mirrors are included as fallback URLs
- [ ] Test hashtag addition and removal
- [ ] Test form validation (title required)
- [ ] Test cancellation workflow
- [ ] Verify events are published to relays
- [ ] Verify success/error notifications
- [ ] Test with NSFW content and content warnings
- [ ] Test accessibility features with screen readers

## References

- [NIP-68: Picture-first feeds](https://github.com/nostr-protocol/nips/blob/master/68.md)
- [NIP-71: Video Events](https://github.com/nostr-protocol/nips/blob/master/71.md)
- [NIP-92: Media Attachments](https://github.com/nostr-protocol/nips/blob/master/92.md)
- [NIP-94: File Metadata](https://github.com/nostr-protocol/nips/blob/master/94.md)
