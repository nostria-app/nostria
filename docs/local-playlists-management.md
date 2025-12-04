# Local Playlists Management Feature

## Overview
This feature adds comprehensive local playlist management capabilities to Nostria, allowing users to organize their media into different playlists with custom names.

## Features Added

### 1. Add Media to Playlists from Media Queue
- **Individual Track Addition**: Users can add individual tracks from the media queue to playlists using the "Add to playlist" button next to each track.
- **Bulk Addition**: Users can add the entire media queue to a playlist using the "Add entire queue to playlist" button in the header.

### 2. Playlist Selection Dialog
A new dialog component (`SelectPlaylistDialogComponent`) allows users to:
- Select an existing playlist to add media to
- Create a new playlist directly from the dialog
- View playlist details (title, number of tracks)

### 3. Rename Playlist Functionality
- **Quick Rename**: Users can rename playlists directly from the playlists page using the "Rename" option in the context menu.
- **Rename Dialog**: A dedicated dialog (`RenamePlaylistDialogComponent`) provides a user-friendly interface for renaming playlists.

### 4. Enhanced Playlist Service
New methods added to `PlaylistService`:
- `addTracksToPlaylist(playlistId: string, tracks: PlaylistTrack[])`: Adds tracks to an existing playlist
- `renamePlaylist(playlistId: string, newTitle: string)`: Renames a playlist

## User Flow

### Adding Media to Playlist
1. Navigate to the Media Queue page
2. Either:
   - Click the "Add to playlist" button next to a specific track, OR
   - Click the "Add entire queue to playlist" button in the header
3. In the dialog that appears:
   - Select an existing playlist, OR
   - Click "Create New Playlist" and enter a name
4. Receive confirmation with option to navigate to playlists page

### Renaming a Playlist
1. Navigate to the Playlists page
2. Click the three-dot menu on any playlist
3. Select "Rename"
4. Enter the new name in the dialog
5. Click "Rename" to confirm

## Technical Details

### New Components
- **SelectPlaylistDialogComponent**: `/src/app/components/select-playlist-dialog/`
  - Allows selection or creation of playlists when adding media
  - Displays list of existing playlists
  - Includes form for creating new playlists

- **RenamePlaylistDialogComponent**: `/src/app/components/rename-playlist-dialog/`
  - Simple dialog for renaming playlists
  - Form validation to ensure playlist name is not empty

### Updated Components
- **MediaQueueComponent**: `/src/app/pages/media-queue/`
  - Added `addToPlaylist(item: MediaItem)` method
  - Added `addQueueToPlaylist()` method
  - Updated template with new buttons and tooltips
  - Includes `PlaylistsTabComponent` for playlist management

- **PlaylistsTabComponent**: `/src/app/pages/media-queue/playlists-tab/`
  - Added `renamePlaylist(playlist: Playlist)` method
  - Updated template with rename menu item

### Service Updates
- **PlaylistService**: `/src/app/services/playlist.service.ts`
  - `addTracksToPlaylist()`: Adds multiple tracks to an existing playlist, updates total duration
  - `renamePlaylist()`: Updates playlist title and persists to storage

## User Benefits
1. **Easy Organization**: Users can organize their media into multiple playlists without leaving the media queue
2. **Quick Creation**: Create new playlists on-the-fly while adding media
3. **Flexible Management**: Rename playlists easily to keep them organized
4. **Visual Feedback**: Snackbar notifications confirm actions and provide navigation shortcuts
5. **Local Storage**: All playlists are stored locally for privacy and offline access
6. **Nostr Publishing**: Playlists can optionally be published to Nostr for sharing

## Future Enhancements
- Drag and drop tracks between playlists
- Duplicate detection when adding tracks
- Batch operations (delete multiple playlists)
- Playlist folders/categories
- Import/Export playlists
- Smart playlists with automatic rules
