# Album Cover Style Update - Spotify-like Design

## Overview
Updated all album and song cover images throughout the Music section of the Nostria app to have a consistent, Spotify-like design with symmetric square shapes and rounded corners.

## Changes Made

### Design Philosophy
The previous design had covers that appeared more like "polaroids" with:
- Excessive shadows (e.g., `box-shadow: 0 4px 60px rgba(0, 0, 0, 0.5)`)
- Variable border-radius using Material Design tokens
- Inconsistent styling across components

The new design follows Spotify's cleaner approach with:
- Consistent border-radius values (8px for most covers, 6px for smaller ones)
- Lighter shadows (using `var(--mat-sys-level2)` instead of `level3`)
- Perfect square aspect ratios (1:1)
- Uniform styling across all music components

### Files Modified

#### 1. Music Event Component (`music-event.component.ts`)
- **Card mode (vertical)**: Added `border-radius: 8px` to `.card-cover`
- **List mode (horizontal)**: Updated border-radius from `8px` to `6px` for `.music-cover` (smaller size)

#### 2. Music Playlist Card Component (`music-playlist-card.component.ts`)
- Added `aspect-ratio: 1` to ensure perfect square
- Added `border-radius: 8px` to `.playlist-cover`

#### 3. Song Detail Component (`song-detail.component.scss`)
- Updated `.cover-image` border-radius from `var(--mat-sys-corner-large)` to `8px`
- Reduced shadow from `level3` to `level2`
- Updated `.cover-placeholder` border-radius to `8px`
- Updated `.cover-gradient` border-radius to `8px` and shadow to `level2`

#### 4. Music Playlist Component (`music-playlist.component.scss`)
- Updated all cover elements border-radius from `var(--mat-sys-corner-medium)` to `8px`
- Changed shadow from `0 4px 60px rgba(0, 0, 0, 0.5)` to `var(--mat-sys-level2)` (removes polaroid effect)

#### 5. Main Music Component (`music.component.scss`)
- Added `border-radius: 8px` to:
  - `.liked-songs-cover`
  - `.liked-playlists-cover`
  - `.your-records-cover`
  - `.offline-music-cover`

#### 6. Import RSS Dialog (`import-rss-dialog.component.scss`)
- Updated `.album-cover` border-radius from `var(--mat-sys-corner-medium)` to `8px`
- Updated `.track-cover` border-radius from `var(--mat-sys-corner-small)` to `6px`

#### 7. Edit Playlist Dialog (`edit-music-playlist-dialog.component.scss`)
- Updated `.cover-preview` border-radius from `var(--mat-sys-corner-medium)` to `8px`

#### 8. Create Playlist Dialog (`create-music-playlist-dialog.component.scss`)
- Updated `.cover-preview` border-radius from `var(--mat-sys-corner-medium)` to `8px`

#### 9. Music Track Dialog (`music-track-dialog.component.scss`)
- Updated `.cover-preview` border-radius from `var(--mat-sys-corner-medium)` to `8px`

## Visual Impact

### Before
- Album covers had varying levels of rounded corners based on Material Design tokens
- Heavy shadows created a polaroid/physical photo appearance
- Inconsistent styling across different views

### After
- All covers now have consistent 8px border-radius (6px for smaller covers)
- Lighter, more subtle shadows
- Clean, modern Spotify-like appearance
- Symmetric square shapes maintained throughout

## Border Radius Guidelines

For future development, use these border-radius values for music covers:

| Cover Size | Border Radius | Example Components |
|-----------|---------------|-------------------|
| Large (200px+) | 8px | Song detail, Playlist header |
| Medium (100-200px) | 8px | Playlist cards, Special cards |
| Small (64-100px) | 6px | List mode tracks, Dialogs |

## Technical Notes

- All covers maintain `aspect-ratio: 1` for perfect squares
- Using hardcoded pixel values (8px, 6px) instead of Material Design tokens for consistency
- Shadows use Material Design level tokens (`var(--mat-sys-level2)`) for theme compatibility
- Changes are purely CSS-based, no TypeScript logic changes required
- Build completes successfully with no errors

## Browser Compatibility

The `aspect-ratio` CSS property is supported in all modern browsers:
- Chrome 88+
- Firefox 89+
- Safari 15+
- Edge 88+

This aligns with the app's existing browser support requirements.
