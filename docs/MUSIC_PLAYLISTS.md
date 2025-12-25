Music Playlists
This spec defines an addressable event kind for publishing music playlists on Nostr.

Event Kind
34139: Playlist (addressable)
Playlist Event
A playlist is an addressable event containing an ordered list of music tracks.

Format
The .content field MAY contain a description of the playlist in plain text or Markdown.

Tags
Required:

d - Unique identifier for this playlist
title - Playlist title
alt - Human-readable description (NIP-31)
Optional:

description - Short description (can also use content field)
image - URL to playlist artwork
a - Track references in format 36787:<pubkey>:<d-tag> (multiple, ordered)
t - Category tags for discovery
public - Set to "true" for public playlists (default)
private - Set to "true" for private playlists
collaborative - Set to "true" to allow others to add tracks
Example
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
Copy
Track References
Playlists reference music tracks using a tags in the format:

["a", "36787:<pubkey>:<d-tag>"]
Copy
Where:

36787 is the Music Track event kind (see NIP-XX: Music Tracks)
<pubkey> is the track author's public key (hex)
<d-tag> is the track's unique identifier
Implementation Notes
Playlists are updatable (addressable events)
Playlist a tags reference tracks in display order
Clients SHOULD preserve track order when displaying playlists
Clients SHOULD handle missing/deleted tracks gracefully
When a referenced track is not found, clients MAY show a placeholder or skip it
Playlists support NIP-25 reactions and NIP-22 comments
Use naddr identifiers to link to playlists
Collaborative playlist mechanics are client-defined (e.g., NIP-04/17 track suggestions)
Artwork images SHOULD be hosted on Blossom servers for permanence