import { inject, Injectable, signal, computed } from '@angular/core';
import { NWCClient } from '@getalby/sdk';
import { LoggerService } from './logger.service';
import { Wallets, Wallet } from './wallets';

/**
 * NIP-47 Transaction type
 */
export interface NwcTransaction {
  type: 'incoming' | 'outgoing';
  state?: 'pending' | 'settled' | 'expired' | 'failed';
  invoice?: string;
  description?: string;
  description_hash?: string;
  preimage?: string;
  payment_hash: string;
  amount: number; // value in msats
  fees_paid?: number; // value in msats
  created_at: number; // unix timestamp
  expires_at?: number; // unix timestamp
  settled_at?: number; // unix timestamp
  metadata?: Record<string, unknown>;
}

/**
 * NIP-47 Balance response
 */
export interface NwcBalance {
  balance: number; // user's balance in msats
}

/**
 * NIP-47 Wallet info response
 */
export interface NwcWalletInfo {
  alias?: string;
  color?: string;
  pubkey?: string;
  network?: string;
  block_height?: number;
  block_hash?: string;
  methods?: string[];
  notifications?: string[];
}

/**
 * Cached wallet data
 */
export interface WalletData {
  balance: NwcBalance | null;
  transactions: NwcTransaction[];
  info: NwcWalletInfo | null;
  lastUpdated: number;
  loading: boolean;
  error: string | null;
}

/**
 * NWC Service - Implements NIP-47 Nostr Wallet Connect
 * Provides balance checking and transaction history
 */
@Injectable({
  providedIn: 'root',
})
export class NwcService {
  private logger = inject(LoggerService);
  private walletsService = inject(Wallets);

  // Cache wallet data per pubkey
  private walletDataCache = signal<Record<string, WalletData>>({});

  // Cache NWC clients to avoid reconnecting
  private nwcClients = new Map<string, NWCClient>();

  // Currently selected wallet pubkey for operations
  selectedWalletPubkey = signal<string | null>(null);

  // Computed: get data for currently selected wallet
  selectedWalletData = computed(() => {
    const pubkey = this.selectedWalletPubkey();
    if (!pubkey) return null;
    return this.walletDataCache()[pubkey] || null;
  });

  /**
   * Get or create NWC client for a wallet
   */
  private async getNwcClient(wallet: Wallet): Promise<NWCClient | null> {
    if (!wallet.connections || wallet.connections.length === 0) {
      return null;
    }

    const connectionString = wallet.connections[0];

    // Check cache
    if (this.nwcClients.has(connectionString)) {
      return this.nwcClients.get(connectionString)!;
    }

    try {
      // Create new NWC client
      const client = new NWCClient({
        nostrWalletConnectUrl: connectionString,
      });

      this.nwcClients.set(connectionString, client);
      return client;
    } catch (error) {
      this.logger.error('Failed to create NWC client:', error);
      return null;
    }
  }

  /**
   * Get balance for a specific wallet
   * NIP-47: get_balance method
   */
  async getBalance(walletPubkey: string): Promise<NwcBalance | null> {
    const wallets = this.walletsService.wallets();
    const wallet = wallets[walletPubkey];

    if (!wallet) {
      this.logger.error('Wallet not found:', walletPubkey);
      return null;
    }

    // Update loading state
    this.updateWalletData(walletPubkey, { loading: true, error: null });

    try {
      const client = await this.getNwcClient(wallet);
      if (!client) {
        throw new Error('No connection available for wallet');
      }

      // NIP-47 get_balance method
      const result = await client.getBalance();

      const balance: NwcBalance = {
        balance: typeof result === 'number' ? result : (result as { balance: number }).balance || 0,
      };

      this.updateWalletData(walletPubkey, {
        balance,
        loading: false,
        lastUpdated: Date.now(),
      });

      return balance;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get balance';
      this.logger.error('Failed to get wallet balance:', error);
      this.updateWalletData(walletPubkey, { loading: false, error: errorMessage });
      return null;
    }
  }

  /**
   * Get transaction history for a specific wallet
   * NIP-47: list_transactions method
   */
  async getTransactions(
    walletPubkey: string,
    options: {
      from?: number;
      until?: number;
      limit?: number;
      offset?: number;
      unpaid?: boolean;
      type?: 'incoming' | 'outgoing';
    } = {}
  ): Promise<NwcTransaction[]> {
    const wallets = this.walletsService.wallets();
    const wallet = wallets[walletPubkey];

    if (!wallet) {
      this.logger.error('Wallet not found:', walletPubkey);
      return [];
    }

    // Update loading state
    this.updateWalletData(walletPubkey, { loading: true, error: null });

    try {
      const client = await this.getNwcClient(wallet);
      if (!client) {
        throw new Error('No connection available for wallet');
      }

      // NIP-47 list_transactions method
      const result = await client.listTransactions({
        from: options.from,
        until: options.until,
        limit: options.limit || 50,
        offset: options.offset,
        unpaid: options.unpaid,
        type: options.type,
      });

      // Normalize the response to our interface
      let transactions: NwcTransaction[] = [];

      if (Array.isArray(result)) {
        transactions = result.map(this.normalizeTransaction);
      } else if (result && typeof result === 'object' && 'transactions' in result) {
        transactions = ((result as { transactions: unknown[] }).transactions || []).map(this.normalizeTransaction);
      }

      this.updateWalletData(walletPubkey, {
        transactions,
        loading: false,
        lastUpdated: Date.now(),
      });

      return transactions;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get transactions';
      this.logger.error('Failed to get wallet transactions:', error);
      this.updateWalletData(walletPubkey, { loading: false, error: errorMessage });
      return [];
    }
  }

  /**
   * Get wallet info
   * NIP-47: get_info method
   */
  async getWalletInfo(walletPubkey: string): Promise<NwcWalletInfo | null> {
    const wallets = this.walletsService.wallets();
    const wallet = wallets[walletPubkey];

    if (!wallet) {
      this.logger.error('Wallet not found:', walletPubkey);
      return null;
    }

    try {
      const client = await this.getNwcClient(wallet);
      if (!client) {
        throw new Error('No connection available for wallet');
      }

      // NIP-47 get_info method
      const result = await client.getInfo();

      const info: NwcWalletInfo = {
        alias: (result as { alias?: string }).alias,
        color: (result as { color?: string }).color,
        pubkey: (result as { pubkey?: string }).pubkey,
        network: (result as { network?: string }).network,
        block_height: (result as { block_height?: number }).block_height,
        block_hash: (result as { block_hash?: string }).block_hash,
        methods: (result as { methods?: string[] }).methods,
        notifications: (result as { notifications?: string[] }).notifications,
      };

      this.updateWalletData(walletPubkey, { info });

      return info;
    } catch (error) {
      this.logger.error('Failed to get wallet info:', error);
      return null;
    }
  }

  /**
   * Refresh all data for a wallet (balance, transactions, info)
   */
  async refreshWalletData(walletPubkey: string): Promise<void> {
    this.updateWalletData(walletPubkey, { loading: true, error: null });

    try {
      // Fetch all data in parallel
      await Promise.all([
        this.getBalance(walletPubkey),
        this.getTransactions(walletPubkey, { limit: 20 }),
        this.getWalletInfo(walletPubkey),
      ]);
    } catch (error) {
      this.logger.error('Failed to refresh wallet data:', error);
    }
  }

  /**
   * Select a wallet for operations
   */
  selectWallet(walletPubkey: string): void {
    this.selectedWalletPubkey.set(walletPubkey);

    // Initialize cache entry if needed
    const cache = this.walletDataCache();
    if (!cache[walletPubkey]) {
      this.walletDataCache.set({
        ...cache,
        [walletPubkey]: {
          balance: null,
          transactions: [],
          info: null,
          lastUpdated: 0,
          loading: false,
          error: null,
        },
      });
    }
  }

  /**
   * Get cached wallet data
   */
  getWalletData(walletPubkey: string): WalletData | null {
    return this.walletDataCache()[walletPubkey] || null;
  }

  /**
   * Format millisatoshis to a readable string
   */
  formatMsats(msats: number): string {
    const sats = Math.floor(msats / 1000);
    if (sats >= 100000000) {
      return `${(sats / 100000000).toFixed(8)} BTC`;
    } else if (sats >= 1000) {
      return `${sats.toLocaleString()} sats`;
    }
    return `${msats.toLocaleString()} msats`;
  }

  /**
   * Format balance to sats
   */
  formatBalanceToSats(msats: number): number {
    return Math.floor(msats / 1000);
  }

  /**
   * Update wallet data in cache
   */
  private updateWalletData(walletPubkey: string, updates: Partial<WalletData>): void {
    const cache = this.walletDataCache();
    const existing = cache[walletPubkey] || {
      balance: null,
      transactions: [],
      info: null,
      lastUpdated: 0,
      loading: false,
      error: null,
    };

    this.walletDataCache.set({
      ...cache,
      [walletPubkey]: {
        ...existing,
        ...updates,
      },
    });
  }

  /**
   * Normalize transaction data from various response formats
   */
  private normalizeTransaction = (tx: unknown): NwcTransaction => {
    const transaction = tx as Record<string, unknown>;
    return {
      type: (transaction['type'] as 'incoming' | 'outgoing') || 'incoming',
      state: transaction['state'] as NwcTransaction['state'],
      invoice: transaction['invoice'] as string | undefined,
      description: transaction['description'] as string | undefined,
      description_hash: transaction['description_hash'] as string | undefined,
      preimage: transaction['preimage'] as string | undefined,
      payment_hash: (transaction['payment_hash'] as string) || '',
      amount: (transaction['amount'] as number) || 0,
      fees_paid: transaction['fees_paid'] as number | undefined,
      created_at: (transaction['created_at'] as number) || Math.floor(Date.now() / 1000),
      expires_at: transaction['expires_at'] as number | undefined,
      settled_at: transaction['settled_at'] as number | undefined,
      metadata: transaction['metadata'] as Record<string, unknown> | undefined,
    };
  };
}
