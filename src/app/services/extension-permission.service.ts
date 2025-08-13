import { Injectable, signal, computed, inject } from '@angular/core';
import { AccountStateService } from './account-state.service';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root',
})
export class ExtensionPermissionService {
  private logger = inject(LoggerService);
  private accountState = inject(AccountStateService);

  // Extension decryption permission state
  private _extensionDecryptionPermitted = signal<boolean>(false);
  private _extensionDecryptionExpiresAt = signal<number>(0);
  private _extensionDecryptionTimeoutId: number | null = null;

  // Public readonly signals
  readonly extensionDecryptionPermitted =
    this._extensionDecryptionPermitted.asReadonly();
  readonly extensionDecryptionExpiresAt =
    this._extensionDecryptionExpiresAt.asReadonly();

  // Computed helpers
  readonly isUsingExtension = computed(() => {
    const account = this.accountState.account();
    return account?.source === 'extension';
  });

  readonly isExtensionDecryptionPermissionValid = computed(() => {
    const permitted = this._extensionDecryptionPermitted();
    const expiresAt = this._extensionDecryptionExpiresAt();

    if (!permitted) {
      return false;
    }

    if (expiresAt > 0 && Date.now() > expiresAt) {
      // Permission expired, revoke it
      this.revokeExtensionDecryptionPermission();
      return false;
    }

    return true;
  });

  /**
   * Test extension decryption with the first encrypted message
   * This is used for the "test" button in the banner
   */
  async testExtensionDecryption(
    ciphertext: string,
    senderPubkey: string
  ): Promise<boolean> {
    try {
      const account = this.accountState.account();

      if (account?.source !== 'extension' || !window.nostr?.nip04) {
        return false;
      }

      // Temporarily allow decryption for this test
      await window.nostr.nip04.decrypt(senderPubkey, ciphertext);
      this.logger.debug('Extension decryption test successful');
      return true;
    } catch (error) {
      this.logger.error('Extension decryption test failed', error);
      return false;
    }
  }

  /**
   * Grant extension decryption permission for a specified duration
   */
  grantExtensionDecryptionPermission(durationMinutes = 5): void {
    this.logger.debug(
      `Granting extension decryption permission for ${durationMinutes} minutes`
    );

    // Clear any existing timeout
    if (this._extensionDecryptionTimeoutId) {
      clearTimeout(this._extensionDecryptionTimeoutId);
    }

    // Grant permission
    this._extensionDecryptionPermitted.set(true);

    // Set expiration time
    const expirationTime = Date.now() + durationMinutes * 60 * 1000;
    this._extensionDecryptionExpiresAt.set(expirationTime);

    // Set timeout to revoke permission
    this._extensionDecryptionTimeoutId = setTimeout(
      () => {
        this.revokeExtensionDecryptionPermission();
      },
      durationMinutes * 60 * 1000
    ) as unknown as number;

    this.logger.debug('Extension decryption permission granted');
  }

  /**
   * Revoke extension decryption permission
   */
  revokeExtensionDecryptionPermission(): void {
    this.logger.debug('Revoking extension decryption permission');

    if (this._extensionDecryptionTimeoutId) {
      clearTimeout(this._extensionDecryptionTimeoutId);
      this._extensionDecryptionTimeoutId = null;
    }

    this._extensionDecryptionPermitted.set(false);
    this._extensionDecryptionExpiresAt.set(0);

    this.logger.debug('Extension decryption permission revoked');
  }

  /**
   * Check if extension decryption should be allowed for the current account
   */
  shouldAllowExtensionDecryption(): boolean {
    if (!this.isUsingExtension()) {
      return true; // Non-extension accounts always allowed
    }

    return this.isExtensionDecryptionPermissionValid();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this._extensionDecryptionTimeoutId) {
      clearTimeout(this._extensionDecryptionTimeoutId);
      this._extensionDecryptionTimeoutId = null;
    }
  }
}
