# Video Recording Feature

## Overview
Implemented in-app video recording with direct publishing to Nostr as short-form video events. Users can record videos up to 6.3 seconds, customize metadata, and publish them as replaceable video events (NIP-71).

## Implementation Date
November 16, 2025

## Features

### Video Recording
- **Maximum Duration**: 6.3 seconds (configurable via `MAX_DURATION_MS`)
- **Camera Selection**: Toggle between front (user) and back (environment) cameras
- **Real-time Preview**: Live camera feed during recording
- **Progress Indicator**: Visual progress bar showing recording time remaining
- **Recording Controls**: Start, stop, retake, and use video buttons

### Camera Features
- Auto-select best available codec (VP9, VP8, WebM, MP4)
- 1080x1920 ideal resolution for portrait videos
- Audio recording included
- Camera flip button (hidden during recording)
- Live preview with automatic stream management

### Publishing Integration
- Automatic upload to configured media servers after recording
- Seamless integration with media publish dialog
- Auto-detection of short-form videos (defaults to kind 22)
- Support for addressable short videos (kind 34236)
- Thumbnail extraction from recorded video
- Metadata customization: title, description, tags, content warnings

## Technical Implementation

### New Component: VideoRecordDialogComponent

**File**: `src/app/pages/media/video-record-dialog/video-record-dialog.component.ts`

Key features:
- Uses MediaRecorder API for video capture
- Signal-based reactive state management
- Automatic cleanup on component destroy
- Progress tracking with interval-based animation
- Blob to File conversion for upload compatibility

```typescript
// Recording constraints
private readonly MAX_DURATION_MS = 6300; // 6.3 seconds

// Supported MIME types (in order of preference)
const types = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];
```

### Media Component Integration

**File**: `src/app/pages/media/media.component.ts`

Added `openRecordVideoDialog()` method:
- Opens video recording dialog
- Handles upload of recorded video to media servers
- Automatically opens publish dialog after successful upload
- Provides user feedback via snackbar notifications

### Media Publish Dialog Enhancement

**File**: `src/app/pages/media/media-publish-dialog/media-publish-dialog.component.ts`

Updated `getDefaultKind()` method:
- Detects short-form videos based on MIME type (webm) or file size (< 10MB)
- Defaults to kind 22 (short video) for recorded/small videos
- Defaults to kind 21 (normal video) for larger uploaded videos
- Maintains support for addressable video kinds (34235, 34236)

```typescript
const isLikelyRecorded = this.data.mediaItem.type?.includes('webm') || 
                         (this.data.mediaItem.size && this.data.mediaItem.size < 10 * 1024 * 1024);

return isLikelyRecorded ? 22 : 21;
```

## User Interface

### Recording Dialog Layout
- **Header**: Dynamic title based on state (Recording/Preview/Record Video)
- **Content**: 
  - Camera preview with live stream
  - Recording indicator with pulsing red dot
  - Progress bar showing elapsed time
  - Camera flip button (top-right, only when not recording)
- **Actions**: Context-sensitive buttons based on state

### States
1. **Initial**: "Start Recording" button and "Cancel"
2. **Recording**: "Stop Recording" button (red) with progress bar
3. **Preview**: "Retake" and "Use Video" buttons

### Media Page Integration
- New "Record Video" button added to media page header
- Positioned before "Upload Media" button
- Disabled during uploads
- Material icon: `videocam`

## Recording Workflow

1. **User clicks "Record Video"** on media page
2. **Browser requests camera permission** (if not already granted)
3. **Camera preview appears** with live feed
4. **User clicks "Start Recording"**
   - Recording begins with audio
   - Red dot indicator appears
   - Progress bar starts animating
5. **Recording auto-stops at 6.3 seconds** or user clicks "Stop Recording"
6. **Preview screen shows recorded video**
   - User can retake or proceed
7. **User clicks "Use Video"**
   - Dialog closes
   - Video uploads to media servers
   - Publish dialog opens automatically
8. **User customizes metadata**:
   - Title (required)
   - Content/description
   - Thumbnail (auto-extracted or custom)
   - Tags
   - Content warning
   - Event type (22 or 34236)
9. **User clicks "Publish"**
   - Event created and signed
   - Published to user's relays
   - Success notification shown

## NIP Compliance

### NIP-71: Video Events
- **Kind 22**: Short-form vertical videos (default for recorded videos)
- **Kind 34236**: Addressable short-form videos (updateable)

### Event Structure
```json
{
  "kind": 22,
  "content": "Description of the video",
  "tags": [
    ["title", "Video Title"],
    ["imeta",
      "url https://media.server.com/video.webm",
      "m video/webm",
      "x <sha256-hash>",
      "size <bytes>",
      "image <thumbnail-url>",
      "dim <width>x<height>",
      "blurhash <encoded-hash>",
      "duration <seconds>"
    ],
    ["published_at", "<timestamp>"],
    ["t", "hashtag"]
  ]
}
```

### Addressable Short Videos (kind 34236)
Optional d-tag for updateable events:
```json
{
  "kind": 34236,
  "tags": [
    ["d", "<unique-identifier>"],
    ...
  ]
}
```

## Browser Compatibility

### Supported Browsers
- ✅ Chrome/Edge (full support)
- ✅ Firefox (no `playsinline` support, non-critical)
- ✅ Safari (iOS/macOS with getUserMedia support)
- ✅ Opera

### Required Permissions
- Camera access
- Microphone access

### Feature Detection
- MediaRecorder API availability check
- MIME type support verification
- Graceful degradation if recording not supported

## File Structure

### New Files
```
src/app/pages/media/video-record-dialog/
├── video-record-dialog.component.ts
├── video-record-dialog.component.html
└── video-record-dialog.component.scss
```

### Modified Files
```
src/app/pages/media/
├── media.component.ts (added openRecordVideoDialog method)
├── media.component.html (added Record Video button)
└── media-publish-dialog/
    └── media-publish-dialog.component.ts (updated getDefaultKind)
```

## Styling

### Component Styles
- Dark theme compatible with Material 3
- Responsive design (max-width: 90vw)
- Pulsing animation for recording indicator
- Semi-transparent overlays for controls
- Smooth transitions between states

### CSS Variables Used
- `--mat-sys-surface-container`
- Material Design elevation levels
- Standard Material color palette

## Security & Privacy

### Permissions
- Explicit camera/microphone permission required
- Permissions requested only when recording starts
- Stream automatically stopped when dialog closes

### Data Handling
- Video data stored in memory as Blob
- Automatic cleanup on component destroy
- No data persisted until user confirms upload
- Secure upload to user-configured media servers

## Performance Considerations

### Optimization
- Progressive video encoding during recording
- Efficient blob chunking
- Automatic stream cleanup
- Minimal re-renders with signals
- Lazy component loading

### Resource Management
- MediaStream tracks stopped on cleanup
- Object URLs revoked properly
- Timer cleanup on component destroy
- Memory-efficient blob handling

## Future Enhancements

### Potential Features
- [ ] Video filters and effects
- [ ] Countdown timer before recording
- [ ] Pause/resume recording
- [ ] Custom duration limits (user configurable)
- [ ] Video trimming/editing
- [ ] Multiple clips recording
- [ ] Audio-only recording mode
- [ ] Screen recording option
- [ ] Quality/resolution selection
- [ ] Storage usage display

### NIP Extensions
- [ ] Live streaming support (NIP-53)
- [ ] Video reactions and clips
- [ ] Collaborative videos
- [ ] Video playlists

## Testing Recommendations

### Manual Testing
- ✅ Record video with front camera
- ✅ Record video with back camera (mobile)
- ✅ Test auto-stop at 6.3 seconds
- ✅ Test manual stop before limit
- ✅ Test retake functionality
- ✅ Test cancel during recording
- ✅ Verify upload success
- ✅ Check publish dialog opens with correct defaults
- ✅ Verify metadata customization
- ✅ Test publishing to relays
- ✅ Verify event format compliance

### Browser Testing
- ✅ Chrome (Windows/Mac/Android)
- ✅ Firefox (Windows/Mac/Android)
- ✅ Safari (iOS/macOS)
- ✅ Edge (Windows)

### Permission Testing
- ✅ First-time permission request
- ✅ Permission denied handling
- ✅ Permission revoked during use
- ✅ Multiple camera devices

### Error Scenarios
- ✅ Camera unavailable
- ✅ Upload failure
- ✅ Network disconnection
- ✅ Insufficient storage

## Related Features
- Media upload functionality
- Media publish dialog
- Video thumbnail extraction
- Blurhash generation
- NIP-71 video events
- Addressable events (NIP-71)
- Media server management

## References
- [NIP-71: Video Events](https://github.com/nostr-protocol/nips/blob/master/71.md)
- [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [getUserMedia API](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [BUD-02: Blob upload and management](https://github.com/hzrd149/blossom/blob/master/buds/02.md)
