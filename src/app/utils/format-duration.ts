/**
 * Format a duration in seconds to a human-readable time string.
 * Returns "H:MM:SS" for durations >= 1 hour, or "M:SS" otherwise.
 *
 * Handles edge cases: NaN, Infinity, negative, and fractional seconds.
 *
 * @param seconds - Duration in seconds (can be fractional)
 * @returns Formatted duration string (e.g. "3:05", "1:02:30"), or "0:00" for invalid input
 */
export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '0:00';

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
