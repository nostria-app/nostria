import { Injectable, inject } from '@angular/core';
import { getPublicKey } from 'nostr-tools';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { UtilitiesService } from './utilities.service';

/**
 * User credentials for Coinos registration and login
 */
interface UserCredentials {
  username: string;
  password: string;
}

/**
 * Response from Coinos login endpoint
 */
interface AuthResponse {
  token: string;
}

/**
 * Configuration for creating a new NWC connection
 */
interface NewWalletConnectionConfig {
  name: string;
  secret: string;
  pubkey: string;
  max_amount: number;
  budget_renewal: 'weekly';
}

/**
 * Configuration details for an existing NWC connection
 */
interface WalletConnectionConfig {
  name?: string;
  secret?: string;
  pubkey?: string;
  max_amount?: number;
  nwc?: string;
  budget_renewal?: 'weekly';
}

/**
 * Service for managing deterministic Coinos wallet accounts
 * 
 * This implements a client that can create and manage Coinos accounts
 * derived deterministically from the user's Nostr private key.
 * 
 * Inspired by the Damus implementation for automatic "one-click setup" Coinos wallet.
 * https://github.com/damus-io/damus/blob/02296d77524020b44b751ec1426af4d155d55334/damus/Features/Wallet/Models/CoinosDeterministicAccountClient.swift
 * 
 * This is not a copy of their code. Damus is copyleft licensed (GNU General Public License v3.0).
 */
@Injectable({
  providedIn: 'root',
})
export class CoinosService {
  private readonly utilities = inject(UtilitiesService);

  private jwtAuthToken: string | null = null;

  private readonly COINOS_API_BASE = 'https://coinos.io/api';
  private readonly NWC_CONNECTION_NAME = 'Nostria';
  private readonly DEFAULT_MAX_AMOUNT = 50000; // 50K sats per week

  /**
   * Computes SHA256 hash of text and returns hex string
   */
  private sha256Hex(text: string): string {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    return bytesToHex(sha256(data));
  }

  /**
   * Derives a deterministic NWC keypair from the user's private key
   * Uses SHA256 to create an irreversible derivation
   */
  private deriveNwcKeypair(userPrivkey: string): { privkey: Uint8Array; pubkey: string } {
    const hash = this.sha256Hex(userPrivkey);
    const privkeyBytes = new Uint8Array(
      hash.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
    );
    const pubkey = getPublicKey(privkeyBytes);
    return { privkey: privkeyBytes, pubkey };
  }

  /**
   * Derives a deterministic username for the Coinos account
   * Takes first 16 characters of SHA256 hash to avoid collision risks
   */
  private deriveUsername(userPrivkey: string): string {
    const fullText = this.sha256Hex('coinos_username:' + userPrivkey);
    // Use first 16 characters for username
    return fullText.substring(0, 16);
  }

  /**
   * Derives a deterministic password for the Coinos account
   */
  private derivePassword(userPrivkey: string): string {
    return this.sha256Hex('coinos_password:' + userPrivkey);
  }

  /**
   * Gets the expected Lightning Address (lud16) for this user
   */
  getExpectedLud16(userPrivkey: string): string {
    const username = this.deriveUsername(userPrivkey);
    return `${username}@coinos.io`;
  }

  /**
   * Makes an HTTP request to the Coinos API
   */
  private async makeRequest(
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
    authenticated = false
  ): Promise<{ data: unknown; status: number }> {
    const headers: Record<string, string> = {};

    if (authenticated) {
      if (!this.jwtAuthToken) {
        throw new Error('Not logged in');
      }
      headers['Authorization'] = `Bearer ${this.jwtAuthToken}`;
    }

    if (payload) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      method,
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
    });

    let data: unknown;
    try {
      const text = await response.text();
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    return { data, status: response.status };
  }

  /**
   * Registers a new Coinos account with deterministic credentials
   */
  async register(userPrivkey: string): Promise<void> {
    const username = this.deriveUsername(userPrivkey);
    const password = this.derivePassword(userPrivkey);

    const url = `${this.COINOS_API_BASE}/register`;
    const payload = {
      user: { username, password } as UserCredentials,
    };

    const { status } = await this.makeRequest('POST', url, payload);

    if (status !== 200) {
      throw new Error(`Registration failed with status ${status}`);
    }
  }

  /**
   * Logs into the deterministic Coinos account
   */
  async login(userPrivkey: string): Promise<void> {
    const username = this.deriveUsername(userPrivkey);
    const password = this.derivePassword(userPrivkey);

    const url = `${this.COINOS_API_BASE}/login`;
    const payload: UserCredentials = { username, password };

    const { status, data } = await this.makeRequest('POST', url, payload);

    if (status === 401) {
      throw new Error('Unauthorized');
    }

    if (status !== 200) {
      throw new Error(`Login failed with status ${status}`);
    }

    this.jwtAuthToken = (data as AuthResponse).token;
  }

  /**
   * Logs in if not already authenticated
   */
  private async loginIfNeeded(userPrivkey: string): Promise<void> {
    if (!this.jwtAuthToken) {
      await this.login(userPrivkey);
    }
  }

  /**
   * Attempts to login, and if unauthorized, registers a new account and logs in
   */
  async loginOrRegister(userPrivkey: string): Promise<void> {
    try {
      await this.login(userPrivkey);
    } catch (error) {
      if (error instanceof Error && error.message === 'Unauthorized') {
        // Account doesn't exist, create one
        await this.register(userPrivkey);
        await this.login(userPrivkey);
      } else {
        throw error;
      }
    }
  }

  /**
   * Creates a default wallet connection configuration
   */
  private defaultWalletConnectionConfig(
    userPrivkey: string
  ): NewWalletConnectionConfig {
    const nwcKeypair = this.deriveNwcKeypair(userPrivkey);
    return {
      name: this.NWC_CONNECTION_NAME,
      secret: Array.from(nwcKeypair.privkey)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(''),
      pubkey: nwcKeypair.pubkey,
      max_amount: this.DEFAULT_MAX_AMOUNT,
      budget_renewal: 'weekly',
    };
  }

  /**
   * Gets the NWC connection configuration if it exists
   * Returns null if no connection has been configured yet
   */
  async getNWCAppConnectionConfig(
    userPrivkey: string
  ): Promise<WalletConnectionConfig | null> {
    await this.loginIfNeeded(userPrivkey);

    const nwcKeypair = this.deriveNwcKeypair(userPrivkey);
    const url = `${this.COINOS_API_BASE}/app/${nwcKeypair.pubkey}`;

    const { status, data } = await this.makeRequest('GET', url, undefined, true);

    if (status === 404) {
      return null;
    }

    if (status === 401) {
      throw new Error('Unauthorized');
    }

    if (status !== 200) {
      throw new Error(`Failed to get NWC config with status ${status}`);
    }

    return data as WalletConnectionConfig;
  }

  /**
   * Gets the NWC URL for the deterministic connection
   * Returns null if no connection exists yet
   */
  async getNWCUrl(userPrivkey: string): Promise<string | null> {
    const config = await this.getNWCAppConnectionConfig(userPrivkey);
    return config?.nwc || null;
  }

  /**
   * Creates a new NWC connection for the deterministic wallet
   * Returns the Nostr Wallet Connect URL
   */
  async createNWCConnection(userPrivkey: string): Promise<string> {
    await this.loginIfNeeded(userPrivkey);

    const config = this.defaultWalletConnectionConfig(userPrivkey);
    const url = `${this.COINOS_API_BASE}/app`;

    const { status } = await this.makeRequest('POST', url, config, true);

    if (status === 401) {
      throw new Error('Unauthorized');
    }

    if (status !== 200) {
      throw new Error(`Failed to create NWC connection with status ${status}`);
    }

    // After creating, fetch the NWC URL
    const nwcUrl = await this.getNWCUrl(userPrivkey);
    if (!nwcUrl) {
      throw new Error('Failed to retrieve NWC URL after creation');
    }

    return nwcUrl;
  }

  /**
   * Updates an existing NWC connection with a new max amount budget
   * Returns the updated Nostr Wallet Connect URL
   */
  async updateNWCConnection(userPrivkey: string, maxAmount: number): Promise<string> {
    await this.loginIfNeeded(userPrivkey);

    // Get existing config first
    const existingConfig = await this.getNWCAppConnectionConfig(userPrivkey);
    if (!existingConfig) {
      throw new Error('No existing NWC connection to update');
    }

    const nwcKeypair = this.deriveNwcKeypair(userPrivkey);
    const updatedConfig: NewWalletConnectionConfig = {
      name: existingConfig.name || this.NWC_CONNECTION_NAME,
      secret: existingConfig.secret || Array.from(nwcKeypair.privkey)
        .map(b => b.toString(16).padStart(2, '0'))
        .join(''),
      pubkey: existingConfig.pubkey || nwcKeypair.pubkey,
      max_amount: maxAmount,
      budget_renewal: 'weekly',
    };

    const url = `${this.COINOS_API_BASE}/app`;
    const { status } = await this.makeRequest('POST', url, updatedConfig, true);

    if (status === 401) {
      throw new Error('Unauthorized');
    }

    if (status !== 200) {
      throw new Error(`Failed to update NWC connection with status ${status}`);
    }

    const nwcUrl = await this.getNWCUrl(userPrivkey);
    if (!nwcUrl) {
      throw new Error('Failed to retrieve NWC URL after update');
    }

    return nwcUrl;
  }

  /**
   * Sets up or retrieves the deterministic Coinos wallet
   * This is the main entry point for one-click setup
   * 
   * @returns The Nostr Wallet Connect connection string
   */
  async setupDeterministicWallet(userPrivkey: string): Promise<string> {
    // Login or register
    await this.loginOrRegister(userPrivkey);

    // Check if NWC connection already exists
    let nwcUrl = await this.getNWCUrl(userPrivkey);

    // If not, create it
    if (!nwcUrl) {
      nwcUrl = await this.createNWCConnection(userPrivkey);
    }

    return nwcUrl;
  }

  /**
   * Clears the authentication token (logout)
   */
  logout(): void {
    this.jwtAuthToken = null;
  }
}
