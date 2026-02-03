import { Injectable, computed, effect, inject, signal, DOCUMENT, PLATFORM_ID } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { LoggerService } from './logger.service';
import { BreakpointObserver } from '@angular/cdk/layout';
import { isPlatformBrowser } from '@angular/common';
import { Subject, debounceTime } from 'rxjs';

export type CalendarType = 'gregorian' | 'chronia' | 'ethiopian';
export type TimeFormat = '12h' | '24h';
export type HomeDestination = 'feeds' | 'home' | 'first-menu-item';

/**
 * Global content filter settings for feeds
 * These settings apply to ALL feeds, not per-feed
 */
export interface ContentFilterSettings {
  /** Array of Nostr event kinds to show */
  kinds: number[];
  /** Whether to show reply posts */
  showReplies: boolean;
  /** Whether to show reposts */
  showReposts: boolean;
}

/** Default content filter: show posts and reposts */
export const DEFAULT_CONTENT_FILTER: ContentFilterSettings = {
  kinds: [1, 1111, 6, 16, 30023, 1068, 1222, 1244, 20, 21, 22, 34235, 34236],
  showReplies: false,
  showReposts: true,
};

/**
 * Represents a menu item configuration for the main navigation.
 * The id corresponds to the path of the navigation item.
 */
export interface MenuItemConfig {
  /** Unique identifier matching the nav item path */
  id: string;
  /** Whether this item is visible in the menu */
  visible: boolean;
}

/**
 * Threshold for filtering notifications from events with too many tagged accounts.
 * This helps prevent spam notifications from mass-tagging attacks.
 * 'none' means no filtering (allow any number of tags).
 */
export type MaxTaggedAccountsFilter = 'none' | 10 | 50 | 100 | 200;

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
  timeFormat: TimeFormat;
  /** Where the home button (Nostria logo) should navigate to */
  homeDestination: HomeDestination;
  /** Custom menu item order and visibility. Array order determines display order. */
  menuItems: MenuItemConfig[];
  /** Global content filter settings for all feeds */
  contentFilter: ContentFilterSettings;
  /**
   * Maximum number of tagged accounts allowed in an event for notifications.
   * Events with more tags than this threshold will not generate notifications.
   * 'none' means no filtering (default).
   */
  maxTaggedAccountsFilter: MaxTaggedAccountsFilter;
}

const DEFAULT_LOCAL_SETTINGS: LocalSettings = {
  menuOpen: false,
  menuExpanded: true,
  locale: 'en',
  maxRelaysPerUser: 4,
  autoRelayAuth: false,
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
  timeFormat: '24h',
  homeDestination: 'feeds',
  menuItems: [], // Empty means use default order
  contentFilter: { ...DEFAULT_CONTENT_FILTER },
  maxTaggedAccountsFilter: 'none', // No filtering by default
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

  // Debounced save subject to batch rapid settings changes
  private saveSubject = new Subject<LocalSettings>();

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
  readonly timeFormat = computed(() => this.settings().timeFormat);
  readonly homeDestination = computed(() => this.settings().homeDestination);
  readonly menuItems = computed(() => this.settings().menuItems);
  readonly contentFilter = computed(() => this.settings().contentFilter ?? DEFAULT_CONTENT_FILTER);
  readonly maxTaggedAccountsFilter = computed(() => this.settings().maxTaggedAccountsFilter ?? 'none');

  /** Default menu item IDs in order (used when no custom config is set) */
  private readonly defaultMenuIds = [
    '/',
    '/f',
    'articles',
    'summary',
    'messages',
    'people',
    'collections',
    'music',
    'streams',
  ];

  /**
   * Gets the path of the first visible menu item.
   * Returns '/f' as fallback if no menu items are configured.
   */
  readonly firstMenuItemPath = computed(() => {
    const menuConfig = this.menuItems();

    if (menuConfig.length === 0) {
      // Use first default menu item
      return this.defaultMenuIds[0] || '/f';
    }

    // Find first visible item
    const firstVisible = menuConfig.find(item => item.visible);
    return firstVisible?.id || '/f';
  });

  constructor() {
    // Set up debounced save - waits 300ms after last change before saving
    this.saveSubject.pipe(debounceTime(300)).subscribe(settings => {
      this.saveSettings(settings);
    });

    this.loadSettings();

    // Auto-save settings whenever they change (debounced)
    effect(() => {
      const currentSettings = this.settings();
      this.saveSubject.next(currentSettings);
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
          // Explicitly ensure autoRelayAuth defaults to false for existing users
          // who don't have this property yet (most users don't use authentication)
          autoRelayAuth: stored.autoRelayAuth !== undefined ? stored.autoRelayAuth : false,
          // Ensure contentFilter exists for existing users
          contentFilter: stored.contentFilter ?? DEFAULT_CONTENT_FILTER,
        };

        this.settings.set(mergedSettings);
        this.logger.debug('Local settings loaded successfully', mergedSettings);
      } else {
        // New installation - set menuOpen based on device type
        // Desktop (not mobile): menu should be open
        // Mobile/smaller screens: menu should be closed
        const isHandset = this.breakpointObserver.isMatched('(max-width: 699px)');
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
   * Set locale and save immediately (bypasses debounce).
   * Use this when you need to reload the page right after changing locale.
   */
  setLocaleImmediate(locale: string): void {
    this.settings.update(current => ({
      ...current,
      locale,
    }));
    // Save immediately, bypassing the debounce
    this.saveSettings(this.settings());
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
   * Set time format preference
   */
  setTimeFormat(timeFormat: TimeFormat): void {
    this.updateSettings({ timeFormat });
  }

  /**
   * Set home destination preference
   */
  setHomeDestination(homeDestination: HomeDestination): void {
    this.updateSettings({ homeDestination });
  }

  /**
   * Set menu items configuration (order and visibility)
   */
  setMenuItems(menuItems: MenuItemConfig[]): void {
    this.updateSettings({ menuItems });
  }

  /**
   * Reset menu items to default
   */
  resetMenuItems(): void {
    this.updateSettings({ menuItems: [] });
  }

  /**
   * Set content filter settings (global for all feeds)
   */
  setContentFilter(contentFilter: ContentFilterSettings): void {
    this.updateSettings({ contentFilter });
  }

  /**
   * Update content filter kinds
   */
  setContentFilterKinds(kinds: number[]): void {
    const current = this.contentFilter();
    this.setContentFilter({ ...current, kinds });
  }

  /**
   * Set content filter show replies setting
   */
  setContentFilterShowReplies(showReplies: boolean): void {
    const current = this.contentFilter();
    this.setContentFilter({ ...current, showReplies });
  }

  /**
   * Set content filter show reposts setting
   */
  setContentFilterShowReposts(showReposts: boolean): void {
    const current = this.contentFilter();
    this.setContentFilter({ ...current, showReposts });
  }

  /**
   * Reset content filter to defaults
   */
  resetContentFilter(): void {
    this.setContentFilter({ ...DEFAULT_CONTENT_FILTER });
  }

  /**
   * Set max tagged accounts filter for notifications
   * This filters out notifications from events with too many tagged accounts (spam prevention)
   */
  setMaxTaggedAccountsFilter(maxTaggedAccountsFilter: MaxTaggedAccountsFilter): void {
    this.updateSettings({ maxTaggedAccountsFilter });
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
