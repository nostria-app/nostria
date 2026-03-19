import { inject, Injectable, signal, computed, effect, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NWCClient } from '@getalby/sdk';
import { MatSnackBar } from '@angular/material/snack-bar';
import { hexToBytes } from '@noble/hashes/utils.js';
import { v2 } from 'nostr-tools/nip44';
import { nip04, getPublicKey, Event } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { Wallets, Wallet } from './wallets';
import { AccountStateService } from './account-state.service';
import { NwcRelayService } from './relays/nwc-relay';
import { NotificationService } from './notification.service';
import { ContentNotification, NotificationType } from './database.service';
import { DatabaseService } from './database.service';

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

export interface WalletTransferResult {
  invoice: string;
  paymentHash?: string;
  preimage?: string;
  feesPaidMsats?: number;
}

/**
 * NIP-47 Wallet Service Notification event kinds
 * Kind 23196 uses NIP-04 encryption (backwards compatibility)
 * Kind 23197 uses NIP-44 encryption (preferred)
 */
export const NWC_NOTIFICATION_KIND_NIP04 = 23196;
export const NWC_NOTIFICATION_KIND_NIP44 = 23197;

/**
 * Parsed NWC notification content
 */
export interface NwcNotificationContent {
  notification_type: string;
  notification: Record<string, unknown>;
}

/**
 * Context stored when the app initiates a payment, keyed by payment_hash.
 * Used to correlate outgoing payment_sent notifications with the original zap.
 */
export interface PaymentContext {
  recipientPubkey: string;
  eventId?: string;
  eventKind?: number;
  message?: string;
  timestamp: number;
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
  private accountState = inject(AccountStateService);
  private nwcRelay = inject(NwcRelayService);
  private notificationService = inject(NotificationService);
  private database = inject(DatabaseService);
  private snackBar = inject(MatSnackBar);
  private platformId = inject(PLATFORM_ID);

  // Track the current account pubkey to detect changes
  private currentAccountPubkey = signal<string | null>(null);

  // Cache wallet data per pubkey
  private walletDataCache = signal<Record<string, WalletData>>({});

  // Cache NWC clients to avoid reconnecting
  private nwcClients = new Map<string, NWCClient>();

  // Active NWC notification subscriptions
  private notificationSubscriptions: { unsubscribe: () => void }[] = [];
  // Track processed notification event IDs to avoid duplicates
  private processedNotificationIds = new Set<string>();
  // Payment context map: payment_hash → context from when the payment was initiated
  private paymentContexts = new Map<string, PaymentContext>();

  // Currently selected wallet pubkey for operations
  selectedWalletPubkey = signal<string | null>(null);

  // Computed: get data for currently selected wallet
  selectedWalletData = computed(() => {
    const pubkey = this.selectedWalletPubkey();
    if (!pubkey) return null;
    return this.walletDataCache()[pubkey] || null;
  });

  constructor() {
    // Effect to clear cache when account changes
    effect(() => {
      const accountPubkey = this.accountState.pubkey();
      const previousPubkey = this.currentAccountPubkey();

      // Only clear if the account actually changed
      if (accountPubkey !== previousPubkey) {
        this.currentAccountPubkey.set(accountPubkey);
        this.clearCache();
        this.logger.debug('NWC cache cleared due to account change');
      }
    });

    // Effect to subscribe to NWC notifications when wallets change
    effect(() => {
      const wallets = this.walletsService.wallets();
      const accountPubkey = this.accountState.pubkey();

      if (!isPlatformBrowser(this.platformId) || !accountPubkey) {
        return;
      }

      // Unsubscribe from previous subscriptions
      this.unsubscribeNotifications();

      // Subscribe to notifications for each wallet
      for (const wallet of Object.values(wallets)) {
        this.subscribeToWalletNotifications(wallet, accountPubkey);
      }
    });
  }

  /**
   * Clear all cached wallet data and NWC clients
   */
  clearCache(): void {
    // Clear NWC clients
    for (const client of this.nwcClients.values()) {
      try {
        client.close();
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
    this.nwcClients.clear();

    // Clear notification subscriptions
    this.unsubscribeNotifications();

    // Clear wallet data cache
    this.walletDataCache.set({});

    // Clear selected wallet
    this.selectedWalletPubkey.set(null);
  }

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
   * Transfer sats between two connected NWC wallets.
   * Creates an invoice on the destination wallet and pays it from the source wallet.
   */
  async transferBetweenWallets(
    fromWalletPubkey: string,
    toWalletPubkey: string,
    amountSats: number,
    description?: string
  ): Promise<WalletTransferResult> {
    if (!Number.isFinite(amountSats) || amountSats <= 0) {
      throw new Error('Transfer amount must be greater than 0 sats');
    }

    if (fromWalletPubkey === toWalletPubkey) {
      throw new Error('Source and destination wallets must be different');
    }

    const wallets = this.walletsService.wallets();
    const fromWallet = wallets[fromWalletPubkey];
    const toWallet = wallets[toWalletPubkey];

    if (!fromWallet || !toWallet) {
      throw new Error('Wallet not found');
    }

    const [fromClient, toClient] = await Promise.all([
      this.getNwcClient(fromWallet),
      this.getNwcClient(toWallet),
    ]);

    if (!fromClient || !toClient) {
      throw new Error('No connection available for one or both wallets');
    }

    const amountMsats = Math.floor(amountSats * 1000);

    const invoiceResult = await toClient.makeInvoice({
      amount: amountMsats,
      description: description?.trim() || 'Wallet transfer',
    });

    const invoice = typeof invoiceResult.invoice === 'string' ? invoiceResult.invoice : null;
    if (!invoice) {
      throw new Error('Failed to create transfer invoice');
    }

    const paymentResult = await fromClient.payInvoice({ invoice });

    return {
      invoice,
      paymentHash:
        typeof invoiceResult.payment_hash === 'string' ? invoiceResult.payment_hash : undefined,
      preimage: typeof paymentResult.preimage === 'string' ? paymentResult.preimage : undefined,
      feesPaidMsats:
        typeof paymentResult.fees_paid === 'number' ? paymentResult.fees_paid : undefined,
    };
  }

  /**
   * Pay a BOLT-11 invoice using a specific wallet's cached NWC client.
   *
   * @param invoice - BOLT-11 invoice string
   * @param walletPubkey - The wallet to pay with
   * @returns Payment result with preimage
   */
  async payInvoice(
    invoice: string,
    walletPubkey: string
  ): Promise<{ preimage?: string }> {
    const walletsMap = this.walletsService.wallets();
    const wallet = walletsMap[walletPubkey];
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    const client = await this.getNwcClient(wallet);
    if (!client) {
      throw new Error('No wallet connection available');
    }

    const result = await client.payInvoice({ invoice });
    return {
      preimage: typeof result.preimage === 'string' ? result.preimage : undefined,
    };
  }

  /**
   * Lookup a specific invoice across all connected wallets.
   * Returns the transaction state from whichever wallet recognizes the invoice.
   * Also returns the wallet pubkey that owns the invoice for efficient future lookups.
   *
   * NIP-47: lookup_invoice method
   *
   * @param invoice - BOLT-11 invoice string
   * @param walletPubkey - Optional: specific wallet to check (skips trying all wallets)
   * @returns The transaction info and owning wallet pubkey, or null if no wallet recognizes it
   */
  async lookupInvoice(
    invoice: string,
    walletPubkey?: string
  ): Promise<{ transaction: NwcTransaction; walletPubkey: string } | null> {
    const walletsMap = this.walletsService.wallets();

    // If a specific wallet is requested, only check that one
    if (walletPubkey) {
      const wallet = walletsMap[walletPubkey];
      if (!wallet) {
        return null;
      }

      const client = await this.getNwcClient(wallet);
      if (!client) {
        return null;
      }

      try {
        const result = await client.lookupInvoice({ invoice });
        const tx = this.normalizeTransaction(result);
        return {
          transaction: tx,
          walletPubkey,
        };
      } catch (err) {
        return null;
      }
    }

    // Try each wallet until one recognizes the invoice
    for (const [pubkey, wallet] of Object.entries(walletsMap)) {
      if (!wallet.connections || wallet.connections.length === 0) continue;

      const client = await this.getNwcClient(wallet);
      if (!client) continue;

      try {
        const result = await client.lookupInvoice({ invoice });
        const tx = this.normalizeTransaction(result);
        return {
          transaction: tx,
          walletPubkey: pubkey,
        };
      } catch (err: unknown) {
        // NOT_FOUND is expected for wallets that didn't create the invoice — skip
        if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'NOT_FOUND') {
          continue;
        }
        // Fallback string check for older SDK versions
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('not found') || message.includes('NOT_FOUND')) {
          continue;
        }
        // Other errors (method not supported, etc.) — skip this wallet
        continue;
      }
    }

    // No wallet recognized this invoice
    return null;
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
   * Format millisatoshis to a readable string (always in sats)
   */
  formatMsats(msats: number): string {
    const sats = Math.floor(msats / 1000);
    if (sats >= 100000000) {
      return `${(sats / 100000000).toFixed(8)} BTC`;
    }
    return `${sats.toLocaleString()} sats`;
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
   * Normalize transaction data from various response formats.
   *
   * Note: lookupInvoice responses may NOT include a `state` field (unlike
   * listTransactions). When `state` is absent, we infer it from available
   * fields: `settled_at`, `preimage`, and `expires_at` timestamps.
   */
  private normalizeTransaction = (tx: unknown): NwcTransaction => {
    const transaction = tx as Record<string, unknown>;

    // Infer state when the response doesn't include it (e.g. lookupInvoice)
    let state = transaction['state'] as NwcTransaction['state'] | undefined;
    if (!state) {
      if (transaction['settled_at']) {
        state = 'settled';
      } else if (transaction['preimage'] && typeof transaction['preimage'] === 'string' && transaction['preimage'].length > 0) {
        // Some wallets return a preimage but no settled_at — preimage proves payment
        state = 'settled';
      } else if (
        transaction['expires_at'] &&
        typeof transaction['expires_at'] === 'number' &&
        Math.floor(Date.now() / 1000) > transaction['expires_at']
      ) {
        state = 'expired';
      } else {
        state = 'pending';
      }
    }

    return {
      type: (transaction['type'] as 'incoming' | 'outgoing') || 'incoming',
      state,
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

  /**
   * Register payment context for an outgoing payment.
   * Call this before paying an invoice so the notification handler can correlate it.
   * @param paymentHash - The payment hash from the BOLT-11 invoice
   * @param context - The zap/payment context (recipient, event, message)
   */
  registerPaymentContext(paymentHash: string, context: Omit<PaymentContext, 'timestamp'>): void {
    this.paymentContexts.set(paymentHash, {
      ...context,
      timestamp: Date.now(),
    });

    // Prune old entries (older than 1 hour) to prevent memory leaks
    const oneHourAgo = Date.now() - 3600000;
    for (const [hash, ctx] of this.paymentContexts) {
      if (ctx.timestamp < oneHourAgo) {
        this.paymentContexts.delete(hash);
      }
    }
  }

  /**
   * Unsubscribe from all active NWC notification subscriptions
   */
  private unsubscribeNotifications(): void {
    for (const sub of this.notificationSubscriptions) {
      try {
        sub.unsubscribe();
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.notificationSubscriptions = [];
    this.processedNotificationIds.clear();
  }

  /**
   * Subscribe to NIP-47 wallet notifications (kind 23196/23197) for a specific wallet
   */
  private subscribeToWalletNotifications(wallet: Wallet, accountPubkey: string): void {
    if (!wallet.connections || wallet.connections.length === 0) {
      return;
    }

    try {
      const parsed = this.walletsService.parseConnectionString(wallet.connections[0]);
      const walletServicePubkey = parsed.pubkey;
      const relayUrls = parsed.relay;
      const secret = parsed.secret;

      if (!walletServicePubkey || !relayUrls.length || !secret) {
        return;
      }

      // NIP-47: The wallet service tags notifications with the public key
      // corresponding to the client's secret, NOT the user's account pubkey
      const clientPubkey = getPublicKey(hexToBytes(secret));

      const sinceTimestamp = Math.floor(Date.now() / 1000) - 86400;
      const filter = {
        kinds: [NWC_NOTIFICATION_KIND_NIP04, NWC_NOTIFICATION_KIND_NIP44],
        authors: [walletServicePubkey],
        '#p': [clientPubkey],
        since: sinceTimestamp,
      };

      const subscription = this.nwcRelay.subscribeToNwcResponse(
        filter,
        relayUrls,
        (event: Event) => {
          this.handleNwcNotificationEvent(event, secret, walletServicePubkey, wallet.name || 'Wallet');
        }
      );

      this.notificationSubscriptions.push(subscription);
    } catch (error) {
      this.logger.error('Failed to subscribe to wallet notifications', error);
    }
  }

  /**
   * Handle an incoming NWC notification event (kind 23196/23197)
   * Decrypts using NIP-04 or NIP-44 with the wallet secret and creates a notification
   */
  private async handleNwcNotificationEvent(
    event: Event,
    secret: string,
    walletServicePubkey: string,
    walletName: string
  ): Promise<void> {
    // Skip if already processed
    if (this.processedNotificationIds.has(event.id)) {
      return;
    }
    this.processedNotificationIds.add(event.id);

    try {
      // Decrypt content based on event kind
      const secretBytes = hexToBytes(secret);
      let decryptedContent: string;

      if (event.kind === NWC_NOTIFICATION_KIND_NIP44) {
        const conversationKey = v2.utils.getConversationKey(secretBytes, walletServicePubkey);
        decryptedContent = v2.decrypt(event.content, conversationKey);
      } else {
        decryptedContent = await nip04.decrypt(secretBytes, walletServicePubkey, event.content);
      }

      // Parse the notification JSON
      const parsed = JSON.parse(decryptedContent) as unknown;
      if (!parsed || typeof parsed !== 'object') {
        return;
      }

      const notification = parsed as NwcNotificationContent;
      const notificationType = notification.notification_type || 'unknown';
      const notificationData = notification.notification || {};

      // Extract nostr metadata from the zap request (kind 9734) embedded in the notification
      const nostrMetadata = notificationData['metadata'] as Record<string, unknown> | undefined;
      const nostrEvent = nostrMetadata?.['nostr'] as Record<string, unknown> | undefined;

      // Sender pubkey from the embedded zap request
      let senderPubkey = typeof nostrEvent?.['pubkey'] === 'string' ? nostrEvent['pubkey'] as string : undefined;
      // Zap comment from zap request content
      let zapComment = typeof nostrEvent?.['content'] === 'string' && (nostrEvent['content'] as string).length > 0
        ? nostrEvent['content'] as string : undefined;
      // Extract tags from the embedded zap request
      const nostrTags = Array.isArray(nostrEvent?.['tags']) ? nostrEvent['tags'] as string[][] : [];
      // Zapped event ID (e tag)
      let zappedEventId = nostrTags.find(t => t[0] === 'e')?.[1];
      // Zapped event kind (k tag)
      const zappedKindTag = nostrTags.find(t => t[0] === 'k');
      let zappedEventKind = zappedKindTag?.[1] ? parseInt(zappedKindTag[1], 10) : undefined;
      // Relay hints from the relays tag
      const relaysTag = nostrTags.find(t => t[0] === 'relays');
      const relayHints = relaysTag ? relaysTag.slice(1) : undefined;

      // For outgoing payments without nostr metadata, look up stored payment context
      const paymentHash = typeof notificationData['payment_hash'] === 'string'
        ? notificationData['payment_hash'] as string : undefined;
      if (paymentHash && !senderPubkey) {
        const ctx = this.paymentContexts.get(paymentHash);
        if (ctx) {
          senderPubkey = ctx.recipientPubkey;
          zappedEventId = zappedEventId || ctx.eventId;
          zappedEventKind = zappedEventKind ?? ctx.eventKind;
          zapComment = zapComment || ctx.message || undefined;
          this.paymentContexts.delete(paymentHash);
        }
      }

      // Build a human-readable title and message
      const { title, message } = this.formatWalletNotification(notificationType, notificationData, walletName, zapComment);

      // Show toast
      this.snackBar.open(title, 'Close', { duration: 5000 });

      // Create content notification for history
      const notificationId = `content-wallet-${event.id}`;

      // Check if already exists in memory or storage
      const existingInMemory = this.notificationService.notifications().find(n => n.id === notificationId);
      if (existingInMemory) {
        return;
      }

      const existingInStorage = await this.database.getNotification(notificationId);
      if (existingInStorage) {
        return;
      }

      const pubkey = this.accountState.pubkey();
      const contentNotification: ContentNotification = {
        id: notificationId,
        type: NotificationType.WALLET,
        title,
        message,
        timestamp: event.created_at * 1000, // Convert to ms for internal use
        read: false,
        recipientPubkey: pubkey,
        authorPubkey: senderPubkey || walletServicePubkey,
        eventId: zappedEventId,
        kind: zappedEventKind,
        metadata: {
          relayHints: relayHints,
          content: zapComment,
          zapAmount: typeof notificationData['amount'] === 'number' ? notificationData['amount'] as number : undefined,
        },
      };

      this.notificationService.addNotification(contentNotification);
      await this.notificationService.persistNotificationToStorage(contentNotification);
    } catch (error) {
      this.logger.error('Failed to process wallet notification event', error);
    }
  }

  /**
   * Format a wallet notification into a human-readable title and message
   */
  private formatWalletNotification(
    notificationType: string,
    data: Record<string, unknown>,
    walletName: string,
    zapComment?: string
  ): { title: string; message: string } {
    const amount = typeof data['amount'] === 'number' ? data['amount'] : 0;
    const amountSats = Math.floor(amount / 1000);
    const description = zapComment || (typeof data['description'] === 'string' ? data['description'] : '');

    switch (notificationType) {
      case 'payment_received': {
        const title = `Payment received: ${amountSats.toLocaleString()} sats`;
        const message = description
          ? `${walletName}: ${description}`
          : walletName;
        return { title, message };
      }
      case 'payment_sent': {
        const title = `Payment sent: ${amountSats.toLocaleString()} sats`;
        const message = description
          ? `${walletName}: ${description}`
          : walletName;
        return { title, message };
      }
      case 'balance_updated': {
        const balance = typeof data['balance'] === 'number' ? Math.floor(data['balance'] / 1000) : null;
        const title = balance !== null
          ? `Balance updated: ${balance.toLocaleString()} sats`
          : 'Balance updated';
        return { title, message: walletName };
      }
      case 'hold_invoice_accepted': {
        const title = `Hold invoice accepted: ${amountSats.toLocaleString()} sats`;
        const message = description
          ? `${walletName}: ${description}`
          : walletName;
        return { title, message };
      }
      default: {
        const title = `Wallet notification: ${notificationType.replace(/_/g, ' ')}`;
        const message = description
          ? `${walletName}: ${description}`
          : walletName;
        return { title, message };
      }
    }
  }
}
