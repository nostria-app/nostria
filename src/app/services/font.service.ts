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
  },
  {
    id: 'inter',
    label: 'Inter',
    fontFamily: 'Inter, "Helvetica Neue", sans-serif',
  },
];

export const DEFAULT_FONT: FontOption = 'roboto';

/**
 * Service for managing the app's font family.
 * This allows users to change the font used throughout the app.
 *
 * How it works:
 * - Sets a CSS custom property `--nostria-font-family` on the document root
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
   * Apply the font by setting CSS custom property
   */
  private applyFont(config: FontConfig): void {
    if (!isPlatformBrowser(this.platformId)) {
      return; // Don't modify DOM during SSR
    }

    // Set CSS custom property
    this.document.documentElement.style.setProperty(this.CSS_PROPERTY, config.fontFamily);
    this.document.documentElement.setAttribute('data-font', config.id);
  }
}
