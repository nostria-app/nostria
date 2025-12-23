# Audio Player Revamp

This document describes the massive revamp of the audio player component, introducing multiple player views with fluid animations and a slide-down playlist drawer.

## Overview

The audio player now supports three distinct views that users can toggle between, each offering a unique visual experience:

1. **Modern View** - Enhanced player with blurred album art background glow
2. **Cards View** - 3D card carousel with swipe navigation and circular progress bar
3. **WinAmp View** - Retro-inspired design based on the classic WinAmp player

## Architecture

### New Components & Directives

```
src/app/shared/audio-player/
├── audio-player.component.ts       (modified - view management)
├── audio-player.component.html     (modified - expanded mode UI)
├── audio-player.component.scss     (modified - new styles)
├── swipe-gesture.directive.ts      (NEW - reusable swipe handling)
├── circular-progress.component.ts  (NEW - SVG circular track bar)
├── modern-player-view/
│   ├── modern-player-view.component.ts
│   ├── modern-player-view.component.html
│   └── modern-player-view.component.scss
├── cards-player-view/
│   ├── cards-player-view.component.ts
│   ├── cards-player-view.component.html
│   └── cards-player-view.component.scss
├── winamp-player-view/
│   ├── winamp-player-view.component.ts
│   ├── winamp-player-view.component.html
│   └── winamp-player-view.component.scss
└── playlist-drawer/
    ├── playlist-drawer.component.ts
    ├── playlist-drawer.component.html
    └── playlist-drawer.component.scss
```

## Features

### View Switching
- Users can switch between views using buttons in the player header
- View preference is persisted to localStorage (`nostria-audio-player-view`)
- Smooth transitions between views

### Swipe Gestures
The `SwipeGestureDirective` provides unified touch and mouse gesture handling:
- **Swipe up** on minimized player to expand
- **Swipe down** on expanded player to minimize
- **Swipe left/right** on cards view to change tracks
- **Drag down** on playlist drawer to close

### Modern View
- Full-screen album art with blur filter creating a "glow" effect
- Rotating conic-gradient glow ring animation
- Volume slider integration
- Clean, minimalist controls

### Cards View
- 3D perspective card carousel showing previous/current/next tracks
- Cards animate with swipe gestures (rotation and translation)
- Circular SVG progress bar with click-to-seek functionality
- Swipe threshold to trigger track change

### WinAmp View
- Classic WinAmp color scheme (#00ff00 on dark background)
- LED-style display area with scrolling title marquee
- Fake spectrum visualizer bars with animation
- 10-band equalizer UI (visual only)
- Retro button styling

### Playlist Drawer
- Slides down from top when activated
- Drag gesture to close (swipe down)
- Shows current queue with track thumbnails
- Drag-and-drop reordering using Angular CDK
- Clear queue functionality
- Playing indicator animation on current track

## Technical Details

### Signals
All components use Angular signals for reactive state:
- `currentView: signal<PlayerViewType>()` - Current active view
- `showQueue: signal<boolean>()` - Playlist drawer visibility
- `dragOffset: signal<number>()` - Swipe animation offset

### Computed Properties
- `trackArt: computed()` - Album art URL with fallback
- `formattedCurrentTime: computed()` - Time display formatting
- `progressPercent: computed()` - Track progress percentage

### CSS Variables Used
- `--mat-sys-surface-container` - Background surfaces
- `--mat-sys-on-surface` - Text colors
- `--mat-sys-primary` - Accent colors
- `--mat-sys-outline` - Border colors

### Dark Mode
All components support dark mode through `:host-context(.dark)` selectors where needed (most styling uses CSS variables that automatically adapt).

## User Interactions

| Action | Result |
|--------|--------|
| Click view buttons | Switch between Modern/Cards/WinAmp views |
| Swipe up on minimized | Expand player |
| Swipe down on expanded | Minimize player |
| Swipe left/right on cards | Previous/Next track |
| Click queue button | Open playlist drawer |
| Drag down on drawer | Close playlist drawer |
| Click circular progress | Seek to position |
| Drag tracks in queue | Reorder playlist |

## Performance Considerations

- Views are lazy-loaded using `@switch` (only active view is rendered)
- Swipe gesture uses RAF for smooth animations
- Background blur uses CSS filter (GPU accelerated)
- Animations use CSS transforms (no layout thrashing)
