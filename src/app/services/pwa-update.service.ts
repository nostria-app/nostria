import { Injectable, effect, inject, signal } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class PwaUpdateService {
  private swUpdate = inject(SwUpdate);
  
  // Signal to track if an update is available
  updateAvailable = signal(false);
  
  constructor() {
    // Only proceed if service worker updates are enabled
    if (this.swUpdate.isEnabled) {
      // Initialize the update checking
      this.initializeUpdateChecking();
      
      // Set up effect to handle version change events
      effect(() => {
        if (this.updateAvailable()) {
          console.log('A new version is available');
        }
      });
    }
  }
  
  /**
   * Initializes periodic update checking and event listeners
   */
  private initializeUpdateChecking(): void {
    // Subscribe to version ready events
    this.swUpdate.versionUpdates
      .pipe(
        filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY')
      )
      .subscribe(() => {
        this.updateAvailable.set(true);
      });
    
    // Check for updates immediately
    this.checkForUpdate();
    
    // Then check every hour
    setInterval(() => {
      this.checkForUpdate();
    }, 60 * 60 * 1000); // 60 minutes
  }
  
  /**
   * Triggers a check for updates
   */
  async checkForUpdate(): Promise<void> {
    if (this.swUpdate.isEnabled) {
      try {
        await this.swUpdate.checkForUpdate();
      } catch (err) {
        console.error('Failed to check for updates:', err);
      }
    }
  }
  
  /**
   * Activates the update and reloads the app
   */
  async updateApplication(): Promise<void> {
    if (this.updateAvailable() && this.swUpdate.isEnabled) {
      try {
        await this.swUpdate.activateUpdate();
        document.location.reload();
      } catch (err) {
        console.error('Failed to activate update:', err);
      }
    }
  }
}
