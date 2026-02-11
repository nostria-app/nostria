import { FollowSet } from './follow-sets.service';

/**
 * Unit tests for FollowSetsService equality comparison logic.
 * Tests the followSetsEqual method that prevents unnecessary signal updates
 * when cached data matches relay data, avoiding UI flickering.
 */
describe('FollowSetsService equality comparison', () => {
  /**
   * Mirrors the followSetsEqual method from FollowSetsService.
   * Returns true if two FollowSet arrays have equivalent content.
   */
  function followSetsEqual(a: FollowSet[], b: FollowSet[]): boolean {
    if (a.length !== b.length) return false;

    for (const setA of a) {
      const setB = b.find(s => s.dTag === setA.dTag);
      if (!setB) return false;
      if (setA.pubkeys.length !== setB.pubkeys.length) return false;
      if (setA.createdAt !== setB.createdAt) return false;
      for (let i = 0; i < setA.pubkeys.length; i++) {
        if (setA.pubkeys[i] !== setB.pubkeys[i]) return false;
      }
    }

    return true;
  }

  function makeFollowSet(overrides: Partial<FollowSet> = {}): FollowSet {
    return {
      id: 'event-id-1',
      dTag: 'nostria-favorites',
      title: 'Favorites',
      pubkeys: ['pubkey1', 'pubkey2'],
      createdAt: 1700000000,
      isPrivate: false,
      ...overrides,
    };
  }

  it('should return true for two empty arrays', () => {
    expect(followSetsEqual([], [])).toBe(true);
  });

  it('should return true for identical single-set arrays', () => {
    const set = makeFollowSet();
    expect(followSetsEqual([set], [{ ...set }])).toBe(true);
  });

  it('should return true for identical multi-set arrays', () => {
    const favorites = makeFollowSet({ dTag: 'nostria-favorites', pubkeys: ['pk1', 'pk2'] });
    const devs = makeFollowSet({ dTag: 'nostria-devs', title: 'Developers', pubkeys: ['pk3'] });

    expect(followSetsEqual(
      [favorites, devs],
      [{ ...favorites, pubkeys: [...favorites.pubkeys] }, { ...devs, pubkeys: [...devs.pubkeys] }]
    )).toBe(true);
  });

  it('should return false when array lengths differ', () => {
    const set = makeFollowSet();
    expect(followSetsEqual([set], [])).toBe(false);
    expect(followSetsEqual([], [set])).toBe(false);
  });

  it('should return false when a dTag is missing in second array', () => {
    const favorites = makeFollowSet({ dTag: 'nostria-favorites' });
    const devs = makeFollowSet({ dTag: 'nostria-devs', title: 'Developers' });

    expect(followSetsEqual(
      [favorites, devs],
      [favorites, makeFollowSet({ dTag: 'nostria-other', title: 'Other' })]
    )).toBe(false);
  });

  it('should return false when pubkeys differ', () => {
    const set1 = makeFollowSet({ pubkeys: ['pk1', 'pk2'] });
    const set2 = makeFollowSet({ pubkeys: ['pk1', 'pk3'] });

    expect(followSetsEqual([set1], [set2])).toBe(false);
  });

  it('should return false when pubkey count differs', () => {
    const set1 = makeFollowSet({ pubkeys: ['pk1', 'pk2'] });
    const set2 = makeFollowSet({ pubkeys: ['pk1'] });

    expect(followSetsEqual([set1], [set2])).toBe(false);
  });

  it('should return false when pubkey order differs', () => {
    const set1 = makeFollowSet({ pubkeys: ['pk1', 'pk2'] });
    const set2 = makeFollowSet({ pubkeys: ['pk2', 'pk1'] });

    expect(followSetsEqual([set1], [set2])).toBe(false);
  });

  it('should return false when createdAt differs', () => {
    const set1 = makeFollowSet({ createdAt: 1700000000 });
    const set2 = makeFollowSet({ createdAt: 1700000001 });

    expect(followSetsEqual([set1], [set2])).toBe(false);
  });

  it('should ignore differences in non-compared fields (id, title, isPrivate)', () => {
    const set1 = makeFollowSet({ id: 'id1', title: 'Title A', isPrivate: false });
    const set2 = makeFollowSet({ id: 'id2', title: 'Title B', isPrivate: true });

    expect(followSetsEqual([set1], [set2])).toBe(true);
  });

  it('should handle sets with empty pubkeys arrays', () => {
    const set1 = makeFollowSet({ pubkeys: [] });
    const set2 = makeFollowSet({ pubkeys: [] });

    expect(followSetsEqual([set1], [set2])).toBe(true);
  });

  it('should match regardless of set order in arrays', () => {
    const favorites = makeFollowSet({ dTag: 'nostria-favorites', pubkeys: ['pk1'] });
    const devs = makeFollowSet({ dTag: 'nostria-devs', pubkeys: ['pk2'] });

    // Sets in different order should still match since lookup is by dTag
    expect(followSetsEqual(
      [favorites, devs],
      [devs, favorites]
    )).toBe(true);
  });
});

/**
 * Unit tests for the favorites array equality check used in FavoritesService.
 * This order-sensitive comparison prevents unnecessary signal emissions
 * when the favorites list hasn't actually changed.
 */
describe('Favorites array equality', () => {
  /**
   * Mirrors the arraysEqual method from FavoritesService (order-sensitive).
   */
  function arraysEqual(arr1: string[], arr2: string[]): boolean {
    if (arr1.length !== arr2.length) return false;
    for (let i = 0; i < arr1.length; i++) {
      if (arr1[i] !== arr2[i]) return false;
    }
    return true;
  }

  it('should return true for two empty arrays', () => {
    expect(arraysEqual([], [])).toBe(true);
  });

  it('should return true for identical arrays', () => {
    expect(arraysEqual(['pk1', 'pk2', 'pk3'], ['pk1', 'pk2', 'pk3'])).toBe(true);
  });

  it('should return false for different lengths', () => {
    expect(arraysEqual(['pk1', 'pk2'], ['pk1'])).toBe(false);
  });

  it('should return false for different content', () => {
    expect(arraysEqual(['pk1', 'pk2'], ['pk1', 'pk3'])).toBe(false);
  });

  it('should return false for same content in different order', () => {
    expect(arraysEqual(['pk1', 'pk2'], ['pk2', 'pk1'])).toBe(false);
  });

  it('should return true for single-element identical arrays', () => {
    expect(arraysEqual(['pk1'], ['pk1'])).toBe(true);
  });

  it('should handle large arrays', () => {
    const arr1 = Array.from({ length: 100 }, (_, i) => `pk${i}`);
    const arr2 = [...arr1];
    expect(arraysEqual(arr1, arr2)).toBe(true);

    // Change last element
    const arr3 = [...arr1];
    arr3[99] = 'different';
    expect(arraysEqual(arr1, arr3)).toBe(false);
  });
});
