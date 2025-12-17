# Wake Lock Implementation for Video Playback

## Overview
This implementation adds screen wake lock functionality to prevent the device screen from dimming or locking while videos are playing in the Nostria app.

## Implementation Summary

### Components Added/Modified

1. **New: `wake-lock.service.ts`**
   - Core service managing the Screen Wake Lock API
   - Automatically detects browser support
   - Handles visibility changes to re-acquire lock when needed
   - Provides graceful fallback for unsupported browsers

2. **Modified: `video-playback.service.ts`**
   - Integrated WakeLockService
   - Enables wake lock when a video starts playing
   - Disables wake lock when video pauses or no video is playing
   - Uses Angular effects to react to video playback state changes

3. **Modified: `media-player.service.ts`**
   - Added event listeners for video play/pause events
   - Enables wake lock when media player video starts
   - Disables wake lock when media player video pauses

4. **Modified: `video-event.component.ts/.html`**
   - Added pause event handler to properly track video state
   - Unregisters video from playback service when paused

## How It Works

### Inline Videos (Feed)
1. When a video in the feed starts playing (`onVideoPlay` event), it's registered with `VideoPlaybackService`
2. `VideoPlaybackService` detects the playing video via an effect and calls `WakeLockService.enable()`
3. The wake lock prevents the screen from dimming/locking
4. When the video pauses or stops, `VideoPlaybackService` calls `WakeLockService.disable()`
5. The screen can now dim/lock normally

### Media Player Videos
1. When the media player's video element plays, the `handleVideoPlay` listener calls `WakeLockService.enable()`
2. When it pauses, the `handleVideoPause` listener calls `WakeLockService.disable()`

### Visibility Handling
- If the app is backgrounded/hidden and then brought back to the foreground while a video is playing, the wake lock is automatically re-acquired
- This is handled by a `visibilitychange` event listener in the WakeLockService

## Browser Support

The Screen Wake Lock API is supported in:
- ✅ Chrome/Edge 84+
- ✅ Opera 70+
- ✅ Safari 16.4+
- ❌ Firefox (gracefully handled - no errors, just no wake lock)

For unsupported browsers, the service detects this and logs a debug message but doesn't throw errors.

## Manual Testing Guide

### Prerequisites
- A device/browser that supports the Screen Wake Lock API (Chrome, Edge, Safari)
- Video content in the Nostria feed or media player

### Test Scenarios

#### 1. Inline Video in Feed
**Steps:**
1. Open the app and navigate to a feed with video content
2. Tap/click to expand and play a video
3. Observe that the screen stays awake without dimming
4. Let the video play for longer than your device's screen timeout setting
5. Verify the screen doesn't dim or lock
6. Pause the video
7. Wait for your device's normal screen timeout
8. Verify the screen now dims/locks normally

**Expected Result:** Screen stays awake only while video is playing, returns to normal behavior when paused.

#### 2. Media Player Video
**Steps:**
1. Open a video in the media player component
2. Play the video
3. Observe that the screen stays awake
4. Let it play past the normal screen timeout
5. Verify screen doesn't dim
6. Pause the video
7. Verify screen can now dim normally after timeout

**Expected Result:** Same as inline video test.

#### 3. Switching Between Videos
**Steps:**
1. Play video A in the feed
2. Scroll and play video B (this should auto-pause video A)
3. Verify screen stays awake with video B playing
4. Pause video B
5. Verify screen can dim

**Expected Result:** Wake lock switches cleanly between videos, no issues with multiple wake locks.

#### 4. Background/Foreground Switching
**Steps:**
1. Play a video
2. Switch to another app or minimize the browser
3. Wait a moment, then return to the app
4. If the video is still playing, verify screen stays awake
5. If the video auto-paused, verify screen can dim

**Expected Result:** Wake lock is re-acquired when returning to the app if video is still playing.

#### 5. Unsupported Browser (e.g., Firefox)
**Steps:**
1. Open the app in Firefox
2. Play a video
3. Check browser console for any errors
4. Verify app still functions normally

**Expected Result:** No errors, app works normally, but wake lock feature is not available (screen may dim).

### Debugging

To verify wake lock behavior in the console:
1. Open browser DevTools
2. Look for these log messages:
   - `[WakeLock] Screen Wake Lock API not supported` - API not available
   - `[WakeLock] Wake lock acquired` - Lock successfully acquired
   - `[WakeLock] Wake lock released` - Lock released
   - `[MediaPlayer] Video playing, enabling wake lock` - Media player video playing
   - `[MediaPlayer] Video paused, disabling wake lock` - Media player video paused

### Known Limitations

1. **Mobile Safari Background Behavior:** When the browser is backgrounded, iOS may release the wake lock. It will be re-acquired when the app becomes visible again.

2. **Firefox:** Does not support the Screen Wake Lock API. The app will function normally but won't prevent screen dimming.

3. **Power Saving Modes:** Some devices in aggressive power-saving modes may override wake locks.

## Security and Privacy

The Screen Wake Lock API requires:
- User interaction to activate (videos must be manually played by user)
- Only works on secure contexts (HTTPS)
- Automatically released when the page is hidden

The implementation respects these constraints and doesn't attempt to circumvent them.

## Future Enhancements

Potential improvements:
1. Add a user setting to disable wake lock functionality
2. Show a visual indicator when wake lock is active
3. Add analytics to track wake lock acquisition/release events
4. Handle more edge cases (e.g., picture-in-picture mode)
