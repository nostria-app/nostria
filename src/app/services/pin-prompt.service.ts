import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { PinPromptDialogComponent, PinPromptDialogData } from '../components/pin-prompt-dialog/pin-prompt-dialog.component';

export interface PinPromptOptions {
  /** Title for the dialog */
  title?: string;
  /** Message to display */
  message?: string;
  /** Whether to use cached PIN if available */
  useCache?: boolean;
  /** Number of failed attempts (for retry UI) */
  failedAttempts?: number;
  /** Whether to show forgot PIN hint */
  showForgotHint?: boolean;
}

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
   * @param options - Configuration options for the prompt
   * @returns The entered PIN or null if cancelled
   */
  async promptForPin(options: PinPromptOptions | boolean = true): Promise<string | null> {
    // Handle legacy boolean parameter for backwards compatibility
    const opts: PinPromptOptions = typeof options === 'boolean'
      ? { useCache: options }
      : options;

    const useCache = opts.useCache ?? true;

    // Check if we have a cached PIN that hasn't expired
    if (useCache && this.cachedPin && this.cacheExpiry && Date.now() < this.cacheExpiry) {
      return this.cachedPin;
    }

    // Open the PIN prompt dialog
    const dialogData: PinPromptDialogData = {
      title: opts.title,
      message: opts.message,
      failedAttempts: opts.failedAttempts,
      showForgotHint: opts.showForgotHint,
    };

    const dialogRef = this.dialog.open(PinPromptDialogComponent, {
      disableClose: true,
      width: '400px',
      data: dialogData,
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
   * Prompts for PIN with retry support. Will keep prompting until
   * the validator returns true or user cancels.
   * 
   * @param validator - Function that validates the PIN, returns true if valid
   * @param options - Configuration options for the prompt
   * @returns The valid PIN or null if cancelled
   */
  async promptForPinWithRetry(
    validator: (pin: string) => Promise<boolean>,
    options: Omit<PinPromptOptions, 'failedAttempts' | 'useCache'> = {}
  ): Promise<string | null> {
    let failedAttempts = 0;

    while (true) {
      const pin = await this.promptForPin({
        ...options,
        useCache: false, // Don't use cache when retrying
        failedAttempts,
        showForgotHint: failedAttempts >= 2,
      });

      if (!pin) {
        // User cancelled
        return null;
      }

      const isValid = await validator(pin);
      if (isValid) {
        // Cache the valid PIN
        this.cachedPin = pin;
        this.cacheExpiry = Date.now() + this.CACHE_DURATION;
        return pin;
      }

      // PIN was invalid, increment counter and retry
      failedAttempts++;
    }
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
