import { inject, Injectable, signal } from '@angular/core';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { getPublicKey } from 'nostr-tools';
import { AccountStateService } from './account-state.service';
import { NostrService } from './nostr.service';
import { LoggerService } from './logger.service';
import { Wallets } from './wallets';

/**
 * Budget renewal period for NWC connections
 */
export type BudgetRenewalPeriod = 'weekly';

/**
 * User credentials for Coinos API
 */
export interface CoinosUserCredentials {
  username: string;
  password: string;
}

/**
 * Register request payload
 */
export interface CoinosRegisterRequest {
  user: CoinosUserCredentials;
}

/**
 * Auth response from Coinos
 */
export interface CoinosAuthResponse {
  token: string;
}

/**
 * New wallet connection config for creating NWC connection
 */
export interface CoinosNewWalletConnectionConfig {
  name: string;
  secret: string;
  pubkey: string;
  max_amount: number;
  budget_renewal: BudgetRenewalPeriod;
}

/**
 * Wallet connection config response from Coinos
 */
export interface CoinosWalletConnectionConfig {
  name?: string;
  secret?: string;
  pubkey?: string;
  max_amount?: number;
  nwc?: string;
  budget_renewal?: BudgetRenewalPeriod;
}

/**
 * Error types for Coinos operations
 */
export type CoinosError =
  | 'unauthorized'
  | 'error_forming_request'
  | 'error_processing_response'
  | 'not_logged_in'
  | 'unexpected_http_response';

/**
 * Client error class for Coinos operations
 */
export class CoinosClientError extends Error {
  constructor(
    public readonly errorType: CoinosError,
    public readonly statusCode?: number,
    public readonly responseData?: string
  ) {
    super(`Coinos error: ${errorType}${statusCode ? ` (status: ${statusCode})` : ''}`);
    this.name = 'CoinosClientError';
  }
}

/**
 * Service for interacting with Coinos deterministic wallet
 * Implements one-click wallet setup using deterministic credentials derived from user's private key
 */
@Injectable({
  providedIn: 'root',
})
export class CoinosWalletService {
  private readonly accountState = inject(AccountStateService);
  private readonly nostrService = inject(NostrService);
  private readonly walletsService = inject(Wallets);
  private readonly logger = inject(LoggerService);

  private readonly COINOS_API_BASE = 'https://coinos.io/api';
  private readonly NWC_CONNECTION_NAME = 'Nostria';
  private readonly DEFAULT_MAX_AMOUNT = 30000; // 30K sats per week

  // JWT auth token for authenticated requests
  private jwtAuthToken: string | null = null;

  // Signals for UI state
  isActivating = signal(false);
  activationError = signal<string | null>(null);
  activationSuccess = signal(false);
  isCheckingStatus = signal(false);

  /**
   * Computes SHA256 hash of text and returns hex string
   */
  private sha256Hex(text: string): string {
    const data = new TextEncoder().encode(text);
    return bytesToHex(sha256(data));
  }

  /**
   * Derives a deterministic username from the user's private key
   * Uses only first 16 characters to keep it short but collision-resistant
   */
  private getDeterministicUsername(privkeyHex: string): string {
    const fullHash = this.sha256Hex('coinos_username:' + privkeyHex);
    // Use first 16 characters - sufficient for collision resistance
    return fullHash.substring(0, 16);
  }

  /**
   * Derives a deterministic password from the user's private key
   */
  private getDeterministicPassword(privkeyHex: string): string {
    return this.sha256Hex('coinos_password:' + privkeyHex);
  }

  /**
   * Derives a deterministic NWC private key from the user's private key
   * SHA256 is a one-way function, so the original private key cannot be derived from this
   */
  private getNwcPrivateKey(privkeyHex: string): Uint8Array {
    const privkeyBytes = hexToBytes(privkeyHex);
    return sha256(privkeyBytes);
  }

  /**
   * Gets the expected lud16 address for the user
   */
  getExpectedLud16(privkeyHex: string): string {
    const username = this.getDeterministicUsername(privkeyHex);
    return `${username}@coinos.io`;
  }

  /**
   * Registers for a Coinos account using deterministic credentials
   */
  private async register(privkeyHex: string): Promise<void> {
    const username = this.getDeterministicUsername(privkeyHex);
    const password = this.getDeterministicPassword(privkeyHex);

    const registerPayload: CoinosRegisterRequest = {
      user: { username, password },
    };

    const response = await fetch(`${this.COINOS_API_BASE}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(registerPayload),
    });

    if (response.status === 200) {
      this.logger.info('Coinos account registered successfully');
      return;
    }

    const responseText = await response.text();
    throw new CoinosClientError('unexpected_http_response', response.status, responseText);
  }

  /**
   * Logs into the Coinos account and stores the JWT token
   */
  private async login(privkeyHex: string): Promise<void> {
    const authResponse = await this.sendLoginRequest(privkeyHex);
    this.jwtAuthToken = authResponse.token;
    this.logger.debug('Logged into Coinos successfully');
  }

  /**
   * Sends the login request and returns the response
   */
  private async sendLoginRequest(privkeyHex: string): Promise<CoinosAuthResponse> {
    const username = this.getDeterministicUsername(privkeyHex);
    const password = this.getDeterministicPassword(privkeyHex);

    const response = await fetch(`${this.COINOS_API_BASE}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    if (response.status === 200) {
      return await response.json();
    }

    if (response.status === 401) {
      throw new CoinosClientError('unauthorized');
    }

    const responseText = await response.text();
    throw new CoinosClientError('unexpected_http_response', response.status, responseText);
  }

  /**
   * Tries to login, and if the account doesn't exist, registers first
   */
  private async loginOrRegister(privkeyHex: string): Promise<void> {
    try {
      await this.login(privkeyHex);
    } catch (error) {
      if (error instanceof CoinosClientError && error.errorType === 'unauthorized') {
        // Account doesn't exist, create one
        await this.register(privkeyHex);
        await this.login(privkeyHex);
      } else {
        throw error;
      }
    }
  }

  /**
   * Logs in if needed (JWT token not present)
   */
  private async loginIfNeeded(privkeyHex: string): Promise<void> {
    if (!this.jwtAuthToken) {
      await this.login(privkeyHex);
    }
  }

  /**
   * Makes an authenticated request with JWT token
   */
  private async makeAuthenticatedRequest(
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown
  ): Promise<Response> {
    if (!this.jwtAuthToken) {
      throw new CoinosClientError('not_logged_in');
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.jwtAuthToken}`,
    };

    if (payload) {
      headers['Content-Type'] = 'application/json';
    }

    return await fetch(url, {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
    });
  }

  /**
   * Creates the default wallet connection config
   */
  private getDefaultWalletConnectionConfig(privkeyHex: string): CoinosNewWalletConnectionConfig {
    const nwcPrivkey = this.getNwcPrivateKey(privkeyHex);
    const nwcPubkey = getPublicKey(nwcPrivkey);

    return {
      name: this.NWC_CONNECTION_NAME,
      secret: bytesToHex(nwcPrivkey),
      pubkey: nwcPubkey,
      max_amount: this.DEFAULT_MAX_AMOUNT,
      budget_renewal: 'weekly',
    };
  }

  /**
   * Gets the NWC app connection config from Coinos
   */
  private async getNWCAppConnectionConfig(privkeyHex: string): Promise<CoinosWalletConnectionConfig | null> {
    const nwcPrivkey = this.getNwcPrivateKey(privkeyHex);
    const nwcPubkey = getPublicKey(nwcPrivkey);

    await this.loginIfNeeded(privkeyHex);

    const response = await this.makeAuthenticatedRequest(
      'GET',
      `${this.COINOS_API_BASE}/app/${nwcPubkey}`
    );

    if (response.status === 200) {
      return await response.json();
    }

    if (response.status === 404) {
      return null;
    }

    if (response.status === 401) {
      throw new CoinosClientError('unauthorized');
    }

    const responseText = await response.text();
    throw new CoinosClientError('unexpected_http_response', response.status, responseText);
  }

  /**
   * Creates a new NWC connection with Coinos
   */
  private async createNWCConnection(privkeyHex: string): Promise<string> {
    await this.loginIfNeeded(privkeyHex);

    const config = this.getDefaultWalletConnectionConfig(privkeyHex);

    const response = await this.makeAuthenticatedRequest(
      'POST',
      `${this.COINOS_API_BASE}/app`,
      config
    );

    if (response.status === 200) {
      // Get the NWC URL from the connection config
      const nwcUrl = await this.getNWCUrl(privkeyHex);
      if (!nwcUrl) {
        throw new CoinosClientError('error_processing_response');
      }
      return nwcUrl;
    }

    if (response.status === 401) {
      throw new CoinosClientError('unauthorized');
    }

    const responseText = await response.text();
    throw new CoinosClientError('unexpected_http_response', response.status, responseText);
  }

  /**
   * Gets the NWC URL for the deterministic connection
   */
  private async getNWCUrl(privkeyHex: string): Promise<string | null> {
    const connectionConfig = await this.getNWCAppConnectionConfig(privkeyHex);
    return connectionConfig?.nwc || null;
  }

  /**
   * Main method: Activates the Coinos wallet for the current user
   * This creates a deterministic account and NWC connection with one click
   */
  async activateWallet(): Promise<string | null> {
    this.isActivating.set(true);
    this.activationError.set(null);
    this.activationSuccess.set(false);

    try {
      // Get the current account
      const account = this.accountState.account();
      if (!account || !account.privkey) {
        throw new Error('No private key available. Please log in with an account that has a private key.');
      }

      // Get the decrypted private key
      const privkeyHex = await this.nostrService.getDecryptedPrivateKeyWithPrompt(account);
      if (!privkeyHex) {
        throw new Error('Could not decrypt private key. PIN may be incorrect.');
      }

      // Login or register to Coinos
      await this.loginOrRegister(privkeyHex);

      // Check if NWC connection already exists
      let nwcUrl = await this.getNWCUrl(privkeyHex);

      if (!nwcUrl) {
        // Create new NWC connection
        nwcUrl = await this.createNWCConnection(privkeyHex);
      }

      if (!nwcUrl) {
        throw new Error('Failed to get NWC connection URL');
      }

      // Add the wallet to the wallets service
      const parsed = this.walletsService.parseConnectionString(nwcUrl);
      this.walletsService.addWallet(parsed.pubkey, nwcUrl, {
        relay: parsed.relay,
        secret: parsed.secret,
      });

      // Update wallet name to indicate it's from Coinos
      this.walletsService.updateWalletName(parsed.pubkey, 'Coinos Wallet');

      this.activationSuccess.set(true);
      this.logger.info('Coinos wallet activated successfully');

      return nwcUrl;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to activate wallet';
      this.activationError.set(errorMessage);
      this.logger.error('Failed to activate Coinos wallet', error);
      return null;
    } finally {
      this.isActivating.set(false);
      // Clear JWT token after operation
      this.jwtAuthToken = null;
    }
  }

  /**
   * Checks if a Coinos wallet is already connected
   */
  hasCoinosWallet(): boolean {
    const wallets = this.walletsService.wallets();
    return Object.values(wallets).some(wallet => wallet.name === 'Coinos Wallet');
  }

  /**
   * Checks if the current account can use Coinos (has a private key)
   */
  canUseCoinosWallet(): boolean {
    const account = this.accountState.account();
    return !!(account?.privkey && account.source === 'nsec');
  }
}
