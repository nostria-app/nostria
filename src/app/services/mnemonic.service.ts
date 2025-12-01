import { Injectable, inject } from '@angular/core';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import { bytesToHex } from '@noble/hashes/utils.js';
import { LoggerService } from './logger.service';
import { CryptoEncryptionService, EncryptedData } from './crypto-encryption.service';

/**
 * Service for managing BIP39 mnemonic phrases according to NIP-06
 * 
 * NIP-06 specifies:
 * - BIP39 is used to generate mnemonic seed words and derive a binary seed
 * - BIP32 is used to derive the path m/44'/1237'/<account>'/0/0
 * - Basic clients use account 0 to derive a single key
 * 
 * @see https://github.com/nostr-protocol/nips/blob/master/06.md
 */
@Injectable({
  providedIn: 'root',
})
export class MnemonicService {
  private readonly logger = inject(LoggerService);
  private readonly crypto = inject(CryptoEncryptionService);

  /** Nostr coin type according to SLIP44 */
  private readonly NOSTR_COIN_TYPE = 1237;

  /** Default account index for basic usage */
  private readonly DEFAULT_ACCOUNT_INDEX = 0;

  /**
   * Generates a new 12-word BIP39 mnemonic phrase
   * 
   * @returns A 12-word mnemonic phrase
   */
  generateMnemonic(): string {
    this.logger.debug('Generating new 12-word mnemonic');
    // 128 bits = 12 words, 256 bits = 24 words
    // Using 12 words as it's more user-friendly while still secure
    const mnemonic = generateMnemonic(wordlist, 128);
    this.logger.debug('Mnemonic generated successfully');
    return mnemonic;
  }

  /**
   * Validates a mnemonic phrase
   * 
   * @param mnemonic The mnemonic phrase to validate
   * @returns true if valid, false otherwise
   */
  validateMnemonic(mnemonic: string): boolean {
    try {
      return validateMnemonic(mnemonic, wordlist);
    } catch (error) {
      this.logger.error('Error validating mnemonic', error);
      return false;
    }
  }

  /**
   * Derives a private key from a mnemonic phrase according to NIP-06
   * 
   * Uses the path: m/44'/1237'/<account>'/0/0
   * 
   * @param mnemonic The BIP39 mnemonic phrase
   * @param accountIndex The account index (default: 0)
   * @returns The derived private key in hex format
   */
  derivePrivateKeyFromMnemonic(mnemonic: string, accountIndex: number = this.DEFAULT_ACCOUNT_INDEX): string {
    this.logger.debug('Deriving private key from mnemonic', { accountIndex });

    // Validate the mnemonic
    if (!this.validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase');
    }

    // Convert mnemonic to seed
    const seed = mnemonicToSeedSync(mnemonic);

    // Derive the key using BIP32 path: m/44'/1237'/<account>'/0/0
    const path = `m/44'/${this.NOSTR_COIN_TYPE}'/${accountIndex}'/0/0`;
    this.logger.debug('Using BIP32 derivation path', { path });

    const hdKey = HDKey.fromMasterSeed(seed);
    const derivedKey = hdKey.derive(path);

    if (!derivedKey.privateKey) {
      throw new Error('Failed to derive private key from mnemonic');
    }

    const privkey = bytesToHex(derivedKey.privateKey);
    this.logger.debug('Private key derived successfully from mnemonic');

    return privkey;
  }

  /**
   * Encrypts a mnemonic phrase with a PIN
   * 
   * @param mnemonic The mnemonic phrase to encrypt
   * @param pin The PIN to encrypt with (defaults to DEFAULT_PIN)
   * @returns Encrypted data structure
   */
  async encryptMnemonic(mnemonic: string, pin: string = this.crypto.DEFAULT_PIN): Promise<EncryptedData> {
    this.logger.debug('Encrypting mnemonic');
    
    // We can reuse the crypto service's encryption method since it just encrypts strings
    return await this.crypto.encryptPrivateKey(mnemonic, pin);
  }

  /**
   * Decrypts an encrypted mnemonic phrase
   * 
   * @param encryptedData The encrypted mnemonic data
   * @param pin The PIN to decrypt with
   * @returns The decrypted mnemonic phrase
   */
  async decryptMnemonic(encryptedData: EncryptedData, pin: string): Promise<string> {
    this.logger.debug('Decrypting mnemonic');
    
    // We can reuse the crypto service's decryption method
    return await this.crypto.decryptPrivateKey(encryptedData, pin);
  }

  /**
   * Detects if a string is a mnemonic phrase
   * 
   * @param input The string to check
   * @returns true if it appears to be a mnemonic phrase
   */
  isMnemonic(input: string): boolean {
    const trimmed = input.trim();
    
    // Check if it contains spaces (mnemonics are space-separated words)
    if (!trimmed.includes(' ')) {
      return false;
    }

    // Count words
    const words = trimmed.split(/\s+/);
    
    // Valid mnemonic lengths are 12, 15, 18, 21, or 24 words
    const validLengths = [12, 15, 18, 21, 24];
    if (!validLengths.includes(words.length)) {
      return false;
    }

    // Validate against BIP39 wordlist
    return this.validateMnemonic(trimmed);
  }

  /**
   * Normalizes a mnemonic phrase (trims and lowercases)
   * 
   * @param mnemonic The mnemonic to normalize
   * @returns Normalized mnemonic
   */
  normalizeMnemonic(mnemonic: string): string {
    return mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
  }
}
