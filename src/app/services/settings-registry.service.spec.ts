import { beforeEach, describe, expect, it } from 'vitest';

import { SettingsRegistryService } from './settings-registry.service';

describe('SettingsRegistryService', () => {
  let service: SettingsRegistryService;

  beforeEach(() => {
    (globalThis as any).$localize = ((strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((result, string, index) => result + string + (values[index] ?? ''), '')) as typeof $localize;
    service = new SettingsRegistryService();
  });

  it('exposes the reorganized user-facing settings sections in order', () => {
    expect(service.sections.map(section => section.id)).toEqual([
      'general',
      'appearance',
      'navigation',
      'content',
      'network',
      'privacy',
      'web-of-trust',
      'algorithm',
      'storage',
      'backup',
      'logs-debug',
      'about',
    ]);
  });

  it('removes wallet and premium entries from the settings registry', () => {
    const itemIds = service.items.map(item => item.id);
    const sectionIds = service.sections.map(section => section.id);

    expect(itemIds).not.toContain('wallet-connect');
    expect(itemIds).not.toContain('default-zap');
    expect(itemIds).not.toContain('subscription');
    expect(sectionIds).not.toContain('wallet');
    expect(sectionIds).not.toContain('premium');
  });

  it('reassigns representative settings to the new sections', () => {
    const find = (id: string) => service.items.find(item => item.id === id);

    expect(find('dark-mode')).toMatchObject({ section: 'appearance', route: '/settings/appearance' });
    expect(find('navigation-settings')).toMatchObject({ section: 'navigation', route: '/settings/navigation' });
    expect(find('media-privacy')).toMatchObject({ section: 'content', route: '/settings/content' });
    expect(find('notification-spam-filter')).toMatchObject({ section: 'privacy', route: '/settings/privacy' });
    expect(find('account-relays')).toMatchObject({ section: 'network', route: '/relays?tab=account' });
    expect(find('search-relays')).toMatchObject({ section: 'network', route: '/settings/search' });
    expect(find('trust-network')).toMatchObject({ section: 'web-of-trust', route: '/settings/web-of-trust' });
    expect(find('storage-stats')).toMatchObject({ section: 'storage', route: '/settings/storage' });
    expect(find('app-logs')).toMatchObject({ section: 'logs-debug', route: '/settings/logs' });
  });
});
