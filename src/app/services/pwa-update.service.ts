import { Injectable, effect, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
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
