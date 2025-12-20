import { Injectable, computed, effect, inject, signal, DOCUMENT, PLATFORM_ID } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { LoggerService } from './logger.service';
import { BreakpointObserver } from '@angular/cdk/layout';
import { isPlatformBrowser } from '@angular/common';

export type CalendarType = 'gregorian' | 'chronia';

export interface LocalSettings {
  menuOpen: boolean;
  menuExpanded: boolean;
  locale: string;
  maxRelaysPerUser: number;
  autoRelayAuth: boolean;
  addClientTag: boolean;
  showClientTag: boolean;
  trustEnabled: boolean;
  trustRelay: string;
  startOnLastRoute: boolean;
  startFeedsOnLastEvent: boolean;
  showThreadLines: boolean;
  openThreadsExpanded: boolean;
  removeTrackingParameters: boolean;
  calendarType: CalendarType;
}

const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  menuOpen: false,
  menuExpanded: true,
  locale: 'en',
  maxRelaysPerUser: 3,
  autoRelayAuth: true,
  addClientTag: true,
  showClientTag: true,
  trustEnabled: false,
  trustRelay: 'wss://nip85.brainstorm.world',
  startOnLastRoute: true,
  startFeedsOnLastEvent: true,
  showThreadLines: true,
  openThreadsExpanded: true,
  removeTrackingParameters: true,
  calendarType: 'gregorian',
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
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly STORAGE_KEY = 'nostria-settings';

  // Locales that require special font handling
  private readonly RTL_LOCALES = ['ar', 'fa'];

  // Font URLs for dynamic loading
  private readonly LOCALE_FONTS: Record<string, string> = {
    ar: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@100..900&display=swap',
    fa: 'https://fonts.googleapis.com/css2?family=Vazirmatn:wght@100..900&display=swap',
  };

  // Track which fonts have been loaded
  private loadedFonts = new Set<string>();

  // Signal containing all local settings
  readonly settings = signal<LocalSettings>({ ...DEFAULT_LOCAL_SETTINGS });

  // Computed signals for individual settings
  readonly menuOpen = computed(() => this.settings().menuOpen);
  readonly menuExpanded = computed(() => this.settings().menuExpanded);
  readonly locale = computed(() => this.settings().locale);
  readonly maxRelaysPerUser = computed(() => this.settings().maxRelaysPerUser);
  readonly autoRelayAuth = computed(() => this.settings().autoRelayAuth);
  readonly addClientTag = computed(() => this.settings().addClientTag);
  readonly showClientTag = computed(() => this.settings().showClientTag);
  readonly trustEnabled = computed(() => this.settings().trustEnabled);
  readonly trustRelay = computed(() => this.settings().trustRelay);
  readonly startOnLastRoute = computed(() => this.settings().startOnLastRoute);
  readonly startFeedsOnLastEvent = computed(() => this.settings().startFeedsOnLastEvent);
  readonly showThreadLines = computed(() => this.settings().showThreadLines);
  readonly openThreadsExpanded = computed(() => this.settings().openThreadsExpanded);
  readonly removeTrackingParameters = computed(() => this.settings().removeTrackingParameters);
  readonly calendarType = computed(() => this.settings().calendarType);

  constructor() {
    this.loadSettings();

    // Auto-save settings whenever they change
    effect(() => {
      const currentSettings = this.settings();
      this.saveSettings(currentSettings);
    });

    // Apply locale class to document element for font styling
    effect(() => {
      const currentLocale = this.locale();
      this.applyLocaleClass(currentLocale);
    });
  }

  /**
   * Apply locale-specific class to document element for font styling
   * This enables different fonts for Arabic and Persian languages
   */
  private applyLocaleClass(locale: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return; // Don't modify DOM during SSR
    }

    const htmlElement = this.document.documentElement;

    // Remove any existing locale classes
    htmlElement.classList.forEach(className => {
      if (className.startsWith('locale-')) {
        htmlElement.classList.remove(className);
      }
    });

    // Add the current locale class for RTL languages that need special fonts
    if (this.RTL_LOCALES.includes(locale)) {
      // Dynamically load the font if not already loaded
      this.loadFontForLocale(locale);
      htmlElement.classList.add(`locale-${locale}`);
      this.logger.debug(`Applied locale class: locale-${locale}`);
    }
  }

  /**
   * Dynamically load a Google Font for a specific locale
   * Only loads the font once, subsequent calls are no-ops
   */
  private loadFontForLocale(locale: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Check if font is already loaded
    if (this.loadedFonts.has(locale)) {
      this.logger.debug(`Font for locale ${locale} already loaded`);
      return;
    }

    const fontUrl = this.LOCALE_FONTS[locale];
    if (!fontUrl) {
      this.logger.warn(`No font URL configured for locale: ${locale}`);
      return;
    }

    // Check if link element already exists in the document
    const existingLink = this.document.querySelector(`link[href="${fontUrl}"]`);
    if (existingLink) {
      this.loadedFonts.add(locale);
      this.logger.debug(`Font link for locale ${locale} already exists in document`);
      return;
    }

    // Create and append the font link element
    const linkElement = this.document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.href = fontUrl;

    this.document.head.appendChild(linkElement);
    this.loadedFonts.add(locale);
    this.logger.info(`Dynamically loaded font for locale: ${locale}`);
  }

  /**
   * Load settings from localStorage
   */
  private loadSettings(): void {
    try {
      const stored = this.localStorage.getObject<LocalSettings>(this.STORAGE_KEY);

      if (stored) {
        // Merge with defaults to ensure all properties exist
        // For existing users, new properties will get their default values
        const mergedSettings: LocalSettings = {
          ...DEFAULT_LOCAL_SETTINGS,
          ...stored,
          // Explicitly ensure startOnLastRoute defaults to true for existing users
          // who don't have this property yet
          startOnLastRoute: stored.startOnLastRoute !== undefined ? stored.startOnLastRoute : true,
          // Explicitly ensure startFeedsOnLastEvent defaults to true for existing users
          // who don't have this property yet
          startFeedsOnLastEvent: stored.startFeedsOnLastEvent !== undefined ? stored.startFeedsOnLastEvent : true,
          // Explicitly ensure autoRelayAuth defaults to true for existing users
          // who don't have this property yet
          autoRelayAuth: stored.autoRelayAuth !== undefined ? stored.autoRelayAuth : true,
        };

        this.settings.set(mergedSettings);
        this.logger.debug('Local settings loaded successfully', mergedSettings);
      } else {
        // New installation - set menuOpen based on device type
        // Desktop (not mobile): menu should be open
        // Mobile: menu should be closed
        const isHandset = this.breakpointObserver.isMatched('(max-width: 599px)');
        const defaultSettings = {
          ...DEFAULT_LOCAL_SETTINGS,
          menuOpen: !isHandset, // Open on desktop, closed on mobile
        };

        this.logger.debug('No local settings found, using defaults with device-specific menuOpen', {
          isHandset,
          menuOpen: defaultSettings.menuOpen,
        });
        this.settings.set(defaultSettings);
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
    this.settings.update(current => ({
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
   * Set automatic relay authentication preference
   */
  setAutoRelayAuth(autoRelayAuth: boolean): void {
    this.updateSettings({ autoRelayAuth });
  }

  /**
   * Set add client tag preference
   */
  setAddClientTag(addClientTag: boolean): void {
    this.updateSettings({ addClientTag });
  }

  /**
   * Set show client tag preference
   */
  setShowClientTag(showClientTag: boolean): void {
    this.updateSettings({ showClientTag });
  }

  /**
   * Set trust enabled preference
   */
  setTrustEnabled(trustEnabled: boolean): void {
    this.updateSettings({ trustEnabled });
  }

  /**
   * Set trust relay URL
   */
  setTrustRelay(trustRelay: string): void {
    this.updateSettings({ trustRelay });
  }

  /**
   * Set start on last route preference
   */
  setStartOnLastRoute(startOnLastRoute: boolean): void {
    this.updateSettings({ startOnLastRoute });
  }

  /**
   * Set start feeds on last event preference
   */
  setStartFeedsOnLastEvent(startFeedsOnLastEvent: boolean): void {
    this.updateSettings({ startFeedsOnLastEvent });
  }

  /**
   * Set show thread lines preference
   */
  setShowThreadLines(showThreadLines: boolean): void {
    this.updateSettings({ showThreadLines });
  }

  /**
   * Set open threads expanded preference
   */
  setOpenThreadsExpanded(openThreadsExpanded: boolean): void {
    this.updateSettings({ openThreadsExpanded });
  }

  /**
   * Set remove tracking parameters preference
   */
  setRemoveTrackingParameters(removeTrackingParameters: boolean): void {
    this.updateSettings({ removeTrackingParameters });
  }

  /**
   * Set calendar type preference
   */
  setCalendarType(calendarType: CalendarType): void {
    this.updateSettings({ calendarType });
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
   * Toggle remove tracking parameters
   */
  toggleRemoveTrackingParameters(): void {
    this.setRemoveTrackingParameters(!this.removeTrackingParameters());
  }

  /**
   * Reset all settings to defaults
   */
  resetToDefaults(): void {
    this.settings.set({ ...DEFAULT_LOCAL_SETTINGS });
  }
}
