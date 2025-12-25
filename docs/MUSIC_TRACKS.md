Music Tracks
Event Kind
36787: Music Track (addressable)
Music Track Event
A music track is an addressable event containing metadata about an audio file.

Format
The .content field MAY contain lyrics and production credits in plain text or Markdown.

Tags
Required:

d - Unique identifier for this track
title - Track title
artist - Artist name
url - Direct URL to the audio file
t - At least one tag with value "music"
Optional:

alt - Human-readable description (NIP-31)
image - URL to album artwork
video - URL to music video file
album - Album name
track_number - Position in album
released - ISO 8601 date (YYYY-MM-DD)
t - Additional genre/category tags
language - ISO 639-1 language code
explicit - Set to "true" for explicit content
duration - Track length in seconds
format - Audio format (mp3, flac, m4a, ogg)
bitrate - Audio bitrate (e.g., "320kbps")
sample_rate - Sample rate in Hz
zap - Lightning address for zap splits (multiple allowed, see Zap Splits)
Example
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
Copy
Implementation Notes
Audio files SHOULD be hosted on Blossom servers for permanence
Video files (music videos) MAY be hosted on Blossom servers or other permanent storage
Tracks are updatable (addressable events)
When no zap tag is present, use author's profile Lightning address
Clients MAY auto-detect technical metadata (duration, format, bitrate)
Clients MAY choose to display video when available, or default to audio-only playback
Tracks support NIP-25 reactions and NIP-22 comments
Use naddr identifiers to link to tracks