import { Injectable, inject } from '@angular/core';
import { Event, UnsignedEvent, nip19 } from 'nostr-tools';
import { NostrService } from './nostr.service';
import { AccountStateService } from './account-state.service';
import { RelaysService } from './relays/relays';
import { Wallets } from './wallets';
import { LoggerService } from './logger.service';
import { AccountRelayService } from './relays/account-relay';

interface LnurlPayResponse {
  callback: string;
  maxSendable: number;
  minSendable: number;
  metadata: string;
  allowsNostr?: boolean;
  nostrPubkey?: string;
}

interface ZapPayment {
  pr: string; // bolt11 invoice
  routes?: unknown[];
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

  // Cache for LNURL pay endpoints
  private lnurlCache = new Map<string, LnurlPayResponse>();

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

    const url = `https://${domain}/.well-known/lnurlp/${username}`;
    const urlBytes = new TextEncoder().encode(url);
    const lnurl = this.bech32Encode('lnurl', urlBytes);
    return lnurl;
  }

  /**
   * Simple bech32 encoding for LNURL
   */
  private bech32Encode(hrp: string, data: Uint8Array): string {
    // This is a simplified implementation - in production you'd use a proper bech32 library
    const words = this.convertBits(data, 8, 5, true);
    if (!words) throw new Error('Invalid data for bech32 encoding');

    // For simplicity, we'll return the original URL for now
    // In a real implementation, you'd do proper bech32 encoding
    return (
      hrp +
      '1' +
      Array.from(words)
        .map((w) => String.fromCharCode(97 + w))
        .join('')
    );
  }

  private convertBits(
    data: Uint8Array,
    fromBits: number,
    toBits: number,
    pad: boolean,
  ): Uint8Array | null {
    let acc = 0;
    let bits = 0;
    const ret: number[] = [];
    const maxv = (1 << toBits) - 1;
    const maxAcc = (1 << (fromBits + toBits - 1)) - 1;

    for (const value of data) {
      if (value < 0 || value >> fromBits !== 0) {
        return null;
      }
      acc = ((acc << fromBits) | value) & maxAcc;
      bits += fromBits;
      while (bits >= toBits) {
        bits -= toBits;
        ret.push((acc >> bits) & maxv);
      }
    }

    if (pad) {
      if (bits > 0) {
        ret.push((acc << (toBits - bits)) & maxv);
      }
    } else if (bits >= fromBits || (acc << (toBits - bits)) & maxv) {
      return null;
    }

    return new Uint8Array(ret);
  }

  /**
   * Fetch LNURL pay endpoint info
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
    relays: string[] = [],
  ): Promise<UnsignedEvent> {
    const currentUser = this.accountState.account();
    if (!currentUser) {
      throw new Error('No user account available for zapping');
    }

    // Use default relays if none provided
    if (relays.length === 0) {
      const defaultRelays = this.relayService.getConnectedRelays();
      if (Array.isArray(defaultRelays)) {
        relays = defaultRelays;
      }
    }

    const tags: string[][] = [
      ['relays', ...relays],
      ['amount', amount.toString()],
      ['p', recipientPubkey],
    ];

    if (lnurl) {
      tags.push(['lnurl', lnurl]);
    }

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
    lnurl: string,
  ): Promise<ZapPayment> {
    try {
      const encodedZapRequest = encodeURIComponent(JSON.stringify(zapRequest));
      const requestUrl = `${callbackUrl}?amount=${amount}&nostr=${encodedZapRequest}&lnurl=${lnurl}`;

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
   * Pay a lightning invoice using NWC
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async payInvoice(invoice: string): Promise<{ preimage: string; fees_paid?: number }> {
    try {
      const availableWallets = this.wallets.wallets();
      const walletEntries = Object.entries(availableWallets);

      if (walletEntries.length === 0) {
        throw new Error('No wallets connected. Please connect a wallet first.');
      }

      // For now, use the first available wallet
      // TODO: Allow user to select which wallet to use
      const [, wallet] = walletEntries[0];
      const connectionString = wallet.connections[0];

      // Parse the connection string to get wallet details
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const connectionData = this.wallets.parseConnectionString(connectionString);

      // TODO: Implement proper NIP-44 encryption and NWC communication
      // For now, throw an error indicating this needs to be implemented
      throw new Error(
        'NWC payment integration needs to be completed. Please pay the invoice manually.',
      );
    } catch (error) {
      this.logger.error('Failed to pay invoice via NWC:', error);
      throw error;
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
  ): Promise<void> {
    try {
      this.logger.info('Starting zap process', { recipientPubkey, amount, eventId });

      // Convert sats to millisats
      const amountMsats = amount * 1000;

      // Get lightning address from metadata
      if (!recipientMetadata) {
        throw new Error('Recipient metadata required for zapping');
      }

      const lightningAddress = this.getLightningAddress(recipientMetadata);
      if (!lightningAddress) {
        throw new Error('Recipient has no lightning address configured');
      }

      // Fetch LNURL pay info
      const lnurlPayInfo = await this.fetchLnurlPayInfo(lightningAddress);

      // Check if recipient supports Nostr zaps
      if (!lnurlPayInfo.allowsNostr || !lnurlPayInfo.nostrPubkey) {
        throw new Error('Recipient does not support Nostr zaps');
      }

      // Validate amount is within bounds
      if (amountMsats < lnurlPayInfo.minSendable || amountMsats > lnurlPayInfo.maxSendable) {
        throw new Error(
          `Amount must be between ${lnurlPayInfo.minSendable / 1000} and ${lnurlPayInfo.maxSendable / 1000} sats`,
        );
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
      );

      // Sign the zap request
      const signedZapRequest = await this.nostr.signEvent(zapRequest);

      // Request invoice from LNURL service
      const zapPayment = await this.requestZapInvoice(
        signedZapRequest,
        lnurlPayInfo.callback,
        amountMsats,
        lnurl,
      );

      // Pay the invoice
      await this.payInvoice(zapPayment.pr);

      this.logger.info('Zap completed successfully');
    } catch (error) {
      this.logger.error('Failed to send zap:', error as Error);
      throw error;
    }
  }

  /**
   * Validate a zap receipt
   */
  validateZapReceipt(
    zapReceipt: Event,
    expectedRecipientPubkey: string,
    lnurlPayInfo?: LnurlPayResponse,
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
      const pTags = zapReceipt.tags.filter((tag) => tag[0] === 'p');
      const descriptionTags = zapReceipt.tags.filter((tag) => tag[0] === 'description');
      const bolt11Tags = zapReceipt.tags.filter((tag) => tag[0] === 'bolt11');

      if (pTags.length !== 1 || descriptionTags.length !== 1 || bolt11Tags.length !== 1) {
        return false;
      }

      // Check if the zap is for the expected recipient
      if (pTags[0][1] !== expectedRecipientPubkey) {
        return false;
      }

      // TODO: Validate the bolt11 invoice and description hash
      // TODO: Parse and validate the zap request from the description tag

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
      const descriptionTag = zapReceipt.tags.find((tag) => tag[0] === 'description');
      if (!descriptionTag || !descriptionTag[1]) {
        return { zapRequest: null, amount: null, comment: '' };
      }

      // Parse the zap request from the description
      const zapRequest = JSON.parse(descriptionTag[1]) as Event;

      // Extract amount from bolt11 invoice
      const bolt11Tag = zapReceipt.tags.find((tag) => tag[0] === 'bolt11');
      let amount: number | null = null;

      if (bolt11Tag && bolt11Tag[1]) {
        // TODO: Parse bolt11 invoice to extract amount
        // For now, try to get it from the zap request
        const amountTag = zapRequest.tags.find((tag) => tag[0] === 'amount');
        if (amountTag && amountTag[1]) {
          amount = parseInt(amountTag[1]) / 1000; // Convert msats to sats
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
}
