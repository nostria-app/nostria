import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { PinPromptDialogComponent } from '../components/pin-prompt-dialog/pin-prompt-dialog.component';

/**
 * Service to handle PIN prompting throughout the application.
 * This service provides a centralized way to prompt users for their PIN
 * when accessing encrypted private keys.
 */
@Injectable({
  providedIn: 'root',
})
export class PinPromptService {
  private dialog = inject(MatDialog);
  private cachedPin: string | null = null;
  private cacheExpiry: number | null = null;
  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  /**
   * Prompts the user to enter their PIN.
   * Returns the PIN if entered, or null if cancelled.
   * 
   * @param useCache - If true, returns cached PIN if available and not expired
   * @returns The entered PIN or null if cancelled
   */
  async promptForPin(useCache = true): Promise<string | null> {
    // Check if we have a cached PIN that hasn't expired
    if (useCache && this.cachedPin && this.cacheExpiry && Date.now() < this.cacheExpiry) {
      return this.cachedPin;
    }

    // Open the PIN prompt dialog
    const dialogRef = this.dialog.open(PinPromptDialogComponent, {
      disableClose: true,
      width: '400px',
    });

    const pin = await firstValueFrom(dialogRef.afterClosed());

    if (pin) {
      // Cache the PIN for 5 minutes
      this.cachedPin = pin;
      this.cacheExpiry = Date.now() + this.CACHE_DURATION;
    }

    return pin;
  }

  /**
   * Clears the cached PIN immediately.
   * Should be called on logout or when security requires it.
   */
  clearCache(): void {
    this.cachedPin = null;
    this.cacheExpiry = null;
  }

  /**
   * Checks if there's a valid cached PIN available.
   */
  hasCachedPin(): boolean {
    return !!(this.cachedPin && this.cacheExpiry && Date.now() < this.cacheExpiry);
  }
}
