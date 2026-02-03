import { Type } from '@angular/core';
import { SettingDarkModeComponent } from './dark-mode.component';
import { SettingLanguageComponent } from './language.component';
import { SettingLoggingComponent } from './logging.component';
import { SettingMediaComponent } from './media.component';
import { SettingNavigationComponent } from './navigation.component';
import { SettingCalendarComponent } from './calendar.component';
import { SettingRelayAuthComponent } from './relay-auth.component';
import { SettingClientTagsComponent } from './client-tags.component';
import { SettingMaxRelaysComponent } from './max-relays.component';
import { SettingExternalLinksComponent } from './external-links.component';
import { SettingCacheComponent } from './cache.component';
import { SettingDangerZoneComponent } from './danger-zone.component';
import { SettingStorageComponent } from './storage.component';
import { SettingMenuEditorComponent } from './menu-editor.component';
import { SettingHomeDestinationComponent } from './home-destination.component';
import { SettingNotificationSpamFilterComponent } from './notification-spam-filter.component';

/**
 * Maps setting item IDs to their standalone component types.
 * This enables dynamic rendering of individual setting sections when searching.
 * 
 * The IDs here must match the `id` field in SettingsRegistryService.items
 */
export const SETTINGS_COMPONENT_MAP: Record<string, Type<unknown>> = {
  // General Settings - these IDs match registry items
  'dark-mode': SettingDarkModeComponent,
  'language': SettingLanguageComponent,
  'logging': SettingLoggingComponent,

  // Media settings (multiple registry items map to same component)
  'media-privacy': SettingMediaComponent,
  'placeholder-algorithm': SettingMediaComponent,
  'auto-play-video': SettingMediaComponent,
  'image-cache': SettingMediaComponent,

  // Navigation settings
  'navigation-settings': SettingNavigationComponent,
  'home-destination': SettingHomeDestinationComponent,

  // Menu customization
  'menu-customization': SettingMenuEditorComponent,

  // Calendar settings
  'calendar-system': SettingCalendarComponent,

  // Relay settings
  'auto-relay-auth': SettingRelayAuthComponent,
  'max-relays-per-user': SettingMaxRelaysComponent,

  // Client tags
  'client-tags': SettingClientTagsComponent,

  // External links
  'external-links': SettingExternalLinksComponent,

  // Storage and Cache
  'storage-stats': SettingStorageComponent,
  'cache-management': SettingCacheComponent,

  // Danger zone
  'wipe-data': SettingDangerZoneComponent,

  // Notification spam filter
  'notification-spam-filter': SettingNotificationSpamFilterComponent,
};

/**
 * Gets a component type by setting item ID.
 * Returns undefined if the setting doesn't have a dedicated component.
 */
export function getSettingComponent(id: string): Type<unknown> | undefined {
  return SETTINGS_COMPONENT_MAP[id];
}
