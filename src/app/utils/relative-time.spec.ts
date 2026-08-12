import { formatCompactRelativeTime, formatRelativeTimeAgo } from './relative-time';

describe('relative-time', () => {
  const nowSeconds = Math.floor(Date.UTC(2026, 7, 12, 12, 0, 0) / 1000);

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(nowSeconds * 1000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns compact header times with an ago suffix', () => {
    expect(formatCompactRelativeTime(nowSeconds - 20)).toBe('just now');
    expect(formatCompactRelativeTime(nowSeconds - 7 * 60)).toBe('7m ago');
    expect(formatCompactRelativeTime(nowSeconds - 3 * 3600)).toBe('3h ago');
    expect(formatCompactRelativeTime(nowSeconds - 2 * 86400)).toBe('2d ago');
  });

  it('omits the ago suffix when requested', () => {
    expect(formatCompactRelativeTime(nowSeconds - 7 * 60, false)).toBe('7m');
  });

  it('formats long and short ago-pipe values', () => {
    expect(formatRelativeTimeAgo(nowSeconds - 7 * 60)).toBe('7 minutes ago');
    expect(formatRelativeTimeAgo(nowSeconds - 7 * 60, 'short')).toBe('7m ago');
    expect(formatRelativeTimeAgo(nowSeconds - 3)).toBe('just now');
    expect(formatRelativeTimeAgo(nowSeconds - 3, 'short')).toBe('now');
    expect(formatRelativeTimeAgo(nowSeconds + 60)).toBe('in the future');
  });

  it('returns an empty string for missing timestamps', () => {
    expect(formatRelativeTimeAgo(null)).toBe('');
    expect(formatRelativeTimeAgo(0)).toBe('');
  });
});
