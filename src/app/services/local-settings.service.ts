import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { LoggerService } from './logger.service';

export interface LocalSettings {
  menuOpen: boolean;
  menuExpanded: boolean;
  locale: string;
  maxRelaysPerUser: number;
}

const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  menuOpen: false,
  menuExpanded: true,
  locale: 'en',
  maxRelaysPerUser: 3,
};

/**
 * Service for managing local-only settings that are persisted in localStorage
 * These settings are not synced across devices and are specific to this browser/device
 */
@Injectable({
  providedIn: 'root',
})
export class LocalSettingsService {
  private readonly localStorage = inject(LocalStorageService);
  private readonly logger = inject(LoggerService);
  private readonly STORAGE_KEY = 'nostria-settings';

  // Signal containing all local settings
  readonly settings = signal<LocalSettings>({ ...DEFAULT_LOCAL_SETTINGS });

  // Computed signals for individual settings
  readonly menuOpen = computed(() => this.settings().menuOpen);
  readonly menuExpanded = computed(() => this.settings().menuExpanded);
  readonly locale = computed(() => this.settings().locale);
  readonly maxRelaysPerUser = computed(() => this.settings().maxRelaysPerUser);

  constructor() {
    this.loadSettings();

    // Auto-save settings whenever they change
    effect(() => {
      const currentSettings = this.settings();
      this.saveSettings(currentSettings);
    });
  }

  /**
   * Load settings from localStorage
   */
  private loadSettings(): void {
    try {
      const stored = this.localStorage.getObject<LocalSettings>(this.STORAGE_KEY);

      if (stored) {
        // Merge with defaults to ensure all properties exist
        const mergedSettings: LocalSettings = {
          ...DEFAULT_LOCAL_SETTINGS,
          ...stored,
        };

        this.settings.set(mergedSettings);
        this.logger.debug('Local settings loaded successfully', mergedSettings);
      } else {
        this.logger.debug('No local settings found, using defaults', DEFAULT_LOCAL_SETTINGS);
        this.settings.set({ ...DEFAULT_LOCAL_SETTINGS });
      }
    } catch (error) {
      this.logger.error('Failed to load local settings', error);
      this.settings.set({ ...DEFAULT_LOCAL_SETTINGS });
    }
  }

  /**
   * Save settings to localStorage
   */
  private saveSettings(settings: LocalSettings): void {
    try {
      const success = this.localStorage.setObject(this.STORAGE_KEY, settings);
      if (success) {
        this.logger.debug('Local settings saved successfully', settings);
      } else {
        this.logger.warn('Failed to save local settings to localStorage');
      }
    } catch (error) {
      this.logger.error('Failed to save local settings', error);
    }
  }

  /**
   * Update specific settings
   */
  updateSettings(updates: Partial<LocalSettings>): void {
    this.settings.update((current) => ({
      ...current,
      ...updates,
    }));
  }

  /**
   * Set menu open state
   */
  setMenuOpen(open: boolean): void {
    this.updateSettings({ menuOpen: open });
  }

  /**
   * Set menu expanded state
   */
  setMenuExpanded(expanded: boolean): void {
    this.updateSettings({ menuExpanded: expanded });
  }

  /**
   * Set locale
   */
  setLocale(locale: string): void {
    this.updateSettings({ locale });
  }

  /**
   * Set max relays per user
   */
  setMaxRelaysPerUser(maxRelaysPerUser: number): void {
    this.updateSettings({ maxRelaysPerUser });
  }

  /**
   * Toggle menu open state
   */
  toggleMenuOpen(): void {
    this.setMenuOpen(!this.menuOpen());
  }

  /**
   * Toggle menu expanded state
   */
  toggleMenuExpanded(): void {
    this.setMenuExpanded(!this.menuExpanded());
  }

  /**
   * Reset all settings to defaults
   */
  resetToDefaults(): void {
    this.settings.set({ ...DEFAULT_LOCAL_SETTINGS });
  }
}
