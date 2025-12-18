import { Injectable, effect, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent, UnrecoverableStateEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import { LoggerService } from './logger.service';
import { NotificationService } from './notification.service';
import { NotificationType } from './database.service';

@Injectable({
  providedIn: 'root',
})
export class PwaUpdateService {
  private swUpdate = inject(SwUpdate);
  private logger = inject(LoggerService);
  private notificationService = inject(NotificationService);

  // Signal to track if an update is available
  updateAvailable = signal(false);

  constructor() {
    this.logger.info('Initializing PwaUpdateService');

    // Only proceed if service worker updates are enabled
    if (this.swUpdate.isEnabled) {
      this.logger.debug('Service worker updates are enabled');
      // Initialize the update checking
      this.initializeUpdateChecking();

      // Set up effect to handle version change events
      effect(() => {
        if (this.updateAvailable()) {
          this.logger.info('A new version is available');
          this.notifyUpdateAvailable();
        }
      });
    } else {
      this.logger.warn('Service worker updates are not enabled');
    }

    // Set up global error handler for chunk loading failures
    this.setupChunkLoadErrorHandler();
  }

  /**
   * Sets up a global error handler to detect chunk loading failures.
   * This handles cases where the service worker isn't enabled or the error
   * occurs before the service worker can detect it.
   */
  private setupChunkLoadErrorHandler(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('error', (event: ErrorEvent) => {
      // Check for chunk loading errors (MIME type errors or failed module imports)
      if (
        event.message?.includes('Failed to fetch dynamically imported module') ||
        event.message?.includes('Loading chunk') ||
        event.message?.includes('MIME type')
      ) {
        this.logger.error('Chunk loading error detected, reloading app:', event.message);
        this.handleUnrecoverableState('Chunk loading failed: ' + event.message);
      }
    });

    // Also handle unhandled promise rejections for dynamic imports
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const reason = event.reason?.toString() || '';
      if (
        reason.includes('Failed to fetch dynamically imported module') ||
        reason.includes('Loading chunk') ||
        reason.includes('MIME type')
      ) {
        this.logger.error('Dynamic import failed, reloading app:', reason);
        event.preventDefault();
        this.handleUnrecoverableState('Dynamic import failed: ' + reason);
      }
    });
  }

  /**
   * Initializes periodic update checking and event listeners
   */
  private initializeUpdateChecking(): void {
    this.logger.debug('Setting up version update subscription');

    // Subscribe to version ready events
    this.swUpdate.versionUpdates
      .pipe(filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'))
      .subscribe(event => {
        this.logger.info('New version ready', {
          currentVersion: event.currentVersion,
          latestVersion: event.latestVersion,
        });
        this.updateAvailable.set(true);
      });

    // Subscribe to unrecoverable state events
    // This happens when cached assets are no longer available on the server
    this.swUpdate.unrecoverable.subscribe((event: UnrecoverableStateEvent) => {
      this.logger.error('Service worker entered unrecoverable state:', event.reason);
      this.handleUnrecoverableState(event.reason);
    });

    // Check for updates immediately
    this.checkForUpdate();

    // Then check every hour
    this.logger.debug('Setting up hourly update checks');
    setInterval(
      () => {
        this.checkForUpdate();
      },
      60 * 60 * 1000
    ); // 60 minutes
  }

  /**
   * Handles unrecoverable state by clearing caches and reloading
   */
  private async handleUnrecoverableState(reason: string): Promise<void> {
    this.logger.warn('Handling unrecoverable state, clearing caches and reloading');

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

      // Notify user and reload
      this.notificationService.notify(
        'App Refresh Required',
        'The app needs to refresh to load the latest version.',
        NotificationType.GENERAL
      );

      // Short delay to allow notification to show
      setTimeout(() => {
        // Force reload bypassing cache
        window.location.reload();
      }, 1000);
    } catch (err) {
      this.logger.error('Error during unrecoverable state handling:', err);
      // Still try to reload even if cache clearing failed
      window.location.reload();
    }
  }

  /**
   * Triggers a check for updates
   */
  async checkForUpdate(): Promise<void> {
    if (this.swUpdate.isEnabled) {
      this.logger.debug('Checking for updates');
      try {
        await this.swUpdate.checkForUpdate();
        this.logger.debug('Update check completed');
      } catch (err) {
        this.logger.error('Failed to check for updates:', err);
      }
    }
  }

  /**
   * Notifies the user that an update is available
   */
  private notifyUpdateAvailable(): void {
    this.notificationService.notify(
      'App Update Available',
      'A new version of the application is available. Click to update now.',
      NotificationType.SUCCESS,
      'Update Now',
      () => this.updateApplication()
    );
  }

  /**
   * Activates the update and reloads the app
   */
  async updateApplication(): Promise<void> {
    if (this.updateAvailable() && this.swUpdate.isEnabled) {
      this.logger.info('Activating application update');
      try {
        await this.swUpdate.activateUpdate();
        this.logger.info('Update activated, reloading application');
        document.location.reload();
      } catch (err) {
        this.logger.error('Failed to activate update:', err);
        this.notificationService.notify(
          'Update Failed',
          'Failed to activate the update. Please try again.',
          NotificationType.ERROR
        );
      }
    } else {
      this.logger.warn(
        'Cannot update application: update not available or service worker not enabled'
      );
    }
  }
}
