import { inject, Injectable } from '@angular/core';
import { DataService } from './data.service';
import { nip19 } from 'nostr-tools';
import { ProfilePointer } from 'nostr-tools/nip19';
import { NostrService } from './nostr.service';
import { StorageService } from './storage.service';
import { NostrRecord } from '../interfaces';
import { UtilitiesService } from './utilities.service';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root'
})
export class ParsingService {
  data = inject(DataService);
  nostr = inject(NostrService);
  storage = inject(StorageService);
  utilities = inject(UtilitiesService);
  logger = inject(LoggerService);

  // Cache for parsed nostr URIs to prevent repeated parsing
  private nostrUriCache = new Map<string, { type: string, data: any, displayName: string } | null>();
  
  // Map to track pending nostr URI parsing to prevent race conditions
  private pendingNostrUriRequests = new Map<string, Promise<{ type: string, data: any, displayName: string } | null>>();

  constructor() { 
    // Clean up cache periodically to prevent memory leaks
    setInterval(() => {
      if (this.nostrUriCache.size > 500) {
        this.logger.debug(`Parsing service cache size: ${this.nostrUriCache.size}. Consider clearing if too large.`);
        // Optionally clear cache if it gets too large
        if (this.nostrUriCache.size > 1000) {
          this.clearNostrUriCache();
          this.logger.info('Cleared nostr URI cache due to size limit');
        }
      }
    }, 60000); // Check every minute
  }

  async parseNostrUri(uri: string): Promise<{ type: string, data: any, displayName: string } | null> {
    // Check cache first
    if (this.nostrUriCache.has(uri)) {
      return this.nostrUriCache.get(uri)!;
    }

    // Check if there's already a pending request for this URI
    if (this.pendingNostrUriRequests.has(uri)) {
      return this.pendingNostrUriRequests.get(uri)!;
    }

    // Create and store the promise to prevent race conditions
    const parsePromise = this.parseNostrUriInternal(uri);
    this.pendingNostrUriRequests.set(uri, parsePromise);

    try {
      const result = await parsePromise;
      // Cache the result
      this.nostrUriCache.set(uri, result);
      return result;
    } finally {
      // Always clean up the pending request
      this.pendingNostrUriRequests.delete(uri);
    }
  }

  private async parseNostrUriInternal(uri: string): Promise<{ type: string, data: any, displayName: string } | null> {
    try {
      // Use the proper nip19 function for decoding nostr URIs
      const decoded = nip19.decodeNostrURI(uri);

      if (!decoded) return null;

      let displayName = '';
      let pubkey = '';
      let metadata: NostrRecord | undefined;

      if (decoded.type === 'nprofile') {
        pubkey = (decoded.data as ProfilePointer).pubkey;
      }
      else if (decoded.type === 'npub') {
        pubkey = decoded.data;
      }

      if (pubkey) {
        metadata = await this.data.getProfile(pubkey);

        if (metadata) {
          displayName = metadata.data.display_name || metadata.data.name || this.utilities.getTruncatedNpub(pubkey);
        } else {
          // Fallback to truncated pubkey if no metadata found
          displayName = this.utilities.getTruncatedNpub(pubkey);
        }
      } else {
        displayName = this.getDisplayNameFromNostrUri(decoded.type, decoded.data);
      }

      return {
        type: decoded.type,
        data: decoded.data,
        displayName: displayName
      };
    } catch (error) {
      this.logger.warn(`Failed to parse nostr URI: ${uri}`, error);
      return null;
    }
  }

  private getDisplayNameFromNostrUri(type: string, data: any): string {
    switch (type) {
      case 'npub':
        return this.utilities.getTruncatedNpub(data);
      case 'nprofile':
        return this.utilities.getTruncatedNpub(data.pubkey);
      case 'note':
        return `note${data.substring(0, 8)}...`;
      case 'nevent':
        return `event${data.id.substring(0, 8)}...`;
      case 'naddr':
        return `${data.kind}:${data.identifier?.substring(0, 8) || 'addr'}...`;
      default:
        return type;
    }
  }

  isNostrUri(text: string): boolean {
    return text.startsWith('nostr:') && text.length > 6;
  }

  extractNostrUriIdentifier(uri: string): string {
    return uri.replace(/^nostr:/, '');
  }

  /**
   * Clear the nostr URI cache to free memory
   */
  clearNostrUriCache(): void {
    this.nostrUriCache.clear();
    this.pendingNostrUriRequests.clear();
  }

  /**
   * Get cache size for debugging
   */
  getNostrUriCacheSize(): number {
    return this.nostrUriCache.size;
  }

}
