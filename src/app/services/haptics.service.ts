import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { WebHaptics as WebHapticsInstance } from 'web-haptics';

@Injectable({ providedIn: 'root' })
export class HapticsService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private hapticsInstance?: WebHapticsInstance;

  triggerMedium(): void {
    this.trigger();
  }

  triggerSuccess(): void {
    this.trigger('success');
  }

  triggerLight(): void {
    this.trigger('light');
  }

  triggerSelection(): void {
    this.trigger('selection');
  }

  triggerZapBuzz(): void {
    this.trigger('buzz');
  }

  private trigger(pattern?: 'success' | 'buzz' | 'light' | 'selection'): void {
    if (!this.isBrowser) {
      return;
    }

    void import('web-haptics')
      .then(async ({ WebHaptics, defaultPatterns }) => {
        if (!this.hapticsInstance) {
          this.hapticsInstance = new WebHaptics();
        }

        const haptics = this.hapticsInstance;
        if (!haptics) {
          return;
        }

        const selectedPattern = pattern ? defaultPatterns[pattern] : undefined;
        await haptics.trigger(selectedPattern);
      })
      .catch(() => {
        // Silently ignore haptic errors/unsupported environments
      });
  }
}