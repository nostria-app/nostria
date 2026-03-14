import { shouldAutoMarkTrackAsAiGenerated } from './music-track-metadata.util';

describe('music-track-metadata util', () => {
  it('returns true for explicit AI metadata tags', () => {
    expect(shouldAutoMarkTrackAsAiGenerated({
      id3v2: [
        { id: 'TXXX:AI_GENERATED', value: 'true' },
      ],
    })).toBe(true);
  });

  it('supports object-shaped metadata values', () => {
    expect(shouldAutoMarkTrackAsAiGenerated({
      mp4: [
        { id: '----:com.apple.iTunes:AI-GENERATED', value: { text: 'yes' } },
      ],
    })).toBe(true);
  });

  it('ignores loose source URL heuristics such as suno links', () => {
    expect(shouldAutoMarkTrackAsAiGenerated({
      id3v2: [
        { id: 'WOAS', value: 'https://suno.com/track/123' },
        { id: 'COMM', value: 'uploaded from suno.com' },
      ],
    })).toBe(false);
  });

  it('does not mark AI when the explicit flag is false', () => {
    expect(shouldAutoMarkTrackAsAiGenerated({
      id3v2: [
        { id: 'AI_GENERATED', value: 'false' },
      ],
    })).toBe(false);
  });
});