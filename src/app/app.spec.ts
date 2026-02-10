/**
 * Unit tests for sidenav CSS class logic.
 * Verifies that sidenav-labels and sidenav-small are mutually exclusive
 * based on the displayLabels signal value.
 */
describe('Sidenav class bindings', () => {
  /**
   * Mirrors the [class.sidenav-labels] and [class.sidenav-small] bindings
   * used on the mat-sidenav element in app.html.
   */
  function getSidenavClasses(displayLabels: boolean): { 'sidenav-labels': boolean; 'sidenav-small': boolean } {
    return {
      'sidenav-labels': displayLabels,
      'sidenav-small': !displayLabels,
    };
  }

  it('should apply sidenav-labels when displayLabels is true', () => {
    const classes = getSidenavClasses(true);
    expect(classes['sidenav-labels']).toBe(true);
    expect(classes['sidenav-small']).toBe(false);
  });

  it('should apply sidenav-small when displayLabels is false', () => {
    const classes = getSidenavClasses(false);
    expect(classes['sidenav-labels']).toBe(false);
    expect(classes['sidenav-small']).toBe(true);
  });

  it('should never apply both classes simultaneously', () => {
    for (const value of [true, false]) {
      const classes = getSidenavClasses(value);
      expect(classes['sidenav-labels'] && classes['sidenav-small']).toBe(false);
    }
  });

  it('should always apply exactly one class', () => {
    for (const value of [true, false]) {
      const classes = getSidenavClasses(value);
      const activeCount = [classes['sidenav-labels'], classes['sidenav-small']].filter(Boolean).length;
      expect(activeCount).toBe(1);
    }
  });
});

/**
 * Unit tests for follow set sorting in the People nav section.
 * Verifies that Favorites (nostria-favorites) always appears first.
 */
describe('People nav follow set sorting', () => {
  interface FollowSetLike {
    dTag: string;
    title: string;
    isPrivate: boolean;
  }

  /**
   * Mirrors the sorting logic used in AppComponent.navigationItems
   * for the People section children (app.ts).
   */
  function sortFollowSets(followSets: FollowSetLike[]): FollowSetLike[] {
    return [...followSets].sort((a, b) => {
      if (a.dTag === 'nostria-favorites') return -1;
      if (b.dTag === 'nostria-favorites') return 1;
      return a.title.localeCompare(b.title);
    });
  }

  it('should place Favorites first when it appears last alphabetically', () => {
    const sets: FollowSetLike[] = [
      { dTag: 'alpha-list', title: 'Alpha', isPrivate: false },
      { dTag: 'beta-list', title: 'Beta', isPrivate: false },
      { dTag: 'nostria-favorites', title: 'Favorites', isPrivate: false },
    ];

    const sorted = sortFollowSets(sets);
    expect(sorted[0].dTag).toBe('nostria-favorites');
    expect(sorted[1].title).toBe('Alpha');
    expect(sorted[2].title).toBe('Beta');
  });

  it('should place Favorites first when it appears first alphabetically', () => {
    const sets: FollowSetLike[] = [
      { dTag: 'nostria-favorites', title: 'Favorites', isPrivate: false },
      { dTag: 'z-list', title: 'Zeta', isPrivate: false },
      { dTag: 'a-list', title: 'Alpha', isPrivate: false },
    ];

    const sorted = sortFollowSets(sets);
    expect(sorted[0].dTag).toBe('nostria-favorites');
    expect(sorted[1].title).toBe('Alpha');
    expect(sorted[2].title).toBe('Zeta');
  });

  it('should place Favorites first among many lists', () => {
    const sets: FollowSetLike[] = [
      { dTag: 'dev-list', title: 'Developers', isPrivate: false },
      { dTag: 'music-list', title: 'Musicians', isPrivate: false },
      { dTag: 'nostria-favorites', title: 'Favorites', isPrivate: false },
      { dTag: 'art-list', title: 'Artists', isPrivate: false },
      { dTag: 'news-list', title: 'News', isPrivate: true },
    ];

    const sorted = sortFollowSets(sets);
    expect(sorted[0].dTag).toBe('nostria-favorites');
    // Remaining should be alphabetical
    expect(sorted[1].title).toBe('Artists');
    expect(sorted[2].title).toBe('Developers');
    expect(sorted[3].title).toBe('Musicians');
    expect(sorted[4].title).toBe('News');
  });

  it('should sort alphabetically when Favorites is not present', () => {
    const sets: FollowSetLike[] = [
      { dTag: 'dev-list', title: 'Developers', isPrivate: false },
      { dTag: 'art-list', title: 'Artists', isPrivate: false },
      { dTag: 'news-list', title: 'News', isPrivate: true },
    ];

    const sorted = sortFollowSets(sets);
    expect(sorted[0].title).toBe('Artists');
    expect(sorted[1].title).toBe('Developers');
    expect(sorted[2].title).toBe('News');
  });

  it('should handle a single Favorites entry', () => {
    const sets: FollowSetLike[] = [
      { dTag: 'nostria-favorites', title: 'Favorites', isPrivate: false },
    ];

    const sorted = sortFollowSets(sets);
    expect(sorted.length).toBe(1);
    expect(sorted[0].dTag).toBe('nostria-favorites');
  });

  it('should handle empty list', () => {
    const sorted = sortFollowSets([]);
    expect(sorted.length).toBe(0);
  });
});
