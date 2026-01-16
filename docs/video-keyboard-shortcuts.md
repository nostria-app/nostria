# Video Keyboard Shortcuts

This document describes the keyboard shortcuts available for video playback in Nostria.

## Supported Shortcuts

When a video is playing in the media player, the following keyboard shortcuts are available:

### Play/Pause
- **Space** - Toggle play/pause
- **K** - Toggle play/pause

### Seeking
- **J** or **Left Arrow** - Rewind 10 seconds
- **L** or **Right Arrow** - Fast forward 10 seconds

## Usage

These shortcuts work globally when:
1. A video is currently loaded in the media player
2. The user is not typing in an input field (input, textarea, or contenteditable element)

The shortcuts work in all video playback contexts:
- Video in the feed
- Video in event details
- Fullscreen video player
- Floating video player

## Implementation Details

The keyboard shortcuts are implemented in the main application component (`app.ts`) and use the `MediaPlayerService` for playback control. The service handles both audio and video playback, ensuring consistent behavior across different media types.

### Safety Features
- Input field detection prevents shortcuts from interfering with typing
- NaN validation prevents invalid video seeking operations
- Works with both regular video and HLS streaming
