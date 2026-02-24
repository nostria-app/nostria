import { Injectable, PLATFORM_ID, effect, inject, signal, DOCUMENT } from '@angular/core';
import { LoggerService } from './logger.service';
import { isPlatformBrowser } from '@angular/common';
import { LocalStorageService } from './local-storage.service';

/**
 * Available text scale values.
 * 1.0 = 100% (default, respects system settings)
 * Values above 1.0 make text larger
 */
export type TextScaleValue = 1.0 | 1.05 | 1.1 | 1.15 | 1.2 | 1.25 | 1.3 | 1.35 | 1.4 | 1.45 | 1.5 | 1.55 | 1.6 | 1.65 | 1.7 | 1.75 | 1.8 | 1.85 | 1.9 | 1.95 | 2.0;

export const TEXT_SCALE_OPTIONS: TextScaleValue[] = [1.0, 1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.55, 1.6, 1.65, 1.7, 1.75, 1.8, 1.85, 1.9, 1.95, 2.0];

export const DEFAULT_TEXT_SCALE: TextScaleValue = 1.0;

/**
 * Service for managing text scale/zoom level.
 * This allows users to adjust the text size in the app independently of system settings.
 * The scale multiplies with the system/browser font size for maximum accessibility.
 *
 * How it works:
 * - Sets a CSS custom property `--nostria-text-scale` on the document root
 * - Typography CSS variables use calc() with this multiplier
 * - rem-based font sizes respect both system settings AND this multiplier
 */
@Injectable({
  providedIn: 'root',
})
export class TextScaleService {
  readonly STORAGE_KEY = 'nostria-text-scale';
  readonly CSS_PROPERTY = '--nostria-text-scale';

  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly logger = inject(LoggerService);
  private readonly localStorage = inject(LocalStorageService);

  /** Current text scale value (1.0 = 100%) */
  textScale = signal<number>(this.getInitialTextScale());

  constructor() {
    this.logger.info('Initializing TextScaleService');

    // Set up effect to apply text scale changes
    effect(() => {
      const scale = this.textScale();
      this.logger.debug(`Applying text scale: ${scale * 100}%`);
      this.applyTextScale(scale);
    });

    this.logger.debug(`Initial text scale set to: ${this.textScale() * 100}%`);
  }

  /**
   * Set the text scale value
   * @param scale - Scale value between 1.0 and 2.0
   */
  setTextScale(scale: number): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.logger.warn('Attempted to set text scale in SSR context');
      return;
    }

    // Clamp to valid range
    const clampedScale = Math.max(1.0, Math.min(2.0, scale));

    this.logger.info(`Setting text scale to: ${clampedScale * 100}%`);
    this.textScale.set(clampedScale);
    this.localStorage.setItem(this.STORAGE_KEY, clampedScale.toString());
  }

  /**
   * Reset text scale to default (100%)
   */
  resetTextScale(): void {
    this.setTextScale(DEFAULT_TEXT_SCALE);
  }

  /**
   * Increase text scale by one step
   */
  increaseTextScale(): void {
    const currentIndex = TEXT_SCALE_OPTIONS.indexOf(this.textScale() as TextScaleValue);
    if (currentIndex < TEXT_SCALE_OPTIONS.length - 1) {
      this.setTextScale(TEXT_SCALE_OPTIONS[currentIndex + 1]);
    }
  }

  /**
   * Decrease text scale by one step
   */
  decreaseTextScale(): void {
    const currentIndex = TEXT_SCALE_OPTIONS.indexOf(this.textScale() as TextScaleValue);
    if (currentIndex > 0) {
      this.setTextScale(TEXT_SCALE_OPTIONS[currentIndex - 1]);
    }
  }

  /**
   * Get the initial text scale from localStorage or default
   */
  private getInitialTextScale(): number {
    if (!isPlatformBrowser(this.platformId)) {
      return DEFAULT_TEXT_SCALE; // Default in SSR
    }

    const savedScale = this.localStorage.getItem(this.STORAGE_KEY);
    if (savedScale) {
      const parsed = parseFloat(savedScale);
      if (!isNaN(parsed) && parsed >= 1.0 && parsed <= 2.0) {
        this.logger.debug(`Using saved text scale: ${parsed * 100}%`);
        return parsed;
      }
    }

    this.logger.debug('No saved text scale, using default: 100%');
    return DEFAULT_TEXT_SCALE;
  }

  /**
   * Apply the text scale by setting CSS custom property
   */
  private applyTextScale(scale: number): void {
    if (!isPlatformBrowser(this.platformId)) {
      return; // Don't modify DOM during SSR
    }

    this.document.documentElement.style.setProperty(this.CSS_PROPERTY, scale.toString());
  }
}
