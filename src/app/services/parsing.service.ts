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

  constructor() { }

  async parseNostrUri(uri: string): Promise<{ type: string, data: any, displayName: string } | null> {
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
        metadata = await this.nostr.getMetadataForUser(pubkey);

        if (metadata) {
          displayName = metadata.data.display_name || metadata.data.name || this.utilities.getTruncatedNpub(pubkey);
        }
      } else {
        displayName = this.getDisplayNameFromNostrUri(decoded.type, decoded.data)
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

}
