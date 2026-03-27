import { getDisplayedTrendingEventIds } from './trending-column.component';

describe('getDisplayedTrendingEventIds', () => {
  it('excludes hidden event ids and backfills with the next visible ids', () => {
    const result = getDisplayedTrendingEventIds(
      ['event-1', 'event-2', 'event-3', 'event-4', 'event-5', 'event-6'],
      new Set(['event-2', 'event-4']),
      4
    );

    expect(result).toEqual(['event-1', 'event-3', 'event-5', 'event-6']);
  });

  it('returns an empty list when every candidate event is hidden', () => {
    const result = getDisplayedTrendingEventIds(
      ['event-1', 'event-2'],
      new Set(['event-1', 'event-2']),
      5
    );

    expect(result).toEqual([]);
  });

  it('preserves the original order of visible trending events', () => {
    const result = getDisplayedTrendingEventIds(
      ['event-1', 'event-2', 'event-3', 'event-4'],
      new Set(['event-3']),
      3
    );

    expect(result).toEqual(['event-1', 'event-2', 'event-4']);
  });
});