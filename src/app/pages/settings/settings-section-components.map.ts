import type { Type } from '@angular/core';
import { GeneralPreferencesSettingsComponent } from './general-preferences.component';
import { ProfileSettingsComponent } from './profile-settings.component';
import { AppearanceSettingsComponent } from './appearance-settings.component';
import { MenuNavigationSettingsComponent } from './menu-navigation-settings.component';
import { FeedContentSettingsComponent } from './feed-content-settings.component';
import { RelaysNetworkSettingsComponent } from './relays-network-settings.component';
import { TrustSettingsComponent } from './trust/trust.component';
import { DatabaseSettingsComponent } from './database/database.component';
import { LogsDebugSettingsComponent } from './logs-debug-settings.component';
import { AdvancedPostingSettingsComponent } from './advanced-posting-settings.component';
import { GeneralSettingsComponent } from './general/general.component';
import { LayoutSettingsComponent } from './layout/layout.component';
import { AlgorithmComponent } from './algorithm/algorithm';
import { RelaysComponent } from './relays/relays.component';
import { SearchSettingsComponent } from './search/search.component';
import { PrivacySettingsComponent } from './privacy-settings/privacy-settings.component';
import { BackupComponent } from './backup/backup.component';
import { LogsSettingsComponent } from './logs-settings/logs-settings.component';
import { AboutComponent } from './about/about.component';
import { DebugSettingsComponent } from './debug/debug.component';
import { DeleteEventComponent } from '../delete-event/delete-event.component';
import { DeleteAccountComponent } from '../delete-account/delete-account.component';

const resolveComponent = (component: Type<unknown>) => () => Promise.resolve(component);

/**
 * Maps settings section IDs to their component types behind the settings feature boundary.
 * The asynchronous API keeps existing callers unchanged.
 *
 * The IDs here must match the `id` field in SettingsRegistryService.sections
 */
export const SETTINGS_SECTION_COMPONENT_MAP: Record<string, () => Promise<Type<unknown>>> = {
  'general': resolveComponent(GeneralPreferencesSettingsComponent),
  'profile': resolveComponent(ProfileSettingsComponent),
  'appearance': resolveComponent(AppearanceSettingsComponent),
  'navigation': resolveComponent(MenuNavigationSettingsComponent),
  'content': resolveComponent(FeedContentSettingsComponent),
  'network': resolveComponent(RelaysNetworkSettingsComponent),
  'web-of-trust': resolveComponent(TrustSettingsComponent),
  'storage': resolveComponent(DatabaseSettingsComponent),
  'logs-debug': resolveComponent(LogsDebugSettingsComponent),
  'advanced-posting': resolveComponent(AdvancedPostingSettingsComponent),
  'legacy-general': resolveComponent(GeneralSettingsComponent),
  'layout': resolveComponent(LayoutSettingsComponent),
  'algorithm': resolveComponent(AlgorithmComponent),
  'relays': resolveComponent(RelaysComponent),
  'search': resolveComponent(SearchSettingsComponent),
  'privacy': resolveComponent(PrivacySettingsComponent),
  'trust': resolveComponent(TrustSettingsComponent),
  'backup': resolveComponent(BackupComponent),
  'database': resolveComponent(DatabaseSettingsComponent),
  'logs': resolveComponent(LogsSettingsComponent),
  'about': resolveComponent(AboutComponent),
  'debug': resolveComponent(DebugSettingsComponent),
  'delete-event': resolveComponent(DeleteEventComponent),
  'delete-account': resolveComponent(DeleteAccountComponent),
};

/**
 * Gets a component type loader by settings section ID.
 * Returns undefined if the section doesn't exist.
 */
export function getSettingsSectionComponent(sectionId: string): (() => Promise<Type<unknown>>) | undefined {
  return SETTINGS_SECTION_COMPONENT_MAP[sectionId];
}
