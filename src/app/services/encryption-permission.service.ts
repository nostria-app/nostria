import { Injectable, inject } from '@angular/core';
import { AccountStateService } from './account-state.service';
import { LoggerService } from './logger.service';

export interface DecryptionRequest {
  resolve: (result: string) => void;
  reject: (error: Error) => void;
  method: 'nip04' | 'nip44';
  params: {
    ciphertext: string;
    pubkey: string;
  };
}

@Injectable({
  providedIn: 'root',
})
export class EncryptionPermissionService {
  private readonly accountState = inject(AccountStateService);
  private readonly logger = inject(LoggerService);

  // Queue for pending decryption requests
  private decryptionQueue: DecryptionRequest[] = [];
  private isProcessingQueue = false;

  /**
   * Check if the current account needs decryption permission
   */
  needsPermission(): boolean {
    const account = this.accountState.account();
    return account?.source === 'extension';
  }

  /**
   * For compatibility with existing code - extension accounts always need to queue requests
   */
  hasPermission(): boolean {
    // For extension accounts, we always queue requests
    // For non-extension accounts, they always have permission
    return !this.needsPermission();
  }

  /**
   * Queue a decryption request and process it
   */
  async queueDecryptionRequest(
    method: 'nip04' | 'nip44',
    ciphertext: string,
    pubkey: string
  ): Promise<string> {
    if (!this.needsPermission()) {
      // Non-extension accounts - proceed directly
      return this.performDecryption(method, ciphertext, pubkey);
    }

    // Queue the request for extension accounts
    return new Promise<string>((resolve, reject) => {
      const request: DecryptionRequest = {
        resolve,
        reject,
        method,
        params: { ciphertext, pubkey }
      };

      this.decryptionQueue.push(request);
      this.logger.debug(`Queued decryption request. Queue length: ${this.decryptionQueue.length}`);

      // Process the queue if not already processing
      if (!this.isProcessingQueue) {
        this.processQueue();
      }
    });
  }

  /**
   * Process all queued decryption requests sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.decryptionQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    this.logger.debug('Processing decryption queue');

    while (this.decryptionQueue.length > 0) {
      const request = this.decryptionQueue.shift()!;

      try {
        const result = await this.performDecryption(
          request.method,
          request.params.ciphertext,
          request.params.pubkey
        );
        request.resolve(result);
        this.logger.debug('Successfully processed decryption request');

        // Small delay between requests to prevent overwhelming the browser extension
        if (this.decryptionQueue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        this.logger.error('Failed to process decryption request:', error);
        request.reject(error as Error);
      }
    }

    this.isProcessingQueue = false;
    this.logger.debug('Finished processing decryption queue');
  }

  /**
   * Perform the actual decryption using window.nostr
   */
  private async performDecryption(method: 'nip04' | 'nip44', ciphertext: string, pubkey: string): Promise<string> {
    this.logger.debug(`Performing ${method} decryption with pubkey: ${pubkey.substring(0, 16)}...`);

    try {
      if (method === 'nip04') {
        if (!window.nostr?.nip04) {
          throw new Error('Browser extension NIP-04 not available');
        }
        const result = await window.nostr.nip04.decrypt(pubkey, ciphertext);
        this.logger.debug(`✅ NIP-04 decryption successful, result length: ${result.length}`);
        return result;
      } else {
        if (!window.nostr?.nip44) {
          throw new Error('Browser extension NIP-44 not available');
        }
        this.logger.debug(`Calling window.nostr.nip44.decrypt with pubkey ${pubkey.substring(0, 16)}...`);
        const result = await window.nostr.nip44.decrypt(pubkey, ciphertext);
        this.logger.debug(`✅ NIP-44 decryption successful, result length: ${result.length}`);
        return result;
      }
    } catch (error) {
      this.logger.error(`❌ ${method} decryption failed:`, error);
      throw error;
    }
  }

  /**
   * Clear the decryption queue (useful for cleanup)
   */
  clear(): void {
    // Reject all pending requests
    while (this.decryptionQueue.length > 0) {
      const request = this.decryptionQueue.shift()!;
      request.reject(new Error('Decryption queue cleared'));
    }

    this.isProcessingQueue = false;
    this.logger.debug('Cleared decryption queue');
  }

  /**
   * Legacy method for compatibility - no longer needed
   */
  revokePermission(): void {
    this.logger.debug('Revoke permission called - no-op in simplified version');
  }
}