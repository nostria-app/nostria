import { ensurePodcastsMenuItem, type MenuItemConfig } from './local-settings.service';

describe('ensurePodcastsMenuItem', () => {
  it('leaves an empty config alone so defaults still apply', () => {
    expect(ensurePodcastsMenuItem([])).toEqual([]);
  });

  it('does not duplicate podcasts when already present', () => {
    const menuItems: MenuItemConfig[] = [
      { id: 'music', visible: true },
      { id: 'podcasts', visible: false },
      { id: 'streams', visible: true },
    ];

    expect(ensurePodcastsMenuItem(menuItems)).toEqual(menuItems);
  });

  it('inserts podcasts after music for existing custom menus', () => {
    expect(ensurePodcastsMenuItem([
      { id: 'articles', visible: true },
      { id: 'music', visible: true },
      { id: 'streams', visible: true },
    ])).toEqual([
      { id: 'articles', visible: true },
      { id: 'music', visible: true },
      { id: 'podcasts', visible: true },
      { id: 'streams', visible: true },
    ]);
  });

  it('inserts podcasts before streams when music is missing', () => {
    expect(ensurePodcastsMenuItem([
      { id: '/f', visible: true },
      { id: 'streams', visible: true },
    ])).toEqual([
      { id: '/f', visible: true },
      { id: 'podcasts', visible: true },
      { id: 'streams', visible: true },
    ]);
  });
});
