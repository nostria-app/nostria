# Base64 Embedded Content Support

## Overview
Added support for rendering embedded base64-encoded media content directly in note content. This allows images, audio, and video to be embedded inline using data URLs.

## Implementation

### Content Token Types
Added three new token types to `ContentToken` interface in `parsing.service.ts`:
- `base64-image` - For base64-encoded images
- `base64-audio` - For base64-encoded audio
- `base64-video` - For base64-encoded video

### Parsing Logic
The parsing service now detects base64 data URLs using the following regex patterns:
- **Images**: `data:image/[type];base64,[data]`
- **Audio**: `data:audio/[type];base64,[data]`
- **Video**: `data:video/[type];base64,[data]`

These patterns are processed during content parsing alongside regular HTTP URLs.

### Rendering
The `note-content.component.html` template now includes dedicated handling for each base64 media type:

#### Base64 Images
- Rendered in a media container
- Clickable to open in the image dialog (same as regular images)
- No lazy loading (data is already inline)

#### Base64 Audio
- Rendered with native HTML5 audio controls
- Same presentation as regular audio URLs

#### Base64 Video
- Rendered with native HTML5 video controls
- No format checking required (browser handles data URL directly)
- Simpler implementation than regular video URLs

## Usage Example
Content field can now contain:
```
Check out this embedded image:
data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAACSgAAASUCAYAAABu9HH1...
```

The base64 content will be automatically detected and rendered as an inline image.

## Technical Notes
- Base64 content is matched with high priority during parsing
- The full data URL is stored in the token's `content` field
- Browser security policies apply to data URLs
- Large base64 content may impact performance
- NgOptimizedImage is NOT used for base64 images (it doesn't support data URLs)

## Files Modified
- `src/app/services/parsing.service.ts` - Added regex patterns and parsing logic
- `src/app/components/content/note-content/note-content.component.html` - Added rendering templates
