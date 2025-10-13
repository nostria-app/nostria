# Media Player Window Controls Overlay Support

## Overview
This document describes the implementation of window-controls-overlay support for the media player component, ensuring proper behavior in both toolbar and fullscreen modes.

## Implementation Details

### Toolbar Mode (Window Controls Overlay)
When the app is installed as a PWA with `window-controls-overlay` display mode enabled:

1. **Draggable Regions**:
   - The entire media player host element acts as a draggable region using `-webkit-app-region: drag`
   - Child elements inherit this behavior with `-webkit-app-region: inherit`:
     - `.media-player` container
     - `.media-player-icon` (app icon)
     - `.titlebar-area` (page title display)
     - `.media-player-controls` (container for buttons)
   - Individual buttons override with `-webkit-app-region: no-drag` via the `.nodrag` class
   - This creates a seamless draggable titlebar with interactive controls

2. **Position and Size**:
   - Uses CSS environment variables to position within the titlebar:
     - `env(titlebar-area-x)` - Left position
     - `env(titlebar-area-y)` - Top position  
     - `env(titlebar-area-width)` - Width
     - `env(titlebar-area-height)` - Height
   - Falls back to standard values when window-controls-overlay is not active

3. **Titlebar Area**:
   - Displays page title in a dedicated draggable area
   - Only visible when `layout.overlayMode()` is true
   - Truncates with ellipsis when space is limited
   - Maximum width of 50% to leave room for controls

4. **Empty Space Dragging**:
   - The controls container inherits drag behavior
   - Empty space between buttons and around controls can be used to drag the window
   - Provides better UX by maximizing the draggable surface area

### Fullscreen Media Player Mode
When the media player is in fullscreen mode (footer mode expanded):

1. **Host Element Position Adjustment**:
   - The `:host.footer-mode.fullscreen-host` selector applies positioning to the entire component
   - `top: env(titlebar-area-height, 0px)` - Starts below the titlebar controls
   - `height: calc(100vh - env(titlebar-area-height, 0px))` - Adjusts height accordingly
   - Falls back to `0px` when window-controls-overlay is not active (full viewport)
   - This ensures the component container itself respects the titlebar area

2. **Inner Container Positioning**:
   - The `.media-player-footer.fullscreen-mode` class also applies the same titlebar adjustments
   - Provides a consistent positioning strategy at multiple levels
   - Both host and inner container respect window-controls-overlay

3. **Z-Index**: 
   - Uses `z-index: 10000` to appear above all other content
   - Higher than mobile navigation (z-index: 1000)
   - Ensures fullscreen media player is always on top

4. **Animation Support**:
   - Both entering and exiting fullscreen animations respect titlebar height
   - Smooth transitions using cubic-bezier easing
   - The `.exiting-fullscreen` class maintains the same positioning during exit animation

5. **Key Issue Resolved**:
   - The host element's positioning takes precedence due to CSS specificity
   - Both `:host.footer-mode.fullscreen-host` and `.media-player-footer.fullscreen-mode` must have matching titlebar adjustments
   - Without adjusting the host element, the inner positioning is ineffective

## CSS Environment Variables

The following CSS environment variables are used for window-controls-overlay support:

- `env(titlebar-area-x)` - Horizontal offset of the titlebar area
- `env(titlebar-area-y)` - Vertical offset of the titlebar area
- `env(titlebar-area-width)` - Width of the available titlebar area
- `env(titlebar-area-height)` - Height of the titlebar (typically 33px)

All variables include fallback values for when window-controls-overlay is not active.

## Browser Compatibility

The `-webkit-app-region` property is Chromium-specific and used for:
- Chrome/Edge PWAs with custom title bars
- Electron apps with frameless windows

The implementation includes fallbacks for browsers that don't support these features:
- Firefox, Safari: Standard positioning without window-controls-overlay
- Mobile browsers: Standard PWA experience

## Testing

To test window-controls-overlay support:

1. Install the app as a PWA in Chrome/Edge on Windows 11 or macOS
2. Verify the media player titlebar is draggable
3. Click buttons to ensure they work (not draggable)
4. Enter fullscreen mode and verify content doesn't overlap titlebar controls
5. Exit fullscreen and verify smooth transitions

## Related Files

- `src/app/components/media-player/media-player.component.scss` - Styles and draggable regions
- `src/app/components/media-player/media-player.component.ts` - Logic for fullscreen mode
- `src/app/components/media-player/media-player.component.html` - Template structure
- `public/manifest.webmanifest` - PWA configuration with `display_override: ["window-controls-overlay"]`

## References

- [Window Controls Overlay API](https://developer.mozilla.org/en-US/docs/Web/API/Window_Controls_Overlay_API)
- [PWA Custom Title Bars](https://web.dev/window-controls-overlay/)
