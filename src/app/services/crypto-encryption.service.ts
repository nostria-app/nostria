import { Injectable, inject } from '@angular/core';
import { LoggerService } from './logger.service';

/**
 * Encrypted data structure that stores the ciphertext and metadata
 */
export interface EncryptedData {
  /** Base64-encoded ciphertext */
  ciphertext: string;
  /** Base64-encoded initialization vector */
  iv: string;
  /** Base64-encoded salt used for key derivation */
  salt: string;
  /** Version of the encryption format for future compatibility */
  version: number;
}

/**
 * Service for encrypting and decrypting private keys using Web Crypto API
 * 
 * Uses PBKDF2 for key derivation from PIN and AES-GCM for encryption.
 * This provides at-rest encryption for private keys stored in localStorage.
 * 
 * Default PIN: "0000" - provides basic protection against casual access
 * Users can set custom PINs for stronger protection
 */
@Injectable({
  providedIn: 'root',
})
export class CryptoEncryptionService {
  private readonly logger = inject(LoggerService);

  /** Default PIN used for initial encryption of private keys */
  readonly DEFAULT_PIN = '0000';

  /** Number of PBKDF2 iterations - balances security with performance */
  private readonly PBKDF2_ITERATIONS = 100000;

  /** Current version of encryption format */
  private readonly ENCRYPTION_VERSION = 1;

  /**
   * Derives an AES-GCM encryption key from a PIN using PBKDF2
   * 
   * @param pin The PIN to derive the key from
   * @param salt The salt for key derivation (should be unique per encrypted value)
   * @returns CryptoKey suitable for AES-GCM encryption/decryption
   */
  private async deriveKey(pin: string, salt: Uint8Array): Promise<CryptoKey> {
    // Convert PIN to bytes
    const encoder = new TextEncoder();
    const pinBytes = encoder.encode(pin);

    // Import the PIN as a key for PBKDF2
    const baseKey = await crypto.subtle.importKey(
      'raw',
      pinBytes,
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    // Derive the encryption key using PBKDF2
    const derivedKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as BufferSource,
        iterations: this.PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    return derivedKey;
  }

  /**
   * Encrypts a private key using the specified PIN
   * 
   * @param privkey The private key in hex format
   * @param pin The PIN to encrypt with (defaults to DEFAULT_PIN)
   * @returns Encrypted data structure containing ciphertext and metadata
   */
  async encryptPrivateKey(privkey: string, pin: string = this.DEFAULT_PIN): Promise<EncryptedData> {
    try {
      this.logger.debug('Encrypting private key');

      // Generate random salt and IV
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));

      // Derive encryption key from PIN
      const key = await this.deriveKey(pin, salt);

      // Encrypt the private key
      const encoder = new TextEncoder();
      const privkeyBytes = encoder.encode(privkey);

      const ciphertext = await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        key,
        privkeyBytes
      );

      // Convert to base64 for storage
      const encryptedData: EncryptedData = {
        ciphertext: this.arrayBufferToBase64(ciphertext),
        iv: this.arrayBufferToBase64(iv.buffer),
        salt: this.arrayBufferToBase64(salt.buffer),
        version: this.ENCRYPTION_VERSION,
      };

      this.logger.debug('Private key encrypted successfully');
      return encryptedData;
    } catch (error) {
      this.logger.error('Failed to encrypt private key', error);
      throw new Error('Failed to encrypt private key');
    }
  }

  /**
   * Decrypts an encrypted private key using the specified PIN
   * 
   * @param encryptedData The encrypted data structure
   * @param pin The PIN to decrypt with
   * @returns The decrypted private key in hex format
   * @throws Error if decryption fails (wrong PIN or corrupted data)
   */
  async decryptPrivateKey(encryptedData: EncryptedData, pin: string): Promise<string> {
    try {
      this.logger.debug('Decrypting private key');

      // Convert from base64
      const ciphertext = this.base64ToArrayBuffer(encryptedData.ciphertext);
      const iv = this.base64ToArrayBuffer(encryptedData.iv);
      const salt = this.base64ToArrayBuffer(encryptedData.salt);

      // Derive decryption key from PIN
      const key = await this.deriveKey(pin, new Uint8Array(salt));

      // Decrypt the private key
      const decryptedBytes = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(iv),
        },
        key,
        ciphertext
      );

      // Convert back to string
      const decoder = new TextDecoder();
      const privkey = decoder.decode(decryptedBytes);

      this.logger.debug('Private key decrypted successfully');
      return privkey;
    } catch (error) {
      this.logger.error('Failed to decrypt private key', error);
      throw new Error('Failed to decrypt private key. Incorrect PIN or corrupted data.');
    }
  }

  /**
   * Re-encrypts a private key with a new PIN
   * 
   * @param encryptedData The currently encrypted data
   * @param oldPin The current PIN
   * @param newPin The new PIN to use
   * @returns New encrypted data structure with the new PIN
   * @throws Error if old PIN is incorrect
   */
  async reencryptPrivateKey(
    encryptedData: EncryptedData,
    oldPin: string,
    newPin: string
  ): Promise<EncryptedData> {
    try {
      this.logger.debug('Re-encrypting private key with new PIN');

      // Decrypt with old PIN
      const privkey = await this.decryptPrivateKey(encryptedData, oldPin);

      // Encrypt with new PIN
      const newEncryptedData = await this.encryptPrivateKey(privkey, newPin);

      this.logger.debug('Private key re-encrypted successfully');
      return newEncryptedData;
    } catch (error) {
      this.logger.error('Failed to re-encrypt private key', error);
      throw error;
    }
  }

  /**
   * Checks if a string is encrypted data (vs plaintext private key)
   * 
   * @param value The value to check
   * @returns true if the value appears to be encrypted data
   */
  isEncrypted(value: string | EncryptedData): boolean {
    if (typeof value === 'string') {
      // Check if it's a JSON object with expected encrypted data structure
      try {
        const parsed = JSON.parse(value);
        return (
          parsed &&
          typeof parsed === 'object' &&
          'ciphertext' in parsed &&
          'iv' in parsed &&
          'salt' in parsed &&
          'version' in parsed
        );
      } catch {
        return false;
      }
    }

    // Already an object, check structure
    return (
      value &&
      typeof value === 'object' &&
      'ciphertext' in value &&
      'iv' in value &&
      'salt' in value &&
      'version' in value
    );
  }

  /**
   * Converts ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Converts base64 string to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Verifies if a PIN can decrypt the given encrypted data
   * 
   * @param encryptedData The encrypted data to test
   * @param pin The PIN to verify
   * @returns true if the PIN is correct, false otherwise
   */
  async verifyPin(encryptedData: EncryptedData, pin: string): Promise<boolean> {
    try {
      await this.decryptPrivateKey(encryptedData, pin);
      return true;
    } catch {
      return false;
    }
  }
}
