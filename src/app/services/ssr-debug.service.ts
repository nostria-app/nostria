import { Injectable, PLATFORM_ID, inject, signal, computed } from '@angular/core';
import { isPlatformServer } from '@angular/common';

@Injectable({
  providedIn: 'root',
})
export class SsrDebugService {
  private platformId = inject(PLATFORM_ID);

  // Use signals for reactive state
  readonly isServer = signal(isPlatformServer(this.platformId));
  readonly debugEnabled = signal(true);

  // Computed value that determines if we should log
  private shouldLog = computed(() => this.isServer() && this.debugEnabled());

  /**
   * Log information during SSR process
   */
  async logSsr(message: string, data?: any): Promise<void> {
    if (this.shouldLog()) {
      console.log(`[SSR-DEBUG] ${message}`, data || '');
    }
  }

  /**
   * Log error during SSR process
   */
  async errorSsr(message: string, error?: any): Promise<void> {
    if (this.isServer()) {
      console.error(`[SSR-ERROR] ${message}`, error || '');

      // Log stack trace if available
      if (error?.stack) {
        console.error(`[SSR-STACK] ${error.stack}`);
      }
    }
  }

  /**
   * Returns information about the current execution environment
   */
  getEnvironmentInfo(): Record<string, any> {
    return {
      isServer: this.isServer(),
      platformId: this.platformId.toString(),
      timestamp: new Date().toISOString(),
      nodeEnv: typeof process !== 'undefined' ? process.env['NODE_ENV'] : 'browser',
      memory: typeof process !== 'undefined' ? process.memoryUsage() : null,
    };
  }
}
