import { Type } from '@angular/core';

/**
 * Maps settings section IDs to their component types.
 * Used for lazy loading settings sections into the right panel.
 * 
 * The IDs here must match the `id` field in SettingsRegistryService.sections
 */
export const SETTINGS_SECTION_COMPONENT_MAP: Record<string, () => Promise<Type<unknown>>> = {
  'general': () => import('./general/general.component').then(m => m.GeneralSettingsComponent),
  'layout': () => import('./layout/layout.component').then(m => m.LayoutSettingsComponent),
  'algorithm': () => import('./algorithm/algorithm').then(m => m.AlgorithmComponent),
  'relays': () => import('./relays/relays.component').then(m => m.RelaysComponent),
  'search': () => import('./search/search.component').then(m => m.SearchSettingsComponent),
  'privacy': () => import('./privacy-settings/privacy-settings.component').then(m => m.PrivacySettingsComponent),
  'trust': () => import('./trust/trust.component').then(m => m.TrustSettingsComponent),
  'wallet': () => import('./wallet/wallet.component').then(m => m.WalletSettingsComponent),
  'backup': () => import('./backup/backup.component').then(m => m.BackupComponent),
  'premium': () => import('../premium/settings/settings').then(m => m.PremiumSettings),
  'database': () => import('./database/database.component').then(m => m.DatabaseSettingsComponent),
  'logs': () => import('./logs-settings/logs-settings.component').then(m => m.LogsSettingsComponent),
  'about': () => import('./about/about.component').then(m => m.AboutComponent),
  'debug': () => import('./debug/debug.component').then(m => m.DebugSettingsComponent),
};

/**
 * Gets a component type loader by settings section ID.
 * Returns undefined if the section doesn't exist.
 */
export function getSettingsSectionComponent(sectionId: string): (() => Promise<Type<unknown>>) | undefined {
  return SETTINGS_SECTION_COMPONENT_MAP[sectionId];
}
