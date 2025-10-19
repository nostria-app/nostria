# .MOV Video File Support

## Overview

Added support for rendering `.mov` (QuickTime) video files in the application. Modern `.mov` files are typically encoded as MPEG-4 videos, which can be rendered by modern browsers like Edge, Chrome, Firefox, and Safari.

## Changes Made

### 1. Video Event Component (`video-event.component.ts`)

**Added:**
- `videoMimeType` computed signal that detects the correct MIME type based on file extension
- `getMimeTypeFromUrl()` method that maps file extensions to their correct MIME types

**Key Changes:**
- `.mov` files are now mapped to `video/mp4` MIME type (instead of `video/quicktime`)
- Added support for additional video formats: `.m4v`, `.3gp`, `.3g2`, `.ogv`

**Updated Template:**
- Changed hardcoded `type="video/mp4"` to dynamic `[type]="videoMimeType()"`

### 2. Note Content Component (`note-content.component.ts`)

**Updated Methods:**

1. `getVideoType()`:
   - Changed `.mov` to return `'mp4'` instead of `'quicktime'`
   - Added `.m4v` support (also returns `'mp4'`)
   - Added `.ogg` and `.ogv` support
   - Added documentation explaining that modern .mov files are MPEG-4 encoded

2. `isVideoFormatSupported()`:
   - Now includes `.mov` and `.m4v` as supported formats
   - Updated documentation to clarify that modern .mov files can be played by browsers

**Template Impact:**
- Videos with `.mov` extension will now use `type="video/mp4"` instead of `type="video/quicktime"`
- `.mov` files will no longer show the "Video format may not be supported" fallback

### 3. Video Player Component (`video-player.component.ts`)

**Added:**
- `videoMimeType` computed signal that dynamically determines MIME type
- `getMimeTypeFromUrl()` private method with comprehensive extension-to-MIME-type mapping

**Updated Template:**
- Changed hardcoded `type="video/mp4"` to dynamic `[type]="videoMimeType()"`

## Technical Details

### MIME Type Mapping

The application now uses the following MIME type mappings:

| Extension | MIME Type | Notes |
|-----------|-----------|-------|
| `.mp4` | `video/mp4` | Standard MPEG-4 |
| `.m4v` | `video/mp4` | Apple MPEG-4 variant |
| `.mov` | `video/mp4` | Modern QuickTime (MPEG-4) |
| `.webm` | `video/webm` | WebM format |
| `.ogg`, `.ogv` | `video/ogg` | Ogg Theora |
| `.avi` | `video/x-msvideo` | Legacy format |
| `.wmv` | `video/x-ms-wmv` | Windows Media |
| `.flv` | `video/x-flv` | Flash Video |
| `.mkv` | `video/x-matroska` | Matroska |
| `.3gp` | `video/3gpp` | 3GPP format |
| `.3g2` | `video/3gpp2` | 3GPP2 format |

### Why .mov Works as video/mp4

Modern `.mov` files are container files that typically contain MPEG-4 encoded video streams. The QuickTime container format has evolved, and most `.mov` files created by modern devices (iPhones, cameras, etc.) use MPEG-4 encoding, which is the same video codec used in `.mp4` files.

By specifying `video/mp4` as the MIME type for `.mov` files, browsers can:
1. Recognize the video codec (MPEG-4/H.264)
2. Play the video natively without requiring QuickTime
3. Provide consistent playback across different browsers

### Browser Compatibility

This change enables .mov file playback on:
- ✅ Microsoft Edge (Chromium-based)
- ✅ Google Chrome
- ✅ Mozilla Firefox
- ✅ Safari (macOS/iOS)
- ✅ Most modern mobile browsers

### Fallback Behavior

If a `.mov` file cannot be played (e.g., using an older codec), the video element will:
1. Show the standard browser error message
2. In `note-content.component`, display a fallback with download link
3. Allow users to download the file for playback in external applications

## Components Affected

1. **Video Event Component** - For NIP-71 video events (kind 21/22)
2. **Note Content Component** - For inline videos in notes
3. **Video Player Component** - For floating video window playback

## Testing Recommendations

To test .mov file support:

1. Create a test event with a .mov file URL
2. Verify the video plays in the feed
3. Test with both modern MPEG-4 .mov files and legacy QuickTime files
4. Check that the MIME type is correctly set in browser DevTools
5. Verify fallback behavior for unsupported .mov variants

## Future Enhancements

Potential improvements:
1. **Codec Detection:** Inspect video streams to determine exact codec support
2. **Format Conversion:** Provide server-side conversion for legacy .mov files
3. **Progressive Enhancement:** Offer multiple sources (mp4, webm) for better compatibility
4. **User Settings:** Allow users to disable auto-play for certain video formats
