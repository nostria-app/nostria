import { ErrorHandler, Injectable, NgZone, inject } from '@angular/core';
import { LoggerService } from './logger.service';

/**
 * Global error handler that catches all unhandled errors in the application.
 * Specifically handles chunk loading failures that occur during lazy-loaded
 * route navigation when the app has been updated.
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private logger = inject(LoggerService);
  private ngZone = inject(NgZone);
  private isReloading = false;

  handleError(error: unknown): void {
    const errorObj = error as { message?: string; toString?: () => string; rejection?: { message?: string; toString?: () => string } };
    const errorMessage = errorObj?.message || errorObj?.toString?.() || '';
    const errorRejection = errorObj?.rejection?.message || errorObj?.rejection?.toString?.() || '';

    // Check if this is a chunk loading error (common after PWA updates)
    if (this.isChunkLoadError(errorMessage) || this.isChunkLoadError(errorRejection)) {
      this.logger.error('Chunk loading error detected in ErrorHandler:', errorMessage || errorRejection);
      this.handleChunkLoadError();
      return;
    }

    // Log other errors normally
    this.logger.error('Unhandled error:', error);
    console.error('Unhandled error:', error);
  }

  /**
   * Checks if the error is related to chunk/module loading failure
   */
  private isChunkLoadError(message: string): boolean {
    if (!message) return false;

    const chunkErrorPatterns = [
      'Failed to fetch dynamically imported module',
      'Loading chunk',
      'Loading CSS chunk',
      'ChunkLoadError',
      'MIME type',
      'Failed to load module script',
      'error loading dynamically imported module',
      'Importing a module script failed',
      'Unable to preload CSS',
    ];

    return chunkErrorPatterns.some(pattern =>
      message.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Handles chunk loading errors by clearing caches and reloading the app
   */
  private handleChunkLoadError(): void {
    // Prevent multiple reload attempts
    if (this.isReloading) {
      return;
    }
    this.isReloading = true;

    this.logger.warn('Handling chunk load error - clearing caches and reloading');

    // Run outside Angular zone to prevent change detection issues
    this.ngZone.runOutsideAngular(async () => {
      try {
        // Clear all caches
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));
          this.logger.info('All caches cleared');
        }

        // Unregister service workers
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(reg => reg.unregister()));
          this.logger.info('Service workers unregistered');
        }
      } catch (err) {
        this.logger.error('Error clearing caches:', err);
      }

      // Reload the page to get the latest version
      // Use a small delay to ensure logs are flushed
      setTimeout(() => {
        window.location.reload();
      }, 100);
    });
  }
}
