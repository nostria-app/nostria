import { Injectable, PLATFORM_ID, effect, inject, signal, DOCUMENT } from '@angular/core';
import { LoggerService } from './logger.service';
import { isPlatformBrowser } from '@angular/common';
import { LocalStorageService } from './local-storage.service';

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

  darkMode = signal<boolean>(this.getInitialThemePreference());

  constructor() {
    this.logger.info('Initializing ThemeService');

    // Set up effect to apply theme changes
    effect(() => {
      const isDark = this.darkMode();
      this.logger.debug(`Applying theme change: ${isDark ? 'dark' : 'light'}`);
      this.applyTheme(isDark);
    });

    // Initialize browser-specific features after Angular has finished SSR
    if (isPlatformBrowser(this.platformId)) {
      // Run on next tick to ensure we're fully in the browser context
      setTimeout(() => this.initBrowserFeatures(), 0);
    } else {
      this.logger.debug('Running in SSR mode, skipping browser-specific initialization');
    }

    this.logger.debug(`Initial theme set to: ${this.darkMode() ? 'dark' : 'light'}`);
  }

  private async initBrowserFeatures(): Promise<void> {
    try {
      // Initialize media query
      this.darkThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

      // Set initial theme based on saved preference or system preference
      this.darkMode.set(await this.getInitialThemePreference());

      // Listen for system preference changes
      this.darkThemeMediaQuery.addEventListener('change', e => {
        // Only update if user hasn't explicitly set a preference
        if (!this.localStorage.getItem(this.THEME_KEY)) {
          this.logger.info(`System color scheme changed to ${e.matches ? 'dark' : 'light'}`);
          this.darkMode.set(e.matches);
        }
      });

      this.logger.debug(
        `Browser initialization complete. Theme: ${this.darkMode() ? 'dark' : 'light'}`
      );
    } catch (error) {
      this.logger.error('Error initializing browser features:', error);
    }
  }

  toggleDarkMode() {
    // Only allow toggling in browser context
    if (!isPlatformBrowser(this.platformId)) {
      this.logger.warn('Attempted to toggle theme in SSR context');
      return;
    }

    const newValue = !this.darkMode();
    this.logger.info(`Toggling theme to: ${newValue ? 'dark' : 'light'}`);
    this.darkMode.set(newValue);
    this.localStorage.setItem(this.THEME_KEY, newValue ? 'dark' : 'light');
  }

  private getInitialThemePreference() {
    if (!isPlatformBrowser(this.platformId)) {
      return false; // Default to light theme in SSR
    }

    // Check for saved preference
    const savedPreference = this.localStorage.getItem(this.THEME_KEY);
    if (savedPreference) {
      this.logger.debug(`Using saved theme preference: ${savedPreference}`);
      return savedPreference === 'dark';
    }

    // Fall back to system preference
    const systemPrefersDark = this.darkThemeMediaQuery?.matches || false;
    this.logger.debug(
      `No saved theme preference, using system preference: ${systemPrefersDark ? 'dark' : 'light'}`
    );
    return systemPrefersDark;
  }

  private applyTheme(isDark: boolean): void {
    if (!isPlatformBrowser(this.platformId)) {
      return; // Don't try to modify DOM during SSR
    }

    const themeColor = isDark ? this.DARK_THEME_COLOR : this.LIGHT_THEME_COLOR;

    if (isDark) {
      this.document.documentElement.classList.add('dark');
    } else {
      this.document.documentElement.classList.remove('dark');
    }

    this.updateThemeMetaTag(themeColor);
  }

  private updateThemeMetaTag(color: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return; // Don't try to modify DOM during SSR
    }

    // Find the theme-color meta tag
    const metaThemeColor = this.document.querySelector('meta[name="theme-color"]');

    // Set the color
    this.logger.debug(`Setting theme-color to: ${color}`);
    metaThemeColor?.setAttribute('content', color);
  }
}
