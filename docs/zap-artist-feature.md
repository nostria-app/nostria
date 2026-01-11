# Zap Artist Feature Implementation

## Overview
This document describes the implementation of zap functionality for artists and playlists in the Music section of the Nostria app.

## Problem Statement
Previously, zap functionality was only available on individual track details pages. Users could not zap artists directly from:
- Artist profile pages
- Artist cards in the artists list
- Music playlist cards

## Solution
Added zap buttons/menu items to all three locations, allowing users to easily send zaps to artists and playlist creators.

## Changes Made

### 1. Artist Profile Page (`music-artist.component`)

**File:** `src/app/pages/music/music-artist/music-artist.component.ts`

**Changes:**
- Added imports for `MatDialog`, `ZapDialogComponent`, and `ZapDialogData`
- Injected `MatDialog` service
- Added `zapArtist()` method that:
  - Gets the artist's pubkey and profile
  - Opens the ZapDialogComponent with artist details
  - Uses the same dialog width as other zap implementations (400px)

**File:** `src/app/pages/music/music-artist/music-artist.component.html`

**Changes:**
- Added a "Zap" button in the artist-actions section
- Positioned between "Play Artist" and "View Profile" buttons
- Uses `mat-stroked-button` for consistency
- Includes bolt icon and "Zap" label

### 2. Artists List (`artists.component`)

**File:** `src/app/pages/music/artists/artists.component.ts`

**Changes:**
- Added imports for `MatMenuModule`, `MatDialog`, `ZapDialogComponent`, and `ZapDialogData`
- Added `MatMenuModule` to component imports array
- Injected `MatDialog` service
- Added `zapArtist(event: MouseEvent, artistData: ArtistData)` method that:
  - Stops event propagation to prevent card click
  - Gets the artist's cached profile
  - Opens the ZapDialogComponent with artist details

**File:** `src/app/pages/music/artists/artists.component.html`

**Changes:**
- Added a menu button to each artist card
- Menu includes two options:
  - "Zap Artist" (with bolt icon)
  - "View Artist" (with person icon)
- Menu button uses `mat-icon-button` with three-dot vertical icon
- Positioned in top-right corner of each card
- Stops event propagation to prevent navigation when clicking menu

**File:** `src/app/pages/music/artists/artists.component.scss`

**Changes:**
- Made artist-card position relative to contain absolute menu button
- Added `.artist-menu-btn` styles:
  - Positioned absolutely in top-right corner
  - Initially hidden (opacity: 0)
  - Becomes visible on card hover/focus
  - Smooth opacity transition for better UX

### 3. Music Playlist Card (`music-playlist-card.component`)

**File:** `src/app/components/music-playlist-card/music-playlist-card.component.ts`

**Changes:**
- Added "Zap Creator" menu item to existing playlist menu
- Positioned after "Edit Playlist" (if own playlist) and before "Share Playlist"
- Uses existing `zapCreator()` method that was already implemented but not exposed in UI
- Includes bolt icon and "Zap Creator" label

## Technical Details

### Zap Dialog Integration
All implementations use the existing `ZapDialogComponent` which:
- Accepts `ZapDialogData` with recipient information
- Handles the complete zap flow (amount selection, payment, etc.)
- Is consistent with other zap functionality in the app

### Event Handling
- Artist list menu uses `event.stopPropagation()` to prevent card navigation
- Playlist card menu uses `$event` parameter in template to stop propagation
- All zap actions are non-blocking and don't interfere with other UI interactions

### Styling Consistency
- Used existing Angular Material components (`mat-stroked-button`, `mat-menu-item`, `mat-icon-button`)
- Followed app's color and spacing conventions
- Menu button visibility on hover provides clean UX without cluttering the interface

## Testing Checklist

To verify the implementation:

1. **Artist Profile Page:**
   - [ ] Navigate to any artist profile
   - [ ] Verify "Zap" button appears between "Play Artist" and "View Profile"
   - [ ] Click "Zap" button
   - [ ] Verify zap dialog opens with correct artist information
   - [ ] Test in both light and dark mode

2. **Artists List:**
   - [ ] Navigate to Music > Artists
   - [ ] Hover over any artist card
   - [ ] Verify three-dot menu button appears
   - [ ] Click menu button
   - [ ] Verify "Zap Artist" and "View Artist" options appear
   - [ ] Click "Zap Artist"
   - [ ] Verify zap dialog opens with correct artist information
   - [ ] Verify clicking the card still navigates to artist profile

3. **Playlist Cards:**
   - [ ] Navigate to any page showing playlist cards (e.g., artist profile playlists tab)
   - [ ] Click three-dot menu on any playlist card
   - [ ] Verify "Zap Creator" option appears in menu
   - [ ] Click "Zap Creator"
   - [ ] Verify zap dialog opens with correct creator information

## Code Quality

### Build Status
- ✅ Build completes successfully with no errors
- ⚠️ Some warnings present, but all are pre-existing CommonJS module warnings

### Linting
- ✅ No new linting errors introduced
- ⚠️ Some existing linting errors in modified files, but these are pre-existing issues

### Code Style
- Follows Angular standalone component patterns
- Uses signals for reactive state management
- Implements proper TypeScript typing
- Follows existing code conventions in the repository

## Future Improvements

Potential enhancements (not part of current implementation):
- Add zap counts/totals to artist cards to show engagement
- Add top zappers display on artist profiles
- Add zap history/leaderboard for artists
- Add batch zapping for multiple artists
