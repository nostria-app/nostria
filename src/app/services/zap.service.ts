import { Injectable, inject, signal } from '@angular/core';
import { Event, UnsignedEvent, nip19, nip57 } from 'nostr-tools';
import { LN } from '@getalby/sdk';
import { NostrService } from './nostr.service';
import { AccountStateService } from './account-state.service';
import { RelaysService } from './relays/relays';
import { Wallets } from './wallets';
import { LoggerService } from './logger.service';
import { AccountRelayService } from './relays/account-relay';
import { DiscoveryRelayService } from './relays/discovery-relay';
import { ZapMetricsService } from './zap-metrics.service';
import { UtilitiesService } from './utilities.service';
import { DataService } from './data.service';
import { NostrRecord } from '../interfaces';

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

export interface GiftPremiumData {
  receiver: string;
  message: string;
  subscription: 'premium' | 'premium-plus';
  duration: 1 | 3;
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
  private discoveryRelay = inject(DiscoveryRelayService);
  private zapMetrics = inject(ZapMetricsService);
  private utilities = inject(UtilitiesService);
  private dataService = inject(DataService);

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
      'insufficient funds', // Don't retry on insufficient funds
      'insufficient balance', // Alternative wording
    ];

    return nonRecoverableMessages.some(msg => message.includes(msg));
  }

  /**
   * Enhance error with more context
   */
  private enhanceError(error: Error): ZapError {
    const message = error.message.toLowerCase();

    if (message.includes('insufficient funds') || message.includes('insufficient balance')) {
      // Extract amount details if present in the error message
      const match = error.message.match(/⚡️(\d+)\s*\/\s*(\d+)/);
      if (match) {
        const [, available, required] = match;
        return this.createZapError(
          'INSUFFICIENT_FUNDS',
          `Insufficient funds. Available: ${available} sats, Required: ${required} sats`,
          false
        );
      }
      return this.createZapError(
        'INSUFFICIENT_FUNDS',
        'Insufficient funds in your wallet. Please add more funds and try again.',
        false
      );
    }

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
   * Get the recipient's relay URLs for including in zap requests
   * The Lightning service provider needs these to know where to publish the zap receipt
   */
  async getRecipientRelays(recipientPubkey: string): Promise<string[]> {
    try {
      // Try to get relay list event (kind 10002) for the recipient with timeout
      // Use discoveryRelay to query for other users' data
      const relayListPromise = this.discoveryRelay.getMany({
        kinds: [10002], // NIP-65 relay list
        authors: [recipientPubkey],
        limit: 1,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout fetching relay list')), 3000)
      );

      let relayListEvents: Event[] = [];
      try {
        relayListEvents = await Promise.race([relayListPromise, timeoutPromise]);
      } catch {
        relayListEvents = [];
      }

      if (relayListEvents.length > 0) {
        const relays = this.utilities.getRelayUrls(relayListEvents[0]);
        if (relays.length > 0) {
          this.logger.debug('Found relay list for recipient:', relays.slice(0, 5));
          return relays.slice(0, 10); // Limit to 10 relays
        }
      }

      // Fallback: Try to get contacts event (kind 3) which may contain relay info
      // Use discoveryRelay to query for other users' data
      const contactsPromise = this.discoveryRelay.getMany({
        kinds: [3], // Contacts list
        authors: [recipientPubkey],
        limit: 1,
      });

      let contactsEvents: Event[] = [];
      try {
        contactsEvents = await Promise.race([contactsPromise,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
        ]);
      } catch {
        contactsEvents = [];
      }

      if (contactsEvents.length > 0) {
        const relays = this.utilities.getRelayUrlsFromFollowing(contactsEvents[0]);
        if (relays.length > 0) {
          this.logger.debug('Found relays from contacts for recipient:', relays.slice(0, 5));
          return relays.slice(0, 10); // Limit to 10 relays
        }
      }

      // Last resort: Use sender's relays as fallback
      this.logger.warn('Could not find recipient relays, using sender relays as fallback');
      const connectedRelays = this.relayService.getConnectedRelays();
      if (Array.isArray(connectedRelays)) {
        return connectedRelays.slice(0, 5);
      }

      // Absolute fallback: Use common relays
      return ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.snort.social'];
    } catch (error) {
      this.logger.error('Error fetching recipient relays:', error);
      // Return fallback relays on error
      const connectedRelays = this.relayService.getConnectedRelays();
      if (Array.isArray(connectedRelays)) {
        return connectedRelays.slice(0, 5);
      }
      return ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.snort.social'];
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
    relays: string[] = [],
    goalEventId?: string,
    eventKind?: number,
    eventAddress?: string // Added eventAddress for addressable events (a tag)
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

    if (eventAddress) {
      // For addressable events (like streams), use the "a" tag instead of "e" tag
      tags.push(['a', eventAddress]);
      // Add the kind tag for addressable events
      if (eventKind !== undefined) {
        tags.push(['k', eventKind.toString()]);
      }
      // For addressable events with a zap goal, only add the goal's "e" tag
      if (goalEventId) {
        tags.push(['e', goalEventId]);
      }
    } else {
      // For non-addressable events, use the "e" tag as before
      if (eventId) {
        tags.push(['e', eventId]);
        // Add the kind of the target event if provided, otherwise default to 1 (text note)
        if (eventKind !== undefined) {
          tags.push(['k', eventKind.toString()]);
        } else {
          tags.push(['k', '1']);
        }
      }
      // Add goal event ID for non-addressable events
      if (goalEventId) {
        tags.push(['e', goalEventId]);
      }
    }

    const zapRequest: UnsignedEvent = {
      kind: 9734,
      content: message,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      pubkey: currentUser.pubkey,
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
   * Parse zap split tags from an event (NIP-57 Appendix G)
   * Returns array of recipients with their pubkeys, relays, and weights
   */
  parseZapSplits(event: Event): { pubkey: string; relay: string; weight: number }[] {
    const zapTags = event.tags.filter(tag => tag[0] === 'zap' && tag.length >= 3);

    if (zapTags.length === 0) {
      return [];
    }

    const splits = zapTags.map(tag => ({
      pubkey: tag[1],
      relay: tag[2] || '',
      weight: tag[3] ? parseFloat(tag[3]) : 0
    }));

    // Check if all weights are present
    const allHaveWeights = splits.every(s => s.weight > 0);
    const someHaveWeights = splits.some(s => s.weight > 0);

    // If weights are only partially present, set missing weights to 0 (don't zap)
    // If no weights are present, divide equally
    if (!someHaveWeights) {
      // No weights specified - divide equally
      const equalWeight = 1 / splits.length;
      splits.forEach(s => s.weight = equalWeight);
    } else if (!allHaveWeights) {
      // Partial weights - recipients without weights get 0
      splits.forEach(s => {
        if (s.weight === 0) {
          s.weight = 0;
        }
      });
    }

    // Filter out zero-weight recipients
    const activeRecipients = splits.filter(s => s.weight > 0);

    // Normalize weights to percentages
    const totalWeight = activeRecipients.reduce((sum, s) => sum + s.weight, 0);
    if (totalWeight > 0) {
      activeRecipients.forEach(s => s.weight = s.weight / totalWeight);
    }

    return activeRecipients;
  }

  /**
   * Send a zap with splits to multiple recipients (NIP-57 Appendix G)
   * This handles events that have zap tags specifying split payments
   */
  async sendSplitZap(
    event: Event,
    totalAmount: number, // Total amount in sats to split among recipients
    message = ''
  ): Promise<void> {
    const splits = this.parseZapSplits(event);

    if (splits.length === 0) {
      throw new Error('No valid zap split recipients found in event');
    }

    this.logger.info(`Sending split zap to ${splits.length} recipients`, {
      totalAmount,
      splits: splits.map(s => ({ pubkey: s.pubkey.substring(0, 8), weight: s.weight }))
    });

    // Calculate individual amounts (rounding to nearest sat)
    const splitPayments = splits.map(split => ({
      ...split,
      amount: Math.round(totalAmount * split.weight)
    }));

    // Ensure we're not losing sats due to rounding - adjust the largest recipient
    const totalCalculated = splitPayments.reduce((sum, p) => sum + p.amount, 0);
    if (totalCalculated !== totalAmount) {
      const difference = totalAmount - totalCalculated;
      const largestRecipient = splitPayments.reduce((max, p) => p.amount > max.amount ? p : max);
      largestRecipient.amount += difference;
    }

    // Fetch metadata for all recipients in parallel with timeout
    const metadataPromises = splitPayments.map(async payment => {
      try {
        const timeoutPromise = new Promise<NostrRecord | undefined>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout fetching profile')), 5000)
        );
        const profilePromise = this.dataService.getProfile(payment.pubkey);
        const profile = await Promise.race([profilePromise, timeoutPromise]);
        return {
          ...payment,
          metadata: profile?.data || null
        };
      } catch (error) {
        this.logger.warn(`Failed to get metadata for split recipient ${payment.pubkey}`, error);
        return {
          ...payment,
          metadata: null
        };
      }
    });

    const paymentsWithMetadata = await Promise.all(metadataPromises);

    // Filter out recipients without lightning addresses
    const validPayments = paymentsWithMetadata.filter(p => {
      if (!p.metadata) {
        this.logger.warn(`Skipping split recipient ${p.pubkey} - no metadata`);
        return false;
      }
      const lightningAddress = this.getLightningAddress(p.metadata);
      if (!lightningAddress) {
        this.logger.warn(`Skipping split recipient ${p.pubkey} - no lightning address`);
        return false;
      }
      return true;
    });

    if (validPayments.length === 0) {
      throw new Error('No recipients have valid lightning addresses configured');
    }

    // Send zaps to all recipients in parallel with timeout
    const zapPromises = validPayments.map(async (payment) => {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout sending zap to ${payment.pubkey}`)), 30000)
      );

      const zapPromise = this.sendZap(
        payment.pubkey,
        payment.amount,
        message,
        event.id,
        payment.metadata!,
        payment.relay ? [payment.relay] : undefined,
        undefined, // goalEventId
        event.kind // eventKind
      );

      try {
        await Promise.race([zapPromise, timeoutPromise]);
        return true;
      } catch (error) {
        // Log error but don't fail the entire split zap
        this.logger.error(`Failed to send split zap to ${payment.pubkey}`, error);
        return null;
      }
    });

    const results = await Promise.all(zapPromises);
    const successCount = results.filter(r => r !== null).length;

    if (successCount === 0) {
      throw new Error('All split zap payments failed');
    }

    if (successCount < validPayments.length) {
      this.logger.warn(`Only ${successCount}/${validPayments.length} split zaps succeeded`);
    } else {
      this.logger.info(`Successfully sent split zap to ${successCount} recipients`);
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
    recipientMetadata?: Record<string, unknown>,
    customRelays?: string[], // Optional: custom relays for the zap request (e.g., for gift subscriptions)
    goalEventId?: string, // Optional: NIP-75 goal event ID
    eventKind?: number, // Optional: Event kind for the zap request
    eventAddress?: string // Optional: Addressable event tag (a tag)
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
            // If commentAllowed is 0, it usually means not allowed.
            // However, some providers might not return this field correctly.
            // We will only warn in logs but allow the zap to proceed if the user forced it (which they can do in the UI).
            // The LNURL service will reject it if it's truly not allowed.

            if (commentAllowed > 0 && message.trim().length > commentAllowed) {
              // Only enforce length limit if it's explicitly set and greater than 0
              throw new Error(`Comment too long. Maximum ${commentAllowed} characters allowed.`);
            }
          }

          // Convert lightning address to LNURL for the request
          const lnurl = this.lightningAddressToLnurl(lightningAddress);

          // Fetch recipient's relays so the Lightning service knows where to publish the zap receipt
          // Use custom relays if provided (for gift subscriptions), otherwise fetch recipient's relays
          const recipientRelays = customRelays || await this.getRecipientRelays(recipientPubkey);
          this.logger.debug('Recipient relays for zap request:', recipientRelays);

          // Create zap request (usually succeeds, so no retry needed)
          const zapRequest = await this.createZapRequest(
            recipientPubkey,
            amountMsats,
            message,
            eventId,
            lnurl,
            recipientRelays,
            goalEventId,
            eventKind,
            eventAddress
          );

          // Sign the zap request
          const signedZapRequest = await this.nostr.signEvent(zapRequest);

          // Publish the zap request to relays so it can be queried later
          // This allows the user to see their sent zaps in history
          try {
            await this.accountRelay.publish(signedZapRequest);
            this.logger.debug('Published zap request to relays:', signedZapRequest.id);
          } catch (publishError) {
            // Don't fail the zap if publishing fails - the payment can still proceed
            this.logger.warn('Failed to publish zap request to relays:', publishError);
          }

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
      // The description may contain unescaped newlines, so we need to handle that
      let descriptionJson = descriptionTag[1];

      // Try to parse as-is first
      let zapRequest: Event;
      try {
        zapRequest = JSON.parse(descriptionJson) as Event;
      } catch (firstError) {
        // If parsing fails, try to fix common issues with control characters
        // Replace literal newlines in content strings with escaped newlines
        try {
          // This is a heuristic approach: find the content field and escape newlines within it
          descriptionJson = descriptionJson.replace(
            /"content":"([^"]*)"/g,
            (match, content) => {
              const escapedContent = content
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t');
              return `"content":"${escapedContent}"`;
            }
          );
          zapRequest = JSON.parse(descriptionJson) as Event;
          this.logger.debug('Successfully parsed zap request after escaping control characters');
        } catch (secondError) {
          this.logger.error('Failed to parse zap receipt description after attempting fixes:', secondError);
          throw firstError; // Throw the original error for clarity
        }
      }

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
      this.logger.debug(`Fetching zap receipts for user: ${pubkey}`);

      // Query for zap receipts (kind 9735) that reference this user
      // Remove limit to get all zaps
      const zapReceipts = await this.accountRelay.getMany({
        kinds: [9735],
        '#p': [pubkey],
      });

      this.logger.debug(`Found ${zapReceipts.length} zap receipts for user`);

      // If we got no results, try logging more details
      if (zapReceipts.length === 0) {
        this.logger.warn(`No zap receipts found for pubkey ${pubkey}. Check if:
          1. The user has received any zaps
          2. The relays have the zap receipt events
          3. The events have the proper #p tag`);
      }

      return zapReceipts;
    } catch (error) {
      this.logger.error('Error fetching zaps for user:', error as Error);
      return [];
    }
  }

  /**
   * Get zap receipts that correspond to zaps sent by a user.
   *
   * Strategy: Query zap receipts (kind 9735) with uppercase 'P' tag matching the sender's pubkey.
   * According to NIP-57:
   * - lowercase 'p' tag = recipient pubkey
   * - uppercase 'P' tag = sender pubkey (from the zap request)
   */
  async getZapsSentByUser(pubkey: string): Promise<Event[]> {
    try {
      this.logger.debug(`Fetching sent zaps with sender pubkey (P tag): ${pubkey}`);

      // Query for zap receipts where the uppercase 'P' tag matches the sender
      // Use type assertion to allow uppercase P tag (nostr-tools types don't include it)
      const receipts = await this.accountRelay.getMany({
        kinds: [9735], // Zap receipt kind
        '#P': [pubkey], // Uppercase P = sender pubkey
      } as unknown as Parameters<typeof this.accountRelay.getMany>[0]);

      this.logger.debug(`Found ${receipts.length} sent zap receipts for user`);

      // Log sample receipt for debugging
      if (receipts.length > 0) {
        this.logger.debug('Sample sent zap receipt:', {
          id: receipts[0].id,
          pubkey: receipts[0].pubkey,
          pTags: receipts[0].tags.filter(t => t[0] === 'p' || t[0] === 'P'),
        });
      }

      return receipts;
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
      {
        kinds: [9735], // Zap receipts
        '#e': [eventId],
        since: Math.floor(Date.now() / 1000), // Only new zaps from now
      },
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
      {
        kinds: [9735], // Zap receipts
        '#p': [pubkey],
        since: Math.floor(Date.now() / 1000), // Only new zaps from now
      },
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
    recipientMetadata?: Record<string, unknown>,
    eventKind?: number,
    eventAddress?: string
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
        // Relaxed validation to allow overrides
        if (commentAllowed > 0 && message.trim().length > commentAllowed) {
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
        lnurl,
        [], // relays
        undefined, // goalEventId
        eventKind,
        eventAddress
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

  /**
   * Send a gift premium zap with custom JSON content
   */
  async sendGiftPremiumZap(
    recipientPubkey: string,
    amount: number, // in sats
    giftData: GiftPremiumData,
    recipientMetadata?: Record<string, unknown>
  ): Promise<void> {
    try {
      // Validate recipient has lightning address
      if (!recipientMetadata) {
        throw new Error('No recipient metadata available');
      }

      const lightningAddress = this.getLightningAddress(recipientMetadata);
      if (!lightningAddress) {
        throw new Error('Recipient has no Lightning address');
      }

      // Validate gift data
      if (giftData.receiver !== recipientPubkey) {
        throw new Error('Gift receiver does not match recipient pubkey');
      }

      if (giftData.message.length > 100) {
        throw new Error('Gift message exceeds 100 character limit');
      }

      // Serialize gift data to JSON string for zap content
      const zapContent = JSON.stringify(giftData);

      this.logger.debug('Sending gift premium zap:', {
        recipient: recipientPubkey,
        amount: amount,
        subscription: giftData.subscription,
        duration: giftData.duration,
      });

      // Use the standard sendZap method with the JSON content
      await this.sendZap(recipientPubkey, amount, zapContent, undefined, recipientMetadata);

      this.logger.info('Gift premium zap sent successfully');
    } catch (error) {
      this.logger.error('Failed to send gift premium zap:', error);
      throw error;
    }
  }

  /**
   * Parse gift premium data from zap receipt
   */
  parseGiftPremiumFromZap(zapReceipt: Event): GiftPremiumData | null {
    try {
      const parsed = this.parseZapReceipt(zapReceipt);
      if (!parsed.zapRequest) {
        return null;
      }

      const content = parsed.zapRequest.content;
      if (!content) {
        return null;
      }

      // Try new clear text format first (line-based, order is important)
      // Line 1: Gift type identifier (🎁 Nostria Premium Gift)
      // Line 2: Receiver pubkey
      // Line 3: Subscription type (premium or premium-plus)
      // Line 4: Duration in months (1 or 3)
      // Line 5+: Optional user message
      const lines = content.split('\n');

      if (lines.length >= 4 && lines[0] === '🎁 Nostria Premium Gift') {
        const receiver = lines[1];
        const subscription = lines[2] as 'premium' | 'premium-plus';
        const duration = parseInt(lines[3], 10) as 1 | 3;
        const message = lines.slice(4).join('\n'); // Join remaining lines as message

        // Validate the parsed data
        if (
          receiver &&
          (subscription === 'premium' || subscription === 'premium-plus') &&
          (duration === 1 || duration === 3)
        ) {
          return {
            receiver,
            subscription,
            duration,
            message: message || '',
          };
        }
      }

      // Fall back to old JSON format for backwards compatibility
      try {
        const giftData = JSON.parse(content) as GiftPremiumData;

        // Validate the structure
        if (
          typeof giftData.receiver === 'string' &&
          typeof giftData.message === 'string' &&
          (giftData.subscription === 'premium' || giftData.subscription === 'premium-plus') &&
          (giftData.duration === 1 || giftData.duration === 3)
        ) {
          return giftData;
        }
      } catch {
        // Not JSON, continue
      }

      return null;
    } catch {
      // Not a gift premium zap or invalid format
      return null;
    }
  }

  /**
   * Check if a zap receipt is a gift premium zap
   */
  isGiftPremiumZap(zapReceipt: Event): boolean {
    return this.parseGiftPremiumFromZap(zapReceipt) !== null;
  }

  /**
   * Get gift premium zaps received by a user
   */
  async getGiftPremiumZapsForUser(
    pubkey: string
  ): Promise<
    {
      zapReceipt: Event;
      giftData: GiftPremiumData;
      amount: number | null;
    }[]
  > {
    try {
      const allZaps = await this.getZapsForUser(pubkey);

      const giftZaps = allZaps
        .map(zapReceipt => {
          const giftData = this.parseGiftPremiumFromZap(zapReceipt);
          if (!giftData) {
            return null;
          }

          const parsed = this.parseZapReceipt(zapReceipt);
          return {
            zapReceipt,
            giftData,
            amount: parsed.amount,
          };
        })
        .filter(
          (
            item
          ): item is {
            zapReceipt: Event;
            giftData: GiftPremiumData;
            amount: number | null;
          } => item !== null
        );

      return giftZaps;
    } catch (error) {
      this.logger.error('Failed to get gift premium zaps for user:', error);
      return [];
    }
  }
}

