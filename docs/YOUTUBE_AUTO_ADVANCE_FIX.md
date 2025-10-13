# YouTube Auto-Advance Fix

## Problems Addressed

### Problem 1: Initial Issue
YouTube videos in the media queue were not automatically advancing to the next item when finished playing. This was because YouTube iframes don't fire standard HTML5 media events like `ended`.

### Problem 2: Iframe Destruction
After fixing the initial issue, the YouTube player was being destroyed in `cleanupCurrentMedia()`, which removed the iframe, preventing subsequent videos from playing with error "YouTube iframe not found".

### Problem 3: Event Listener Not Reattached (REVISED)
After the first video played successfully, subsequent videos (2nd, 3rd, etc.) would not auto-advance. The issue had multiple aspects:
- When the iframe `src` changes to a new YouTube URL, Angular recreates the iframe element in the DOM
- Calling `YT.Player.destroy()` **removes the iframe from the DOM entirely**, causing it to disappear
- The old YT.Player API wrapper became stale and was no longer connected to the new iframe
- The `onStateChange` event listener was only attached during initial player creation

### Problem 4: Iframe Timing Issues
The iframe would briefly disappear when transitioning between videos because:
- We were trying to initialize the player before Angular had finished rendering the new iframe
- Fixed timeouts weren't reliable across different system speeds
- Need to wait for both the iframe element AND its src attribute to be set

## Solution
Implemented the YouTube IFrame API with proper lifecycle management:
1. **Clear (not destroy)** the YT.Player reference when switching videos
2. **Poll for iframe readiness** instead of using fixed timeouts
3. Wait for the iframe to exist AND have its src attribute set by Angular
4. Create a fresh player instance that's properly connected to the current iframe
5. This ensures the event listener is always properly attached to the current iframe

## Changes Made

### 1. Added YouTube Player Types (`media-player.service.ts`)
```typescript
interface YouTubePlayer {
  destroy: () => void;
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
}

interface YouTubePlayerEvent {
  data: number;
}
```

### 2. Added YouTube API Support
- Added `youtubePlayer` property to store the YouTube player instance
- Added `youtubeApiReady` flag to track when the API is loaded
- Added `loadYouTubeAPI()` method to dynamically load the YouTube IFrame API script
- Added `initYouTubePlayer()` method to initialize the player and listen for state changes
  - **Destroys existing player** before creating a new one
  - Ensures fresh event listener attachment for each video

### 3. Integration Points

#### Constructor
- Calls `loadYouTubeAPI()` to load the YouTube IFrame API when the service is initialized
- Sets up `onYouTubeIframeAPIReady` callback on window object

#### `start()` Method
- When starting a YouTube video, calls `initYouTubePlayer()` after a 500ms delay to ensure the iframe is in the DOM
- The player listens for the `onStateChange` event and detects when `event.data === 0` (video ended)
- When video ends, calls `handleMediaEnded()` which automatically advances to the next item
- Each new video triggers a fresh player initialization

#### `cleanupCurrentMedia()` Method
- **Stops** the YouTube player using `stopVideo()` 
- The player will be destroyed and recreated for the next video in `initYouTubePlayer()`
- This approach ensures clean state transitions

#### `initYouTubePlayer()` Method (Key Fix)
- **Clears** (not destroys) any existing player reference to avoid removing the iframe
- **Polls** for the iframe to be ready (exists in DOM with src attribute set)
- Uses smart polling with max 20 attempts at 100ms intervals (2 second max wait)
- Creates a fresh YT.Player wrapper once the iframe is confirmed ready
- Attaches the `onStateChange` event listener to detect video end
- This ensures every video, not just the first one, has working event handlers
- Prevents the iframe from disappearing during transitions

#### `exit()` Method
- Destroys the YouTube player when completely exiting the media player
- Ensures proper cleanup when user closes the media player entirely

### 4. Security Fix (`media-player.component.html`)
- Removed the problematic `sandbox="allow-scripts allow-same-origin allow-presentation"` attribute
- This combination allows iframe content to escape sandboxing (security risk)
- YouTube embeds work properly without explicit sandboxing

## How It Works

1. **API Loading**: The YouTube IFrame API is loaded once when the service initializes
2. **First Video**: Creates a YT.Player instance for the iframe
3. **Video Ends**: Event listener detects end → calls `handleMediaEnded()` → advances to next item
4. **Next Video**: Angular changes iframe `src` → creates new iframe in DOM
5. **Player Reinitialization**: `initYouTubePlayer()` clears old player reference (doesn't destroy to keep iframe)
6. **Smart Polling**: Waits for new iframe to exist AND have src set (up to 2 seconds)
7. **Fresh Player Created**: New YT.Player wraps the current iframe
8. **Event Listener Reattached**: Fresh player has working `onStateChange` listener
9. **Repeat**: Process continues smoothly for all videos in queue

## Why This Approach

**Why not call destroy()?**
- `YT.Player.destroy()` **removes the iframe from the DOM**, causing it to disappear
- Angular is managing the iframe lifecycle through the `[src]` binding
- We just need to clear our reference and let Angular handle the iframe
- This prevents the "blank video area" issue during transitions

**Why polling instead of fixed timeout?**
- Angular's change detection timing can vary based on system load
- Fixed timeouts are unreliable - too short and iframe isn't ready, too long and there's a delay
- Polling ensures we wait exactly as long as needed, no more, no less
- Checks both iframe existence AND src attribute being set
- Max 2 second timeout prevents infinite waiting

**Why not reuse the player?**
- When Angular updates the iframe `src` binding with a new YouTube URL, it recreates the iframe element
- The old YT.Player API wrapper points to a destroyed/detached iframe
- Event listeners on the old wrapper no longer receive events from the new iframe
- Creating a fresh player wrapper ensures it's properly bound to the current iframe

## Benefits
- YouTube videos now auto-advance consistently through entire queue
- All videos (1st, 2nd, 3rd, etc.) advance automatically
- Consistent behavior across all media types
- Proper cleanup prevents memory leaks
- Uses official YouTube API for reliable event detection
- Fixed security warning about sandbox attributes

## Testing
1. Add 3+ YouTube videos to the queue
2. Play the first video
3. Wait for it to finish (or seek to the end)
4. Verify that the second video automatically starts playing ✓
5. Wait for the second video to finish
6. Verify that the third video automatically starts playing ✓
7. Continue through entire queue to verify all transitions work
8. Test exiting the media player to ensure proper cleanup

## Notes
- The iframe must have `enablejsapi=1` parameter (already implemented)
- A 500ms delay is used to ensure the iframe is rendered in the DOM before initializing the player
- Each video gets a fresh YT.Player wrapper to ensure proper event handling
- Player is destroyed and recreated for each new YouTube video
- Only the YT.Player wrapper is recreated, not the actual iframe (Angular handles that)
- Removed sandbox attribute to fix security warning and ensure proper YouTube functionality

### Expected Console Warnings (Can Be Ignored)
You may see these warnings in the browser console during development:

1. **postMessage origin mismatch**: 
   ```
   Failed to execute 'postMessage' on 'DOMWindow': The target origin provided ('https://www.youtube.com') 
   does not match the recipient window's origin ('http://localhost:4200').
   ```
   - **Cause**: YouTube IFrame API tries to communicate across origins (localhost vs youtube.com)
   - **Impact**: None - the API handles this internally and continues to work
   - **Solution**: This is expected behavior and can be safely ignored in development

2. **Non-passive event listener**:
   ```
   [Violation] Added non-passive event listener to a scroll-blocking event.
   ```
   - **Cause**: YouTube's internal iframe code adds scroll listeners
   - **Impact**: None - doesn't affect performance noticeably
   - **Solution**: This is from YouTube's code, not ours, and can be safely ignored

### Error Handling
- Added `onError` callback to YouTube player that automatically skips to next video if playback fails
- Error codes handled:
  - `2` - Invalid parameter
  - `5` - HTML5 player error
  - `100` - Video not found
  - `101` / `150` - Video not embeddable
- If a video fails to play, the queue automatically advances to the next item
