import { Injectable, PLATFORM_ID, effect, inject, signal, DOCUMENT, computed } from '@angular/core';
import { LoggerService } from './logger.service';
import { isPlatformBrowser } from '@angular/common';
import { LocalStorageService } from './local-storage.service';

export type ThemePreference = 'auto' | 'dark' | 'light';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  readonly THEME_KEY = 'nostria-theme';

  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private darkThemeMediaQuery: MediaQueryList | null = null;

  private readonly logger = inject(LoggerService);
  private localStorage = inject(LocalStorageService);

  // Theme colors for PWA - clean neutral colors
  private readonly LIGHT_THEME_COLOR = '#fafafa';
  private readonly DARK_THEME_COLOR = '#1a1a1a';

  /** When non-null, overrides the default theme-color meta tag value. */
  private themeColorOverride = signal<string | null>(null);

  private systemPrefersDark = signal(this.getInitialSystemPreference());

  readonly themePreference = signal<ThemePreference>(this.getInitialThemePreference());
  readonly darkMode = computed(() => this.resolveDarkMode(this.themePreference(), this.systemPrefersDark()));
  readonly resolvedTheme = computed(() => this.darkMode() ? 'dark' as const : 'light' as const);
  readonly followsSystemTheme = computed(() => this.themePreference() === 'auto');

  constructor() {
    // Set up effect to apply theme changes
    effect(() => {
      const isDark = this.darkMode();
      this.applyTheme(isDark);
    });

    // Initialize browser-specific features after Angular has finished SSR
    if (isPlatformBrowser(this.platformId)) {
      // Run on next tick to ensure we're fully in the browser context
      setTimeout(() => this.initBrowserFeatures(), 0);
    }

    // React to override changes — update meta tag when override is set or cleared
    effect(() => {
      const override = this.themeColorOverride();
      if (override !== null) {
        this.updateAllThemeMetaTags(override);
      } else {
        // Restore default theme color
        const isDark = this.darkMode();
        const defaultColor = isDark ? this.DARK_THEME_COLOR : this.LIGHT_THEME_COLOR;
        this.updateAllThemeMetaTags(defaultColor);
      }
    });

  }

  private async initBrowserFeatures(): Promise<void> {
    try {
      // Initialize media query
      this.darkThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.systemPrefersDark.set(this.darkThemeMediaQuery.matches);

      // Listen for system preference changes
      this.darkThemeMediaQuery.addEventListener('change', e => {
        this.systemPrefersDark.set(e.matches);
      });
    } catch (error) {
      this.logger.error('Error initializing browser features:', error);
    }
  }

  setThemePreference(preference: ThemePreference): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.logger.warn('Attempted to set theme preference in SSR context');
      return;
    }

    this.themePreference.set(preference);
    this.localStorage.setItem(this.THEME_KEY, preference);
  }

  toggleDarkMode() {
    // Only allow toggling in browser context
    if (!isPlatformBrowser(this.platformId)) {
      this.logger.warn('Attempted to toggle theme in SSR context');
      return;
    }

    this.setThemePreference(this.darkMode() ? 'light' : 'dark');
  }

  private getInitialSystemPreference(): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      return false;
    }

    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  private getInitialThemePreference(): ThemePreference {
    if (!isPlatformBrowser(this.platformId)) {
      return 'auto';
    }

    const savedPreference = this.localStorage.getItem(this.THEME_KEY);
    if (savedPreference === 'auto' || savedPreference === 'dark' || savedPreference === 'light') {
      return savedPreference;
    }

    return 'auto';
  }

  private resolveDarkMode(preference: ThemePreference, systemPrefersDark: boolean): boolean {
    if (preference === 'dark') {
      return true;
    }

    if (preference === 'light') {
      return false;
    }

    return systemPrefersDark;
  }

  /**
   * Set an override theme-color for the PWA chrome (address bar, status bar).
   * This is used by immersive pages (e.g. music album/track) to tint the
   * browser chrome to match the extracted artwork color.
   *
   * @param color A CSS hex color string, e.g. '#2a1a3b'
   */
  setThemeColorOverride(color: string): void {
    this.themeColorOverride.set(color);
  }

  /**
   * Clear the theme-color override, restoring the default theme color.
   * Call this when leaving immersive pages.
   */
  clearThemeColorOverride(): void {
    this.themeColorOverride.set(null);
  }

  /**
   * Convert HSL values to a hex color string.
   * Useful for converting extracted artwork colors to a format suitable for the meta tag.
   */
  static hslToHex(h: number, s: number, l: number): string {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  private applyTheme(isDark: boolean): void {
    if (!isPlatformBrowser(this.platformId)) {
      return; // Don't try to modify DOM during SSR
    }

    this.document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';

    if (isDark) {
      this.document.documentElement.classList.add('dark');
    } else {
      this.document.documentElement.classList.remove('dark');
    }

    this.document.body.style.backgroundColor = isDark ? this.DARK_THEME_COLOR : this.LIGHT_THEME_COLOR;
    this.document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');

    // Only update meta tags here if there's no active override
    // (the override effect handles it when an override is set)
    if (this.themeColorOverride() === null) {
      const themeColor = isDark ? this.DARK_THEME_COLOR : this.LIGHT_THEME_COLOR;
      this.updateAllThemeMetaTags(themeColor);
    }
  }

  /**
   * Update ALL theme-color meta tags in the document.
   * The document has three: two with media queries (light/dark) and one fallback with id.
   */
  private updateAllThemeMetaTags(color: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return; // Don't try to modify DOM during SSR
    }

    // Update all meta[name="theme-color"] tags
    const metaTags = this.document.querySelectorAll('meta[name="theme-color"]');
    metaTags.forEach((tag: Element) => {
      tag.setAttribute('content', color);
    });
  }
}
