import { Injectable, PLATFORM_ID, effect, inject, signal, DOCUMENT } from '@angular/core';
import { LoggerService } from './logger.service';
import { isPlatformBrowser } from '@angular/common';
import { LocalStorageService } from './local-storage.service';

/**
 * Available font options for the app.
 */
export type FontOption = 'roboto' | 'system' | 'sora' | 'inter';

export interface FontConfig {
  id: FontOption;
  label: string;
  fontFamily: string;
  googleFontUrl?: string;
}

export const FONT_OPTIONS: FontConfig[] = [
  {
    id: 'roboto',
    label: 'Roboto',
    fontFamily: 'Roboto, "Helvetica Neue", sans-serif',
    // Already loaded in index.html
  },
  {
    id: 'system',
    label: 'System Font',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
    // No URL needed - uses system fonts
  },
  {
    id: 'sora',
    label: 'Sora',
    fontFamily: 'Sora, "Helvetica Neue", sans-serif',
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Sora:wght@100..800&display=swap',
  },
  {
    id: 'inter',
    label: 'Inter',
    fontFamily: 'Inter, "Helvetica Neue", sans-serif',
    googleFontUrl: 'https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap',
  },
];

export const DEFAULT_FONT: FontOption = 'roboto';

/**
 * Service for managing the app's font family.
 * This allows users to change the font used throughout the app.
 *
 * How it works:
 * - Sets a CSS custom property `--nostria-font-family` on the document root
 * - Dynamically loads Google Fonts when needed
 * - Saves preference to localStorage for persistence
 */
@Injectable({
  providedIn: 'root',
})
export class FontService {
  readonly STORAGE_KEY = 'nostria-font';
  readonly CSS_PROPERTY = '--nostria-font-family';

  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly logger = inject(LoggerService);
  private readonly localStorage = inject(LocalStorageService);

  /** Set of loaded font URLs to avoid duplicate loads */
  private loadedFonts = new Set<string>();

  /** Current font option */
  font = signal<FontOption>(this.getInitialFont());

  /** Current font config */
  fontConfig = signal<FontConfig>(this.getFontConfig(this.font()));

  constructor() {
    this.logger.info('Initializing FontService');

    // Set up effect to apply font changes
    effect(() => {
      const fontId = this.font();
      const config = this.getFontConfig(fontId);
      this.fontConfig.set(config);
      this.logger.debug(`Applying font: ${config.label}`);
      this.applyFont(config);
    });

    this.logger.debug(`Initial font set to: ${this.font()}`);
  }

  /**
   * Get font config by ID
   */
  getFontConfig(fontId: FontOption): FontConfig {
    return FONT_OPTIONS.find(f => f.id === fontId) ?? FONT_OPTIONS[0];
  }

  /**
   * Set the font
   * @param fontId - Font option ID
   */
  setFont(fontId: FontOption): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.logger.warn('Attempted to set font in SSR context');
      return;
    }

    this.logger.info(`Setting font to: ${fontId}`);
    this.font.set(fontId);
    this.localStorage.setItem(this.STORAGE_KEY, fontId);
  }

  /**
   * Reset font to default (Roboto)
   */
  resetFont(): void {
    this.setFont(DEFAULT_FONT);
  }

  /**
   * Get the initial font from localStorage or default
   */
  private getInitialFont(): FontOption {
    if (!isPlatformBrowser(this.platformId)) {
      return DEFAULT_FONT; // Default in SSR
    }

    const savedFont = this.localStorage.getItem(this.STORAGE_KEY) as FontOption | null;
    if (savedFont && FONT_OPTIONS.some(f => f.id === savedFont)) {
      this.logger.debug(`Using saved font: ${savedFont}`);
      return savedFont;
    }

    this.logger.debug('No saved font, using default: roboto');
    return DEFAULT_FONT;
  }

  /**
   * Apply the font by setting CSS custom property and loading font if needed
   */
  private applyFont(config: FontConfig): void {
    if (!isPlatformBrowser(this.platformId)) {
      return; // Don't modify DOM during SSR
    }

    // Load Google Font if needed
    if (config.googleFontUrl && !this.loadedFonts.has(config.googleFontUrl)) {
      this.loadGoogleFont(config.googleFontUrl);
    }

    // Set CSS custom property
    this.document.documentElement.style.setProperty(this.CSS_PROPERTY, config.fontFamily);
  }

  /**
   * Dynamically load a Google Font stylesheet
   */
  private loadGoogleFont(url: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    // Check if already loaded
    if (this.loadedFonts.has(url)) {
      return;
    }

    this.logger.debug(`Loading Google Font: ${url}`);

    const link = this.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    link.setAttribute('data-font-loader', 'nostria');

    this.document.head.appendChild(link);
    this.loadedFonts.add(url);
  }
}
