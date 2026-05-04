import { parseMusicReleasedTag } from './music-release-date.util';

describe('music release date util', () => {
  it('parses year-only release tags', () => {
    expect(parseMusicReleasedTag('2026')).toBe(Date.UTC(2026, 0, 1));
  });

  it('parses ISO-style release tags', () => {
    expect(parseMusicReleasedTag('2026-04-27')).toBe(Date.UTC(2026, 3, 27));
  });

  it('parses slash-formatted month-first release tags', () => {
    expect(parseMusicReleasedTag('03/01/2026')).toBe(Date.UTC(2026, 2, 1));
  });

  it('rejects invalid calendar dates', () => {
    expect(parseMusicReleasedTag('2026-02-30')).toBeNull();
  });
});