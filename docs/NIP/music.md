# NIP-XX: Nostr Music Application Protocol

Based upon original: https://github.com/derekross/zaptrax/blob/master/NIP.md
Forked for important improvements.

## Work in Progress:

Suggested changes: 

Comments should be NIP-22 based using kind 1111 instead of 1. Kind 1 should only be comments on kind 1.

Zapping should happen to the addressable event ("a"), this is very important so zaps can be found based upon the music track. Some client is zapping the "e" (event ID), which will then disappear when author updates the track.

(These changes has not been updated in this document yet)

`draft` `optional`

## Abstract

This NIP defines a protocol for music applications built on Nostr, enabling decentralized music discovery, playlist management, and social interactions around music content. It leverages existing NIPs for core functionality while defining specific patterns for music-related use cases.

## Overview

This protocol uses existing Nostr event kinds and patterns to create a comprehensive music application experience:

- **Kind 36787** for native Nostr music tracks
- **Kind 34139** for native Nostr music playlists
- **NIP-51 Lists** for mixed-source playlists and liked songs
- **NIP-38 User Statuses** for "now playing" updates
- **NIP-25 Reactions** for liking tracks and artists
- **Kind 1 Text Notes** for track comments
- **NIP-57 Lightning Zaps** for supporting artists and tracks

## Native Nostr Music Tracks (Kind 36787)

Native Nostr music tracks are addressable events containing metadata about audio files hosted on decentralized storage (e.g., Blossom servers).

### Track Event Structure

```json
{
  "kind": 36787,
  "content": "Lyrics:\n[Verse 1]\n...\n\nCredits:\nProducer: John Doe",
  "tags": [
    ["d", "summer-nights-2024"],
    ["title", "Summer Nights"],
    ["url", "https://cdn.blossom.example/audio/abc123.mp3"],
    ["image", "https://cdn.blossom.example/img/artwork.jpg"],
    ["video", "https://cdn.blossom.example/video/abc123.mp4"],
    ["artist", "The Midnight Collective"],
    ["album", "Endless Summer"],
    ["track_number", "3"],
    ["released", "2024-06-15"],
    ["duration", "245"],
    ["format", "mp3"],
    ["t", "music"],
    ["t", "electronic"],
    ["alt", "Music track: Summer Nights by The Midnight Collective"]
  ]
}
```

### Required Tags

- `d`: Unique identifier for this track
- `title`: Track title
- `artist`: Artist name
- `url`: Direct URL to the audio file
- `t`: Must include at least one tag with value "music"

### Optional Tags

- `image`: URL to album artwork
- `video`: URL to music video file
- `album`: Album name
- `track_number`: Position in album
- `released`: ISO 8601 date (YYYY-MM-DD)
- `duration`: Track length in seconds
- `format`: Audio format (mp3, flac, m4a, ogg)
- `bitrate`: Audio bitrate (e.g., "320kbps")
- `sample_rate`: Sample rate in Hz
- `language`: ISO 639-1 language code
- `explicit`: Set to "true" for explicit content
- `alt`: Human-readable description (NIP-31)

### Content Field

The `.content` field MAY contain lyrics and production credits in plain text or Markdown.

## Native Nostr Music Playlists (Kind 34139)

Native Nostr playlists are addressable events containing ordered lists of music tracks (kind 36787).

### Playlist Event Structure

```json
{
  "kind": 34139,
  "content": "My favorite summer vibes from 2024",
  "tags": [
    ["d", "summer-vibes-2024"],
    ["title", "Summer Vibes 2024"],
    ["image", "https://cdn.blossom.example/img/playlist.jpg"],
    ["description", "Chill electronic tracks for summer"],
    ["a", "36787:abc123...:summer-nights-2024"],
    ["a", "36787:def456...:sunset-dreams"],
    ["a", "36787:abc123...:ocean-breeze"],
    ["t", "playlist"],
    ["t", "electronic"],
    ["t", "summer"],
    ["public", "true"],
    ["alt", "Playlist: Summer Vibes 2024"]
  ]
}
```

### Required Tags

- `d`: Unique identifier for this playlist
- `title`: Playlist title
- `alt`: Human-readable description (NIP-31)

### Optional Tags

- `description`: Short description (can also use content field)
- `image`: URL to playlist artwork
- `a`: Track references in format `36787:<pubkey>:<d-tag>` (multiple, ordered)
- `t`: Category tags for discovery
- `public`: Set to "true" for public playlists (default)
- `private`: Set to "true" for private playlists
- `collaborative`: Set to "true" to allow others to add tracks

### Track References

Playlists reference music tracks using `a` tags in the format:
```
["a", "36787:<pubkey>:<d-tag>"]
```

Where:
- `36787` is the Music Track event kind
- `<pubkey>` is the track author's public key (hex)
- `<d-tag>` is the track's unique identifier

## Music Playlists

Music playlists are implemented using **NIP-51 Bookmark Sets** (kind `30003`) with specific tags:

### Playlist Event Structure

```json
{
  "kind": 30003,
  "content": "",
  "tags": [
    ["d", "playlist-{timestamp}"],
    ["title", "My Awesome Playlist"],
    ["description", "A collection of my favorite tracks"],
    ["t", "music"],
    ["r", "https://wavlake.com/track/{track-id-1}"],
    ["r", "https://wavlake.com/track/{track-id-2}"],
    ["r", "https://wavlake.com/track/{track-id-3}"]
  ]
}
```

### Required Tags

- `d`: Unique identifier for the playlist (e.g., "playlist-{timestamp}")
- `title`: Human-readable playlist name
- `t`: Must include "music" for music playlist categorization
- `r`: Track URLs, one per track in the playlist

### Optional Tags

- `description`: Playlist description
- `image`: Playlist cover image URL

## Liked Songs

Liked songs are stored in a **NIP-51 Bookmark Set** (kind `30003`) with a specific `d` tag identifier:

```json
{
  "kind": 30003,
  "content": "",
  "tags": [
    ["d", "liked-songs"],
    ["title", "Liked Songs"],
    ["description", "My favorite tracks"],
    ["t", "music"],
    ["r", "https://wavlake.com/track/{track-id-1}"],
    ["r", "https://wavlake.com/track/{track-id-2}"]
  ]
}
```

### Required Tags

- `d`: Must be "liked-songs" for the liked songs bookmark set
- `title`: Should be "Liked Songs" for consistency
- `t`: Must include "music" for music categorization
- `r`: Track URLs, one per liked track

## Now Playing Status

Current listening status uses **NIP-38 User Statuses** (kind `30315`) with the "music" status type:

```json
{
  "kind": 30315,
  "content": "Intergalactic - Beastie Boys",
  "tags": [
    ["d", "music"],
    ["r", "https://wavlake.com/track/{track-id}"],
    ["expiration", "{unix-timestamp-when-track-ends}"]
  ]
}
```

### Tags

- `d`: Must be "music" for music status
- `r`: URL to the currently playing track
- `expiration`: Unix timestamp when the track will finish playing

## Track and Artist Reactions

### Track Likes

Track likes use **NIP-25 Reactions** (kind `7`) with track URLs:

```json
{
  "kind": 7,
  "content": "❤️",
  "tags": [
    ["r", "https://wavlake.com/track/{track-id}"],
    ["k", "1"]
  ]
}
```

### Artist Likes

Artist likes use **NIP-25 Reactions** (kind `7`) with artist npubs:

```json
{
  "kind": 7,
  "content": "❤️",
  "tags": [
    ["p", "{artist-npub}"],
    ["k", "0"]
  ]
}
```

## Track Comments

Track comments use **Kind 1 Text Notes** with track URL references:

```json
{
  "kind": 1,
  "content": "Amazing track! The guitar solo is incredible.\n\n🎵 Song Title - Artist Name\nhttps://wavlake.com/track/{track-id}",
  "tags": [
    ["r", "https://wavlake.com/track/{track-id}"],
    ["t", "music"]
  ]
}
```

### Content Format

The content should include:
1. The user's comment
2. A separator (e.g., double newline)
3. A music emoji and track information
4. The track URL

### Tags

- `r`: Track URL being commented on
- `t`: "music" tag for categorization

## Lightning Zaps

Track and artist zaps use **NIP-57 Lightning Zaps** with appropriate targets:

### Track Zaps

```json
{
  "kind": 9734,
  "content": "Great track! 🎵",
  "tags": [
    ["relays", "wss://relay.example.com"],
    ["amount", "1000"],
    ["lnurl", "{track-lnurl}"],
    ["p", "{artist-pubkey}"],
    ["r", "https://wavlake.com/track/{track-id}"]
  ]
}
```

### Artist Zaps

```json
{
  "kind": 9734,
  "content": "Love your music! ❤️",
  "tags": [
    ["relays", "wss://relay.example.com"],
    ["amount", "5000"],
    ["lnurl", "{artist-lnurl}"],
    ["p", "{artist-pubkey}"]
  ]
}
```

## Querying Music Events

### Get User Playlists

```javascript
const playlists = await nostr.query([{
  kinds: [30003],
  authors: [userPubkey],
  "#t": ["music"]
}]);
```

### Get Liked Songs

```javascript
const likedSongs = await nostr.query([{
  kinds: [30003],
  authors: [userPubkey],
  "#d": ["liked-songs"]
}]);

// Get the most recent liked songs bookmark set
const likedSongsPlaylist = likedSongs.sort((a, b) => b.created_at - a.created_at)[0];
```

### Get Track Comments

```javascript
const comments = await nostr.query([{
  kinds: [1],
  "#r": [trackUrl],
  "#t": ["music"]
}]);
```

### Get Track Reactions

```javascript
const reactions = await nostr.query([{
  kinds: [7],
  "#r": [trackUrl]
}]);
```

### Get Now Playing Status

```javascript
const nowPlaying = await nostr.query([{
  kinds: [30315],
  authors: [userPubkey],
  "#d": ["music"]
}]);
```

## Implementation Notes

1. **Track URLs**: Use consistent URL format for track references (e.g., `https://wavlake.com/track/{id}`)

2. **Relay Filtering**: Use `#t: ["music"]` filters to efficiently query music-related content at the relay level

3. **Automatic Actions**: When a user likes a track, the application should:
   - Create a reaction event (kind 7)
   - Add the track to their "Liked Songs" bookmark set (kind 30003 with d tag "liked-songs")

4. **Status Updates**: When playing a track, automatically update the user's music status (kind 30315) with appropriate expiration

5. **Zap Integration**: Integrate with music platforms' LNURL endpoints for seamless artist/track support

## Security Considerations

- Validate track URLs to prevent malicious links
- Implement rate limiting for reactions and comments
- Verify LNURL endpoints before creating zap requests

## Privacy Considerations

- Music listening history is public through status updates
- Playlists and liked songs are public by default
- Consider implementing private playlists using NIP-44 encryption in the content field

## Compatibility

This protocol is fully compatible with existing Nostr clients and relays, as it only uses established event kinds and tag patterns. Music-specific clients can provide enhanced UX while maintaining interoperability with general Nostr applications.