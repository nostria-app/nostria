import { Injectable, inject, signal } from '@angular/core';
import { Event, UnsignedEvent, nip19, nip57 } from 'nostr-tools';
import { LN } from '@getalby/sdk';
import { NostrService } from './nostr.service';
import { AccountStateService } from './account-state.service';
import { RelaysService } from './relays/relays';
import { Wallets } from './wallets';
import { LoggerService } from './logger.service';
import { AccountRelayService } from './relays/account-relay';
import { ZapMetricsService } from './zap-metrics.service';

interface LnurlPayResponse {
  callback: string;
  maxSendable: number;
  minSendable: number;
  metadata: string;
  allowsNostr?: boolean;
  nostrPubkey?: string;
  commentAllowed?: number;
}

interface ZapPayment {
  pr: string; // bolt11 invoice
  routes?: unknown[];
}

interface ZapError {
  code: string;
  message: string;
  recoverable: boolean;
  retryDelay?: number;
}

interface RetryOptions {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

@Injectable({
  providedIn: 'root',
})
export class ZapService {
  private nostr = inject(NostrService);
  private accountState = inject(AccountStateService);
  private relayService = inject(RelaysService);
  private wallets = inject(Wallets);
  private logger = inject(LoggerService);
  private accountRelay = inject(AccountRelayService);
  private zapMetrics = inject(ZapMetricsService);

  // Cache for LNURL pay endpoints
  private lnurlCache = new Map<string, LnurlPayResponse>();

  // Default retry configuration
  private readonly DEFAULT_RETRY_OPTIONS: RetryOptions = {
    maxRetries: 3,
    initialDelay: 1000, // 1 second
    maxDelay: 10000, // 10 seconds
    backoffMultiplier: 2,
  };

  /**
   * Create a standardized ZapError
   */
  private createZapError(
    code: string,
    message: string,
    recoverable = true,
    retryDelay?: number
  ): ZapError {
    return { code, message, recoverable, retryDelay };
  }

  /**
   * Retry wrapper with exponential backoff
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    options: Partial<RetryOptions> = {},
    operationName = 'operation'
  ): Promise<T> {
    const config = { ...this.DEFAULT_RETRY_OPTIONS, ...options };
    let lastError: Error;
    let delay = config.initialDelay;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        this.logger.debug(
          `Attempting ${operationName} (attempt ${attempt + 1}/${config.maxRetries + 1})`
        );
        return await operation();
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`${operationName} failed on attempt ${attempt + 1}:`, lastError);

        if (attempt === config.maxRetries) {
          break; // No more retries
        }

        // Check if error is recoverable
        if (this.isNonRecoverableError(lastError)) {
          this.logger.error(`Non-recoverable error in ${operationName}:`, lastError);
          throw this.enhanceError(lastError);
        }

        // Wait before retrying
        this.logger.debug(`Waiting ${delay}ms before retry...`);
        await this.delay(delay);

        // Exponential backoff
        delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
      }
    }

    throw this.enhanceError(lastError!);
  }

  /**
   * Check if an error should not be retried
   */
  private isNonRecoverableError(error: Error): boolean {
    const message = error.message.toLowerCase();

    // User/configuration errors (don't retry)
    const nonRecoverableMessages = [
      'recipient has no lightning address',
      'recipient does not support nostr zaps',
      'amount must be between',
      'invalid lightning address',
      'no active account',
      'no connected wallets',
      'wallet not found',
    ];

    return nonRecoverableMessages.some(msg => message.includes(msg));
  }

  /**
   * Enhance error with more context
   */
  private enhanceError(error: Error): ZapError {
    const message = error.message.toLowerCase();

    if (message.includes('network') || message.includes('fetch')) {
      return this.createZapError(
        'NETWORK_ERROR',
        'Network connection failed. Please check your internet connection.',
        true,
        2000
      );
    }

    if (message.includes('timeout')) {
      return this.createZapError(
        'TIMEOUT_ERROR',
        'Request timed out. Please try again.',
        true,
        1000
      );
    }

    if (message.includes('invoice') || message.includes('bolt11')) {
      return this.createZapError(
        'INVOICE_ERROR',
        'Invalid Lightning invoice. Please try again.',
        true
      );
    }

    if (message.includes('wallet') || message.includes('payment')) {
      return this.createZapError(
        'WALLET_ERROR',
        'Wallet payment failed. Please check your wallet connection.',
        true,
        3000
      );
    }

    if (message.includes('recipient')) {
      return this.createZapError('RECIPIENT_ERROR', error.message, false);
    }

    return this.createZapError(
      'UNKNOWN_ERROR',
      error.message || 'An unexpected error occurred',
      true
    );
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get Lightning Address/LNURL from user metadata
   */
  getLightningAddress(metadata: Record<string, unknown>): string | null {
    if (metadata['lud16'] && typeof metadata['lud16'] === 'string') {
      return metadata['lud16'];
    }
    if (metadata['lud06'] && typeof metadata['lud06'] === 'string') {
      return metadata['lud06'];
    }
    return null;
  }

  /**
   * Convert Lightning Address to LNURL
   */
  private lightningAddressToLnurl(lightningAddress: string): string {
    if (lightningAddress.startsWith('lnurl')) {
      return lightningAddress;
    }

    // Lightning address format: user@domain.com
    const [username, domain] = lightningAddress.split('@');
    if (!username || !domain) {
      throw new Error('Invalid lightning address format');
    }

    // For LNURL-pay callback, we don't need to encode the URL as LNURL
    // The callback URL already contains the proper endpoint
    // Just return the lightning address for identification
    return lightningAddress;
  }

  /**
   * Fetch LNURL-pay information for a Lightning address
   */
  async fetchLnurlPayInfo(lightningAddress: string): Promise<LnurlPayResponse> {
    // Check cache first
    if (this.lnurlCache.has(lightningAddress)) {
      return this.lnurlCache.get(lightningAddress)!;
    }

    try {
      let url: string;

      if (lightningAddress.includes('@')) {
        // Lightning address format: user@domain.com
        const [username, domain] = lightningAddress.split('@');
        url = `https://${domain}/.well-known/lnurlp/${username}`;
      } else if (lightningAddress.startsWith('lnurl')) {
        // LNURL format - decode it
        try {
          const decoded = nip19.decode(lightningAddress);
          if (decoded && typeof decoded === 'object' && 'data' in decoded) {
            url = new TextDecoder().decode(decoded.data as Uint8Array);
          } else {
            throw new Error('Invalid LNURL format');
          }
        } catch (decodeError) {
          throw new Error(`Failed to decode LNURL: ${decodeError}`);
        }
      } else {
        throw new Error('Invalid lightning address or LNURL format');
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as LnurlPayResponse;

      // Validate required fields
      if (!data.callback || !data.maxSendable || !data.minSendable) {
        throw new Error('Invalid LNURL pay response');
      }

      // Cache the response
      this.lnurlCache.set(lightningAddress, data);

      return data;
    } catch (error) {
      this.logger.error('Failed to fetch LNURL pay info:', error);
      throw error;
    }
  }

  /**
   * Create a zap request event (kind 9734)
   */
  async createZapRequest(
    recipientPubkey: string,
    amount: number, // in millisats
    message = '',
    eventId?: string,
    lnurl?: string,
    relays: string[] = []
  ): Promise<UnsignedEvent> {
    const currentUser = this.accountState.account();
    if (!currentUser) {
      throw new Error('No user account available for zapping');
    }

    // Use default relays if none provided
    if (relays.length === 0) {
      // Get connected relay URLs
      const connectedRelays = this.relayService.getConnectedRelays();
      if (Array.isArray(connectedRelays)) {
        relays = connectedRelays.slice(0, 3); // Limit to 3 relays
      } else {
        // Fallback to some common relays if no connected ones
        relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.snort.social'];
      }
    }

    const tags: string[][] = [
      ['relays', ...relays],
      ['amount', amount.toString()],
      ['p', recipientPubkey],
    ];

    // Don't include lnurl in zap request - it's only used for the callback

    if (eventId) {
      tags.push(['e', eventId]);
      // Add the kind of the target event if it's a note
      tags.push(['k', '1']);
    }

    const zapRequest: UnsignedEvent = {
      kind: 9734,
      content: message,
      tags,
      pubkey: currentUser.pubkey,
      created_at: Math.floor(Date.now() / 1000),
    };

    return zapRequest;
  }

  /**
   * Send zap request to LNURL callback to get invoice
   */
  async requestZapInvoice(
    zapRequest: Event,
    callbackUrl: string,
    amount: number,
    comment?: string
  ): Promise<ZapPayment> {
    try {
      const encodedZapRequest = encodeURIComponent(JSON.stringify(zapRequest));
      let requestUrl = `${callbackUrl}?amount=${amount}&nostr=${encodedZapRequest}`;

      // Add comment parameter if provided
      if (comment && comment.trim()) {
        const encodedComment = encodeURIComponent(comment.trim());
        requestUrl += `&comment=${encodedComment}`;
      }

      const response = await fetch(requestUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = (await response.json()) as ZapPayment;

      if (!data.pr) {
        throw new Error('No invoice received from LNURL service');
      }

      return data;
    } catch (error) {
      this.logger.error('Failed to request zap invoice:', error);
      throw error;
    }
  }

  /**
   * Pay a lightning invoice using NWC via Alby SDK
   */
  async payInvoice(invoice: string): Promise<{ preimage: string; fees_paid?: number }> {
    try {
      this.logger.info('=== Starting NWC Payment via Alby SDK ===');
      this.logger.debug('Invoice:', invoice);

      const availableWallets = this.wallets.wallets();
      const walletEntries = Object.entries(availableWallets);

      if (walletEntries.length === 0) {
        throw new Error('No wallets connected. Please connect a wallet first.');
      }

      // For now, use the first available wallet
      const [, wallet] = walletEntries[0];
      const connectionString = wallet.connections[0];

      this.logger.debug('Using wallet connection string:', connectionString);

      // Use Alby SDK to handle the NWC payment
      const ln = new LN(connectionString);

      this.logger.debug('Created Alby LN client, making payment...');
      const result = await ln.pay(invoice);

      this.logger.info('✅ Payment completed successfully via Alby SDK');
      this.logger.debug('Payment result:', result);

      // Extract preimage and fees from Alby SDK result
      // Define types for expected response formats
      interface AlbyPaymentResult {
        preimage?: string;
        payment_preimage?: string;
        fees_paid?: number;
        fee?: number;
      }

      let preimage: string;
      let fees_paid: number | undefined;

      if (typeof result === 'object' && result !== null) {
        // Handle object response
        const paymentResult = result as AlbyPaymentResult;
        preimage = paymentResult.preimage || paymentResult.payment_preimage || '';
        fees_paid = paymentResult.fees_paid || paymentResult.fee;
      } else if (typeof result === 'string') {
        // Handle string response (might be just preimage)
        preimage = result;
      } else {
        throw new Error('Unexpected payment result format');
      }

      if (!preimage) {
        throw new Error('Payment completed but no preimage received');
      }

      return {
        preimage,
        fees_paid,
      };
    } catch (error) {
      this.logger.error('❌ Failed to pay invoice via Alby SDK:', error);
      throw error;
    }
  }

  /**
   * Parse amount from bolt11 invoice using nostr-tools
   */
  private getBolt11Amount(invoice: string): number | null {
    try {
      // Use the getSatoshisAmountFromBolt11 function from nostr-tools
      const amountSats = nip57.getSatoshisAmountFromBolt11(invoice);
      // Convert sats to millisats
      return amountSats * 1000;
    } catch (error) {
      this.logger.error('Failed to parse bolt11 amount:', error);
      return null;
    }
  }

  /**
   * Validate amount consistency between zap request and bolt11 invoice
   */
  private validateZapAmount(zapRequest: Event, bolt11Invoice: string): boolean {
    try {
      const invoiceAmountMsats = this.getBolt11Amount(bolt11Invoice);
      if (!invoiceAmountMsats) {
        return false;
      }

      // Get the amount from zap request (in millisats)
      const amountTag = zapRequest.tags.find(tag => tag[0] === 'amount');
      if (!amountTag || !amountTag[1]) {
        return false;
      }

      const requestedAmount = parseInt(amountTag[1]);

      // Allow for small rounding differences (within 1% or 100 msats, whichever is larger)
      const tolerance = Math.max(100, requestedAmount * 0.01);
      const difference = Math.abs(invoiceAmountMsats - requestedAmount);

      return difference <= tolerance;
    } catch (error) {
      this.logger.error('Error validating zap amount:', error);
      return false;
    }
  }

  /**
   * Complete zap process: create request, get invoice, pay it
   */
  async sendZap(
    recipientPubkey: string,
    amount: number, // in sats
    message = '',
    eventId?: string,
    recipientMetadata?: Record<string, unknown>
  ): Promise<void> {
    const startTime = Date.now();

    try {
      await this.withRetry(
        async () => {
          this.logger.info('Starting zap process', { recipientPubkey, amount, eventId });

          // Convert sats to millisats
          const amountMsats = amount * 1000;

          // Get lightning address from metadata
          if (!recipientMetadata) {
            throw new Error(
              'Recipient metadata required for zapping. Please ensure the recipient has a valid profile with Lightning address.'
            );
          }

          const lightningAddress = this.getLightningAddress(recipientMetadata);
          if (!lightningAddress) {
            throw new Error(
              'Recipient has no lightning address (lud16 or lud06) configured in their profile. They cannot receive zaps.'
            );
          }

          // Fetch LNURL pay info with retry
          const lnurlPayInfo = await this.withRetry(
            () => this.fetchLnurlPayInfo(lightningAddress),
            { maxRetries: 2 },
            'fetch LNURL pay info'
          );

          // Check if recipient supports Nostr zaps
          if (!lnurlPayInfo.allowsNostr || !lnurlPayInfo.nostrPubkey) {
            throw new Error('Recipient does not support Nostr zaps');
          }

          // Validate amount is within bounds
          if (amountMsats < lnurlPayInfo.minSendable || amountMsats > lnurlPayInfo.maxSendable) {
            throw new Error(
              `Amount must be between ${lnurlPayInfo.minSendable / 1000} and ${lnurlPayInfo.maxSendable / 1000} sats`
            );
          }

          // Validate comment length if provided
          if (message && message.trim()) {
            const commentAllowed = lnurlPayInfo.commentAllowed || 0;
            if (commentAllowed === 0) {
              throw new Error('Recipient does not allow comments with zaps');
            }
            if (message.trim().length > commentAllowed) {
              throw new Error(`Comment too long. Maximum ${commentAllowed} characters allowed.`);
            }
          }

          // Convert lightning address to LNURL for the request
          const lnurl = this.lightningAddressToLnurl(lightningAddress);

          // Create zap request (usually succeeds, so no retry needed)
          const zapRequest = await this.createZapRequest(
            recipientPubkey,
            amountMsats,
            message,
            eventId,
            lnurl
          );

          // Sign the zap request
          const signedZapRequest = await this.nostr.signEvent(zapRequest);

          // Request invoice from LNURL service with retry
          const zapPayment = await this.withRetry(
            () =>
              this.requestZapInvoice(signedZapRequest, lnurlPayInfo.callback, amountMsats, message),
            { maxRetries: 2 },
            'request zap invoice'
          );

          // Pay the invoice with retry (most critical part)
          await this.withRetry(
            () => this.payInvoice(zapPayment.pr),
            { maxRetries: 1, initialDelay: 2000 }, // Longer delay for payment retries
            'pay invoice'
          );

          this.logger.info('Zap completed successfully');
          return true;
        },
        { maxRetries: 1 },
        'send zap'
      ); // Overall retry for the entire process

      // Record successful zap metrics
      const paymentTime = Date.now() - startTime;
      this.zapMetrics.recordZapSent(amount, paymentTime, recipientPubkey, eventId);
    } catch (error) {
      // Record failed zap metrics
      const errorCode = this.extractErrorCode(error);
      this.zapMetrics.recordZapFailed(amount, errorCode, recipientPubkey);
      throw error;
    }
  }

  /**
   * Extract error code for metrics
   */
  private extractErrorCode(error: unknown): string {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (message.includes('network')) return 'NETWORK_ERROR';
      if (message.includes('timeout')) return 'TIMEOUT_ERROR';
      if (message.includes('wallet')) return 'WALLET_ERROR';
      if (message.includes('invoice')) return 'INVOICE_ERROR';
      if (message.includes('recipient')) return 'RECIPIENT_ERROR';
      return 'UNKNOWN_ERROR';
    }
    return 'UNKNOWN_ERROR';
  }

  /**
   * Validate a zap receipt
   */
  validateZapReceipt(
    zapReceipt: Event,
    expectedRecipientPubkey: string,
    lnurlPayInfo?: LnurlPayResponse
  ): boolean {
    try {
      // Basic validation
      if (zapReceipt.kind !== 9735) {
        return false;
      }

      // Check if signed by the expected LNURL service
      if (lnurlPayInfo?.nostrPubkey && zapReceipt.pubkey !== lnurlPayInfo.nostrPubkey) {
        return false;
      }

      // Validate required tags
      const pTags = zapReceipt.tags.filter(tag => tag[0] === 'p');
      const descriptionTags = zapReceipt.tags.filter(tag => tag[0] === 'description');
      const bolt11Tags = zapReceipt.tags.filter(tag => tag[0] === 'bolt11');

      if (pTags.length !== 1 || descriptionTags.length !== 1 || bolt11Tags.length !== 1) {
        return false;
      }

      // Check if the zap is for the expected recipient
      if (pTags[0][1] !== expectedRecipientPubkey) {
        return false;
      }

      // TODO: Validate the bolt11 invoice and description hash
      // Validate bolt11 invoice format
      const bolt11Invoice = bolt11Tags[0][1];
      const invoiceAmount = this.getBolt11Amount(bolt11Invoice);
      if (!invoiceAmount) {
        this.logger.warn('Invalid bolt11 invoice in zap receipt');
        return false;
      }

      // Parse and validate the zap request from description
      try {
        const zapRequestString = descriptionTags[0][1];
        const zapRequest = JSON.parse(zapRequestString) as Event;

        // Use nostr-tools to validate the zap request
        const validationError = nip57.validateZapRequest(zapRequestString);
        if (validationError) {
          this.logger.warn('Invalid zap request:', validationError);
          return false;
        }

        // Validate amount consistency between zap request and bolt11 invoice
        if (!this.validateZapAmount(zapRequest, bolt11Invoice)) {
          this.logger.warn('Amount mismatch between zap request and bolt11 invoice');
          return false;
        }
      } catch (error) {
        this.logger.warn('Failed to parse zap request from description tag:', error);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('Error validating zap receipt:', error as Error);
      return false;
    }
  }

  /**
   * Parse zap receipt to extract zap request and amount
   */
  parseZapReceipt(zapReceipt: Event): {
    zapRequest: Event | null;
    amount: number | null;
    comment: string;
  } {
    try {
      const descriptionTag = zapReceipt.tags.find(tag => tag[0] === 'description');
      if (!descriptionTag || !descriptionTag[1]) {
        return { zapRequest: null, amount: null, comment: '' };
      }

      // Parse the zap request from the description
      const zapRequest = JSON.parse(descriptionTag[1]) as Event;

      // Extract amount from bolt11 invoice
      const bolt11Tag = zapReceipt.tags.find(tag => tag[0] === 'bolt11');
      let amount: number | null = null;

      if (bolt11Tag && bolt11Tag[1]) {
        // Parse bolt11 invoice to extract amount
        const invoiceAmountMsats = this.getBolt11Amount(bolt11Tag[1]);
        if (invoiceAmountMsats) {
          amount = Math.round(invoiceAmountMsats / 1000); // Convert msats to sats
        }

        // Fallback: try to get amount from the zap request if bolt11 parsing failed
        if (!amount) {
          const amountTag = zapRequest.tags.find(tag => tag[0] === 'amount');
          if (amountTag && amountTag[1]) {
            amount = parseInt(amountTag[1]) / 1000; // Convert msats to sats
          }
        }
      }

      return {
        zapRequest,
        amount,
        comment: zapRequest.content || '',
      };
    } catch (error) {
      this.logger.error('Error parsing zap receipt:', error as Error);
      return { zapRequest: null, amount: null, comment: '' };
    }
  }

  /**
   * Get zap receipts for an event
   */
  async getZapsForEvent(eventId: string): Promise<Event[]> {
    try {
      // Query for zap receipts (kind 9735) that reference this event
      const zapReceipts = await this.accountRelay.getMany({
        kinds: [9735],
        '#e': [eventId],
        limit: 100,
      });

      return zapReceipts;
    } catch (error) {
      this.logger.error('Error fetching zaps for event:', error as Error);
      return [];
    }
  }

  /**
   * Get zap receipts for a user
   */
  async getZapsForUser(pubkey: string): Promise<Event[]> {
    try {
      // Query for zap receipts (kind 9735) that reference this user
      const zapReceipts = await this.accountRelay.getMany({
        kinds: [9735],
        '#p': [pubkey],
        limit: 100,
      });

      return zapReceipts;
    } catch (error) {
      this.logger.error('Error fetching zaps for user:', error as Error);
      return [];
    }
  }

  /**
   * Get zap receipts that correspond to zaps sent by a user.
   *
   * There is no direct indexed tag for the zap *sender* inside the
   * zap receipt (the description contains the original zap request), so
   * we fetch recent zap receipts and filter by the embedded zapRequest.pubkey.
   * This is best-effort and limited by the relay query limit.
   */
  async getZapsSentByUser(pubkey: string, limit = 200): Promise<Event[]> {
    try {
      // Fetch recent zap receipts (kind 9735) and filter those whose embedded
      // zap request was authored by the provided pubkey.
      const receipts = await this.accountRelay.getMany({
        kinds: [9735],
        authors: [pubkey],
        limit,
      });

      const sent: Event[] = [];

      for (const receipt of receipts) {
        try {
          const descriptionTag = receipt.tags.find(t => t[0] === 'description');
          if (!descriptionTag || !descriptionTag[1]) {
            continue;
          }

          const zapRequest = JSON.parse(descriptionTag[1]) as Event;
          if (zapRequest && zapRequest.pubkey === pubkey) {
            sent.push(receipt);
          }
        } catch (err) {
          // ignore parse errors for individual receipts
          this.logger.debug(
            'Failed to parse zap receipt description while filtering sent zaps',
            err
          );
        }
      }

      return sent;
    } catch (error) {
      this.logger.error('Error fetching zaps sent by user:', error as Error);
      return [];
    }
  }

  // Real-time subscription management
  private activeSubscriptions = new Map<string, { unsubscribe: () => void }>();
  private zapUpdates = signal<Event[]>([]);

  /**
   * Subscribe to real-time zap updates for an event
   */
  subscribeToEventZaps(eventId: string, onZapReceived: (zapReceipt: Event) => void): () => void {
    const subscriptionKey = `event-${eventId}`;

    // Don't create duplicate subscriptions
    if (this.activeSubscriptions.has(subscriptionKey)) {
      this.logger.debug(`Already subscribed to zaps for event ${eventId}`);
      const existing = this.activeSubscriptions.get(subscriptionKey);
      return existing
        ? existing.unsubscribe
        : () => this.logger.debug('Empty unsubscribe function called');
    }

    this.logger.debug(`Subscribing to real-time zaps for event ${eventId}`);

    const subscription = this.accountRelay.subscribe(
      [
        {
          kinds: [9735], // Zap receipts
          '#e': [eventId],
          since: Math.floor(Date.now() / 1000), // Only new zaps from now
        },
      ],
      (event: Event) => {
        this.logger.debug('Received new zap receipt for event:', event);
        onZapReceived(event);
      }
    );

    // Store subscription for cleanup with normalized interface
    const unsubscribeFn =
      subscription.unsubscribe ||
      subscription.close ||
      (() => {
        this.logger.debug('No unsubscribe method available');
      });
    this.activeSubscriptions.set(subscriptionKey, { unsubscribe: unsubscribeFn });

    // Return unsubscribe function
    return () => {
      this.logger.debug(`Unsubscribing from zaps for event ${eventId}`);
      unsubscribeFn();
      this.activeSubscriptions.delete(subscriptionKey);
    };
  }

  /**
   * Subscribe to real-time zap updates for a user
   */
  subscribeToUserZaps(pubkey: string, onZapReceived: (zapReceipt: Event) => void): () => void {
    const subscriptionKey = `user-${pubkey}`;

    // Don't create duplicate subscriptions
    if (this.activeSubscriptions.has(subscriptionKey)) {
      this.logger.debug(`Already subscribed to zaps for user ${pubkey}`);
      const existing = this.activeSubscriptions.get(subscriptionKey);
      return existing
        ? existing.unsubscribe
        : () => this.logger.debug('Empty unsubscribe function called');
    }

    this.logger.debug(`Subscribing to real-time zaps for user ${pubkey}`);

    const subscription = this.accountRelay.subscribe(
      [
        {
          kinds: [9735], // Zap receipts
          '#p': [pubkey],
          since: Math.floor(Date.now() / 1000), // Only new zaps from now
        },
      ],
      (event: Event) => {
        this.logger.debug('Received new zap receipt for user:', event);
        onZapReceived(event);
      }
    );

    // Store subscription for cleanup with normalized interface
    const unsubscribeFn =
      subscription.unsubscribe ||
      subscription.close ||
      (() => {
        this.logger.debug('No unsubscribe method available');
      });
    this.activeSubscriptions.set(subscriptionKey, { unsubscribe: unsubscribeFn });

    // Return unsubscribe function
    return () => {
      this.logger.debug(`Unsubscribing from zaps for user ${pubkey}`);
      unsubscribeFn();
      this.activeSubscriptions.delete(subscriptionKey);
    };
  }

  /**
   * Clean up all active subscriptions
   */
  cleanupSubscriptions(): void {
    this.logger.debug(`Cleaning up ${this.activeSubscriptions.size} zap subscriptions`);
    this.activeSubscriptions.forEach(subscription => {
      subscription.unsubscribe();
    });
    this.activeSubscriptions.clear();
  }

  /**
   * Process a received zap receipt for metrics tracking
   */
  processReceivedZapReceipt(zapReceipt: Event): void {
    try {
      // Extract amount from bolt11 invoice
      const bolt11Tags = zapReceipt.tags.filter(tag => tag[0] === 'bolt11');
      if (bolt11Tags.length === 1) {
        const bolt11Invoice = bolt11Tags[0][1];
        const amountMsats = this.getBolt11Amount(bolt11Invoice);
        if (amountMsats) {
          const amountSats = amountMsats / 1000;

          // Extract sender pubkey from description
          const senderPubkey = this.extractSenderFromZapReceipt(zapReceipt);

          // Extract event ID if this is an event zap
          const eventId = this.extractEventIdFromZapReceipt(zapReceipt);

          this.zapMetrics.recordZapReceived(amountSats, senderPubkey, eventId);
          this.logger.debug('Recorded received zap metrics', { amount: amountSats, senderPubkey });
        }
      }
    } catch (error) {
      this.logger.warn('Failed to process received zap receipt for metrics:', error);
    }
  }

  /**
   * Extract sender pubkey from zap receipt description
   */
  private extractSenderFromZapReceipt(zapReceipt: Event): string | undefined {
    try {
      const descriptionTags = zapReceipt.tags.filter(tag => tag[0] === 'description');
      if (descriptionTags.length === 1) {
        const zapRequest = JSON.parse(descriptionTags[0][1]);
        return zapRequest.pubkey;
      }
    } catch (error) {
      this.logger.warn('Failed to extract sender from zap receipt:', error);
    }
    return undefined;
  }

  /**
   * Generate Lightning invoice for manual payment without using NWC
   */
  async generateInvoiceForManualPayment(
    recipientPubkey: string,
    amount: number,
    message?: string,
    eventId?: string,
    recipientMetadata?: Record<string, unknown>
  ): Promise<string> {
    try {
      const amountMsats = amount * 1000;

      // Get recipient lightning address from metadata
      if (!recipientMetadata) {
        throw new Error('No metadata provided for recipient');
      }

      const lightningAddress = this.getLightningAddress(recipientMetadata);
      if (!lightningAddress) {
        throw new Error('No Lightning address found for recipient');
      }

      // Fetch LNURL-pay info
      const lnurlPayInfo = await this.fetchLnurlPayInfo(lightningAddress);

      // Validate amount
      if (amountMsats < lnurlPayInfo.minSendable || amountMsats > lnurlPayInfo.maxSendable) {
        throw new Error(
          `Amount must be between ${lnurlPayInfo.minSendable / 1000} and ${lnurlPayInfo.maxSendable / 1000} sats`
        );
      }

      // Validate comment length if provided
      if (message && message.trim()) {
        const commentAllowed = lnurlPayInfo.commentAllowed || 0;
        if (commentAllowed === 0) {
          throw new Error('Recipient does not allow comments with zaps');
        }
        if (message.trim().length > commentAllowed) {
          throw new Error(`Comment too long. Maximum ${commentAllowed} characters allowed.`);
        }
      }

      // Convert lightning address to LNURL for the request
      const lnurl = this.lightningAddressToLnurl(lightningAddress);

      // Create zap request
      const zapRequest = await this.createZapRequest(
        recipientPubkey,
        amountMsats,
        message,
        eventId,
        lnurl
      );

      // Sign the zap request
      const signedZapRequest = await this.nostr.signEvent(zapRequest);

      // Request invoice from LNURL service
      const zapPayment = await this.requestZapInvoice(
        signedZapRequest,
        lnurlPayInfo.callback,
        amountMsats,
        message
      );

      return zapPayment.pr;
    } catch (error) {
      this.logger.error('Failed to generate invoice for manual payment:', error);
      throw error;
    }
  }

  /**
   * Extract event ID from zap receipt description
   */
  private extractEventIdFromZapReceipt(zapReceipt: Event): string | undefined {
    try {
      const descriptionTags = zapReceipt.tags.filter(tag => tag[0] === 'description');
      if (descriptionTags.length === 1) {
        const zapRequest = JSON.parse(descriptionTags[0][1]);
        const eTags = zapRequest.tags?.filter((tag: string[]) => tag[0] === 'e');
        if (eTags && eTags.length > 0) {
          return eTags[0][1];
        }
      }
    } catch (error) {
      this.logger.warn('Failed to extract event ID from zap receipt:', error);
    }
    return undefined;
  }
}
