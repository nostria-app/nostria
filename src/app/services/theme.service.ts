import { Injectable, effect, inject, signal } from '@angular/core';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  readonly THEME_KEY = 'nostria-theme';
  private readonly darkThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  private readonly logger = inject(LoggerService);

  // Theme colors for PWA
  private readonly LIGHT_THEME_COLOR = '#FEF7FA'; // Light background color
  private readonly DARK_THEME_COLOR = '#303030'; // Dark background color

  darkMode = signal<boolean>(this.getInitialThemePreference());

  constructor() {
    this.logger.info('Initializing ThemeService');

    // Set up effect to apply theme changes
    effect(() => {
      const isDark = this.darkMode();
      this.logger.debug(`Applying theme change: ${isDark ? 'dark' : 'light'}`);
      this.applyTheme(isDark);
    });

    // Listen for system preference changes
    this.darkThemeMediaQuery.addEventListener('change', e => {
      // Only update if user hasn't explicitly set a preference
      if (!localStorage.getItem(this.THEME_KEY)) {
        this.logger.info(`System color scheme changed to ${e.matches ? 'dark' : 'light'}`);
        this.darkMode.set(e.matches);
      }
    });

    this.logger.debug(`Initial theme set to: ${this.darkMode() ? 'dark' : 'light'}`);
  }

  toggleDarkMode(): void {
    const newValue = !this.darkMode();
    this.logger.info(`Toggling theme to: ${newValue ? 'dark' : 'light'}`);
    this.darkMode.set(newValue);
    localStorage.setItem(this.THEME_KEY, newValue ? 'dark' : 'light');
  }

  private getInitialThemePreference(): boolean {
    // Check for saved preference
    const savedPreference = localStorage.getItem(this.THEME_KEY);
    if (savedPreference) {
      this.logger.debug(`Using saved theme preference: ${savedPreference}`);
      return savedPreference === 'dark';
    }

    // Fall back to system preference
    this.logger.debug(`No saved theme preference, using system preference: ${this.darkThemeMediaQuery.matches ? 'dark' : 'light'}`);
    return this.darkThemeMediaQuery.matches;
  }

  private applyTheme(isDark: boolean): void {
    const themeColor = isDark ? this.DARK_THEME_COLOR : this.LIGHT_THEME_COLOR;

    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    this.updateThemeMetaTag(themeColor);
  }

  private updateThemeMetaTag(color: string): void {
    // Find the theme-color meta tag
    let metaThemeColor = document.querySelector('meta[name="theme-color"]');

    // If it doesn't exist, create it
    if (!metaThemeColor) {
      this.logger.debug('Creating theme-color meta tag');
      metaThemeColor = document.createElement('meta');
      metaThemeColor.setAttribute('name', 'theme-color');
      document.head.appendChild(metaThemeColor);
    }

    // Set the color
    this.logger.debug(`Setting theme-color to: ${color}`);
    metaThemeColor.setAttribute('content', color);
  }
}
