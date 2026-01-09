# Music Listing Improvements

## Overview
Enhanced the music feature with dynamic width-based rendering on the main page and sort options on dedicated listing pages to improve user experience and content organization.

## Changes Implemented

### 1. Dynamic Width-Based Rendering (Main Music Page)
- **Problem**: Tracks and playlists could wrap to multiple lines on narrower screens
- **Solution**: Implemented dynamic calculation of how many items fit in one row based on container width
- Items are now rendered up to the maximum that fits without wrapping
- "Show all" button appears when there are more items than can fit in one row

#### Implementation Details:
- Added `containerWidth` signal to track the music content container width
- Added `@HostListener('window:resize')` to update width on window resize
- Created `calculatePlaylistLimit()` method:
  - Playlist cards: minmax(160px, 1fr) with 16px gap
  - Dynamically calculates items per row based on container width
- Created `calculateTrackLimit()` method:
  - Track cards: minmax(180px, 1fr) with 16px gap
  - Dynamically calculates items per row based on container width
- Updated all preview computeds to use dynamic limits instead of static `SECTION_LIMIT`
- Added `#musicContent` template reference for width tracking

### 2. Sort Options (All Songs and All Playlists Pages Only)
Added three sort options on the dedicated "All Songs" and "All Playlists" pages:
- **Recents** (default): Sort by creation date (newest first)
- **Alphabetical**: Sort by title A-Z
- **Artist**: Sort by artist name for tracks, pubkey for playlists

#### Implementation Details:
- Added `sortBy` signal to both music-tracks and music-playlists components
- Created sorting logic within the `filteredTracks` and `filteredPlaylists` computed signals
- Added `MatSelectModule` to component imports
- Integrated `mat-select` dropdown in the header-actions section
- Sort control positioned before the Following/Public toggle

## Files Modified

### music.component.ts (Main Music Page)
- Added import: `HostListener` from @angular/core
- Added signal: `containerWidth` for tracking container width
- Added ViewChild: `musicContent` for container element reference
- Added methods:
  - `updateContainerWidth()`: Updates container width signal
  - `calculatePlaylistLimit()`: Calculates max playlists per row
  - `calculateTrackLimit()`: Calculates max tracks per row
  - `onResize()`: Window resize handler
- Modified preview computeds to use dynamic limits:
  - `followingPlaylistsPreview`, `hasMoreFollowingPlaylists`
  - `followingTracksPreview`, `hasMoreFollowingTracks`
  - `publicPlaylistsPreview`, `hasMorePublicPlaylists`
  - `publicTracksPreview`, `hasMorePublicTracks`

### music.component.html (Main Music Page)
- Added `#musicContent` template reference to music-content div

### music-tracks.component.ts (All Songs Page)
- Added import: `MatSelectModule` from @angular/material/select
- Added signal: `sortBy` with default value 'recents'
- Modified `filteredTracks` computed to include sorting logic:
  - Alphabetical: Sorts by title tag
  - Artist: Sorts by artist tag
  - Recents: Uses existing order (already sorted by created_at)
- Added sort dropdown to template with three options
- Added `.sort-select` styles and updated `.header-actions` to include flex-wrap

### music-playlists.component.ts (All Playlists Page)
- Added import: `MatSelectModule` from @angular/material/select
- Added signal: `sortBy` with default value 'recents'
- Modified `filteredPlaylists` computed to include sorting logic:
  - Alphabetical: Sorts by title tag
  - Artist: Sorts by pubkey (as proxy for playlist creator)
  - Recents: Uses existing order (already sorted by created_at)
- Added sort dropdown to template with three options
- Added `.sort-select` styles and updated `.header-actions` to include flex-wrap

## User Experience Benefits

### Main Music Page:
1. **No Wrapping**: Content now fits perfectly in available width without wrapping to multiple lines
2. **Adaptive Display**: Shows more items on wider screens, fewer on narrow screens
3. **Progressive Disclosure**: "Show all" appears only when there are more items than fit in one row
4. **Clean Layout**: Maintains visual consistency across different screen sizes

### All Songs & All Playlists Pages:
1. **Organized Browsing**: Users can organize large lists by preference (recent, alphabetical, or by artist)
2. **Quick Discovery**: Alphabetical sorting helps users quickly find specific tracks/playlists
3. **Artist Grouping**: Artist sort groups content by creator for exploring specific artists' work
4. **Consistent Interface**: Same sort options across both Songs and Playlists pages
5. **Responsive Design**: Sort controls adapt to screen size with flex-wrap

## Technical Notes

### Main Page:
- Container width is calculated after component initialization with 100ms delay to ensure DOM is ready
- Dynamic limit calculation ensures at least 1 item is always shown
- Resize listener efficiently updates layout on window size changes
- No sorting functionality on main page - keeps it simple and fast

### Dedicated Pages:
- Sort logic is applied in computed signals for reactive updates
- Default sorting (Recents) uses the existing created_at sort from subscription
- Alphabetical and Artist sorts create new sorted arrays using spread operator
- Sort selection is maintained in component state (not persisted across sessions)
- All sorting uses case-sensitive `localeCompare()` for proper alphabetical ordering
