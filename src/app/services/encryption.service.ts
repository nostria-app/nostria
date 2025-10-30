import { Injectable, inject, Injector } from '@angular/core';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { EncryptionPermissionService } from './encryption-permission.service';
import { hexToBytes } from '@noble/hashes/utils.js';
import { Event, nip04 } from 'nostr-tools';
import { v2 } from 'nostr-tools/nip44';
import { UtilitiesService } from './utilities.service';
import { NostrService } from './nostr.service';

export interface EncryptionResult {
  content: string;
  algorithm: 'nip04' | 'nip44';
}

export interface DecryptionResult {
  content: string;
  algorithm: 'nip04' | 'nip44';
}

@Injectable({
  providedIn: 'root',
})
export class EncryptionService {
  private logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);
  private accountState = inject(AccountStateService);
  private encryptionPermission = inject(EncryptionPermissionService);
  private injector = inject(Injector);
  private nostrService?: NostrService; // Lazy inject to avoid circular dependency

  /**
   * Get NostrService lazily to avoid circular dependency
   */
  private getNostrService(): NostrService {
    if (!this.nostrService) {
      this.nostrService = this.injector.get(NostrService);
    }
    return this.nostrService;
  } /**
   * Encrypt a message using NIP-04 (legacy, less secure)
   * Uses AES-256-CBC encryption
   */
  async encryptNip04(plaintext: string, recipientPubkey: string): Promise<string> {
    try {
      const account = this.accountState.account();

      // Check if we can use the browser extension
      if (account?.source === 'extension' && window.nostr?.nip04) {
        return await window.nostr.nip04.encrypt(recipientPubkey, plaintext);
      }

      if (!account?.privkey) {
        throw new Error('Private key not available for encryption');
      }

      // Get the decrypted private key (handles both encrypted and plaintext keys)
      const nostrService = this.getNostrService();
      const decryptedPrivkey = await nostrService.getDecryptedPrivateKeyWithPrompt(account);

      if (!decryptedPrivkey) {
        throw new Error('Failed to decrypt private key');
      }

      // Use nostr-tools nip04 encryption
      const privateKeyBytes = hexToBytes(decryptedPrivkey);
      return await nip04.encrypt(privateKeyBytes, recipientPubkey, plaintext);
    } catch (error) {
      this.logger.error('Failed to encrypt with NIP-04', error);
      throw new Error('Encryption failed');
    }
  }
  /**
   * Decrypt a message using NIP-04 (legacy, less secure)
   */
  async decryptNip04(ciphertext: string, pubkey: string): Promise<string> {
    try {
      const account = this.accountState.account();

      // Check if we can use the browser extension
      if (account?.source === 'extension' && window.nostr?.nip04) {
        // Use the permission service to handle the decryption request
        return await this.encryptionPermission.queueDecryptionRequest('nip04', ciphertext, pubkey);
      }

      if (!account?.privkey) {
        throw new Error('Private key not available for decryption');
      }

      // Get decrypted private key (handles both encrypted and plaintext keys)
      const nostrService = this.getNostrService();
      const decryptedPrivkey = await nostrService.getDecryptedPrivateKeyWithPrompt(account);

      if (!decryptedPrivkey) {
        throw new Error('Failed to decrypt private key');
      }

      // Use nostr-tools nip04 decryption
      const privateKeyBytes = hexToBytes(decryptedPrivkey);
      return await nip04.decrypt(privateKeyBytes, pubkey, ciphertext);
    } catch (error: any) {
      this.logger.error('Failed to decrypt with NIP-04', error);
      throw new Error('Decryption failed: ', error.message);
    }
  }
  /**
   * Encrypt a message using NIP-44 (modern, secure)
   */
  async encryptNip44(plaintext: string, recipientPubkey: string): Promise<string> {
    try {
      const account = this.accountState.account();

      // Check if we can use the browser extension
      if (account?.source === 'extension' && window.nostr?.nip44) {
        return await window.nostr.nip44.encrypt(recipientPubkey, plaintext);
      }

      if (!account?.privkey) {
        throw new Error('Private key not available for encryption');
      }

      // Get decrypted private key (handles both encrypted and plaintext keys)
      const nostrService = this.getNostrService();
      const decryptedPrivkey = await nostrService.getDecryptedPrivateKeyWithPrompt(account);

      if (!decryptedPrivkey) {
        throw new Error('Failed to decrypt private key');
      }

      // Use nostr-tools nip44 v2 encryption
      const privateKeyBytes = hexToBytes(decryptedPrivkey);
      const conversationKey = v2.utils.getConversationKey(privateKeyBytes, recipientPubkey);

      return v2.encrypt(plaintext, conversationKey);
    } catch (error) {
      this.logger.error('Failed to encrypt with NIP-44', error);
      throw new Error('Encryption failed');
    }
  }
  /**
   * Decrypt a message using NIP-44 (modern, secure)
   */
  async decryptNip44(ciphertext: string, senderPubkey: string): Promise<string> {
    try {
      const account = this.accountState.account();

      // Check if we can use the browser extension
      if (account?.source === 'extension' && window.nostr?.nip44) {
        // Use the permission service to handle the decryption request
        return await this.encryptionPermission.queueDecryptionRequest('nip44', ciphertext, senderPubkey);
      }

      if (!account?.privkey) {
        throw new Error('Private key not available for decryption');
      }

      // Get decrypted private key (handles both encrypted and plaintext keys)
      const nostrService = this.getNostrService();
      const decryptedPrivkey = await nostrService.getDecryptedPrivateKeyWithPrompt(account);

      if (!decryptedPrivkey) {
        throw new Error('Failed to decrypt private key');
      }

      // Use nostr-tools nip44 v2 decryption
      const privateKeyBytes = hexToBytes(decryptedPrivkey);
      const conversationKey = v2.utils.getConversationKey(privateKeyBytes, senderPubkey);

      return v2.decrypt(ciphertext, conversationKey);
    } catch (error: any) {
      this.logger.error('Failed to decrypt with NIP-44', error);
      throw new Error('Decryption failed: ', error.message);
    }
  }

  /**
   * Encrypt a message using NIP-44 with a custom private key (for gift wrap)
   */
  async encryptNip44WithKey(
    plaintext: string,
    privateKeyHex: string,
    recipientPubkey: string
  ): Promise<string> {
    try {
      // Use nostr-tools nip44 v2 encryption with the provided private key
      const privateKeyBytes = hexToBytes(privateKeyHex);
      const conversationKey = v2.utils.getConversationKey(privateKeyBytes, recipientPubkey);

      return v2.encrypt(plaintext, conversationKey);
    } catch (error) {
      this.logger.error('Failed to encrypt with NIP-44 using custom key', error);
      throw new Error('Encryption failed');
    }
  }

  /**
   * Auto-detect encryption type and decrypt accordingly
   */
  async autoDecrypt(
    ciphertext: string,
    senderPubkey: string,
    event: Event
  ): Promise<DecryptionResult> {
    // First check if the content appears to be encrypted
    if (!this.isContentEncrypted(ciphertext)) {
      throw new Error('Content does not appear to be encrypted');
    }

    if (ciphertext.includes('?iv=')) {
      // Fallback to NIP-04 (legacy format with ?iv=)
      try {
        // TODO: Figure out what this "Echo: " prefix is about.
        // Sometimes the ciphertext might have a prefix like "Echo: ".
        ciphertext = ciphertext.replace('Echo: ', '');

        const content = await this.decryptNip04(ciphertext, senderPubkey);
        return { content, algorithm: 'nip04' };
      } catch (error) {
        this.logger.debug('NIP-04 decryption failed', error);
      }
    } else {
      // Try NIP-44 first (modern format)
      try {
        const content = await this.decryptNip44(ciphertext, senderPubkey);
        return { content, algorithm: 'nip44' };
      } catch (error) {
        this.logger.debug('NIP-44 decryption failed, trying NIP-04', error);
      }
    }
    throw new Error('Unable to decrypt message with any supported algorithm');
  }

  /**
   * Get preferred encryption algorithm for new messages
   * Always prefer NIP-44 for new messages, but support NIP-04 for compatibility
   */
  getPreferredEncryption(): 'nip44' | 'nip04' {
    return 'nip44'; // Always prefer the more secure option for new messages
  }

  /**
   * Check if account supports modern encryption
   */
  supportsModernEncryption(): boolean {
    const account = this.accountState.account();
    if (!account) return false;

    // Extension accounts depend on what the extension supports
    if (account.source === 'extension') {
      return !!window.nostr?.nip44;
    }

    // All other account types support modern encryption
    return true;
  }

  /**
   * Check if account supports legacy encryption
   */
  supportsLegacyEncryption(): boolean {
    const account = this.accountState.account();
    if (!account) return false;

    // Extension accounts depend on what the extension supports
    if (account.source === 'extension') {
      return !!window.nostr?.nip04;
    }

    // All other account types support legacy encryption
    return true;
  }

  /**
   * Check if content appears to be encrypted
   * This is a heuristic check to avoid attempting decryption on plain text
   */
  isContentEncrypted(content: string): boolean {
    if (!content || content.trim() === '') {
      return false;
    }

    // NIP-04 encrypted content contains '?iv=' parameter
    if (content.includes('?iv=')) {
      return true;
    }

    // NIP-44 encrypted content is base64-encoded and starts with specific prefixes
    // It should be a base64 string without spaces and with proper length
    const trimmedContent = content.trim();

    // Basic base64 pattern check (contains only valid base64 characters)
    const base64Pattern = /^[A-Za-z0-9+/]+=*$/;
    if (base64Pattern.test(trimmedContent)) {
      // NIP-44 encrypted content is typically longer than 32 characters
      // and has a specific structure when decoded
      if (trimmedContent.length > 32) {
        try {
          // Try to decode as base64 - if it fails, it's probably not encrypted
          atob(trimmedContent);
          return true;
        } catch {
          // If base64 decode fails, it's not encrypted with NIP-44
          return false;
        }
      }
    }

    // Check if it looks like JSON (likely plain text)
    try {
      JSON.parse(content);
      return false; // Successfully parsed as JSON, likely not encrypted
    } catch {
      // Not valid JSON, could be encrypted or just other plain text
    }

    // If content contains common plain text patterns, it's probably not encrypted
    if (content.includes('{') || content.includes('[') || content.includes('chats/')) {
      return false;
    }

    return false; // Default to not encrypted to avoid unnecessary decryption attempts
  }
}
