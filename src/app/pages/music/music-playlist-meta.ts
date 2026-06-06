/**
 * Shared metadata for music playlists (albums) following the
 * extended "Music Playlists" spec (kind 34139).
 *
 * - `type` describes the release format (album, ep, single, ...).
 * - `role` describes the playlist's role in the ecosystem (release, curated, ...).
 */

export interface MusicPlaylistOption {
  value: string;
  label: string;
  icon: string;
}

/**
 * Playlist `type` values (release format). Clients MAY use additional
 * values; unknown values should be displayed as-is.
 */
export const MUSIC_PLAYLIST_TYPES: readonly MusicPlaylistOption[] = [
  { value: 'album', label: 'Album', icon: 'album' },
  { value: 'ep', label: 'EP', icon: 'library_music' },
  { value: 'single', label: 'Single', icon: 'music_note' },
  { value: 'compilation', label: 'Compilation', icon: 'queue_music' },
  { value: 'live', label: 'Live', icon: 'mic' },
  { value: 'remix', label: 'Remix', icon: 'graphic_eq' },
  { value: 'soundtrack', label: 'Soundtrack', icon: 'movie' },
  { value: 'mixtape', label: 'Mixtape', icon: 'playlist_play' },
  { value: 'demo', label: 'Demo', icon: 'fiber_manual_record' },
] as const;

/**
 * Playlist `role` values. When omitted, `release` is assumed.
 */
export const MUSIC_PLAYLIST_ROLES: readonly MusicPlaylistOption[] = [
  { value: 'release', label: 'Release', icon: 'verified' },
  { value: 'curated', label: 'Curated', icon: 'auto_awesome' },
  { value: 'personal', label: 'Personal', icon: 'person' },
  { value: 'collaborative', label: 'Collaborative', icon: 'groups' },
] as const;

/** Default role assumed when no `role` tag is present. */
export const DEFAULT_MUSIC_PLAYLIST_ROLE = 'release';

/**
 * Resolve a human-readable label for a playlist type value.
 * Unknown values are returned as-is (capitalized).
 */
export function getMusicPlaylistTypeLabel(value: string | undefined | null): string | null {
  if (!value) return null;
  const known = MUSIC_PLAYLIST_TYPES.find(option => option.value === value);
  return known ? known.label : capitalize(value);
}

/**
 * Resolve a human-readable label for a playlist role value.
 * Unknown values are returned as-is (capitalized).
 */
export function getMusicPlaylistRoleLabel(value: string | undefined | null): string | null {
  if (!value) return null;
  const known = MUSIC_PLAYLIST_ROLES.find(option => option.value === value);
  return known ? known.label : capitalize(value);
}

/** Resolve a Material icon name for a playlist type value. */
export function getMusicPlaylistTypeIcon(value: string | undefined | null): string {
  if (!value) return 'album';
  return MUSIC_PLAYLIST_TYPES.find(option => option.value === value)?.icon ?? 'album';
}

/** Resolve a Material icon name for a playlist role value. */
export function getMusicPlaylistRoleIcon(value: string | undefined | null): string {
  if (!value) return 'verified';
  return MUSIC_PLAYLIST_ROLES.find(option => option.value === value)?.icon ?? 'verified';
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
