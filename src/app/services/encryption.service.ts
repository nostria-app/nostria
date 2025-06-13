import { Injectable, inject } from '@angular/core';
import { LoggerService } from './logger.service';
import { AccountStateService } from './account-state.service';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { Event, nip04, nip44 } from 'nostr-tools';
import { v2 } from 'nostr-tools/nip44';
import { UtilitiesService } from './utilities.service';

export interface EncryptionResult {
  content: string;
  algorithm: 'nip04' | 'nip44';
}

export interface DecryptionResult {
  content: string;
  algorithm: 'nip04' | 'nip44';
}

@Injectable({
  providedIn: 'root'
})
export class EncryptionService {
  private logger = inject(LoggerService);
  private readonly utilities = inject(UtilitiesService);
  private accountState = inject(AccountStateService);  /**
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

      // Use nostr-tools nip04 encryption
      const privateKeyBytes = hexToBytes(account.privkey);
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
        const decrypted = await window.nostr.nip04.decrypt(pubkey, ciphertext)
        return decrypted;
      }

      if (!account?.privkey) {
        throw new Error('Private key not available for decryption');
      }

      // Use nostr-tools nip04 decryption
      const privateKeyBytes = hexToBytes(account.privkey);
      return await nip04.decrypt(privateKeyBytes, pubkey, ciphertext);
    } catch (error) {
      this.logger.error('Failed to decrypt with NIP-04', error);
      throw new Error('Decryption failed');
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

      // Use nostr-tools nip44 v2 encryption
      const privateKeyBytes = hexToBytes(account.privkey);
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
        return await window.nostr.nip44.decrypt(senderPubkey, ciphertext);
      }

      if (!account?.privkey) {
        throw new Error('Private key not available for decryption');
      }

      // Use nostr-tools nip44 v2 decryption
      const privateKeyBytes = hexToBytes(account.privkey);
      const conversationKey = v2.utils.getConversationKey(privateKeyBytes, senderPubkey);

      return v2.decrypt(ciphertext, conversationKey);
    } catch (error) {
      this.logger.error('Failed to decrypt with NIP-44', error);
      throw new Error('Decryption failed');
    }
  }

  /**
   * Auto-detect encryption type and decrypt accordingly
   */
  async autoDecrypt(ciphertext: string, senderPubkey: string, event: Event): Promise<DecryptionResult> {
    if (ciphertext.includes('?iv=')) {
      // Fallback to NIP-04 (legacy format with ?iv=)
      try {
        // TODO: Figure out what this "Echo: " prefix is about.
        // Sometimes the ciphertext might have a prefix like "Echo: ".
        ciphertext = ciphertext.replace('Echo: ', '');

        // const pTags = this.utilities.getPTagsValuesFromEvent(event);
        // if (pTags && pTags.length > 0) {
        //   // If we have p-tags, use the first one as the sender's public key
        //   const receiverPubkey = pTags[0];
        //   if (receiverPubkey === "fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52") {
        //     debugger;
        //   }
        // }

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
}
