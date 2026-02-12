import { Pipe, PipeTransform, inject } from '@angular/core';
import { nip19 } from 'nostr-tools';
import { DataService } from '../services/data.service';
import { UtilitiesService } from '../services/utilities.service';

/**
 * Pipe to resolve nostr: identifiers (nprofile, nevent, npub, note) to readable text
 * Used for notification messages to show display names instead of raw identifiers
 * 
 * This pipe performs async operations but returns synchronous results using cached data
 * It triggers background loading for profiles/events that aren't cached yet
 */
@Pipe({
  name: 'resolveNostr',
  pure: false, // Not pure because it depends on async data that may load over time
})
export class ResolveNostrPipe implements PipeTransform {
  private dataService = inject(DataService);
  private utilities = inject(UtilitiesService);

  transform(text: string): string {
    if (!text) return '';

    // Regex to match nostr: identifiers
    const nostrRegex = /(nostr:(?:npub|nprofile|note|nevent)1[a-zA-Z0-9]+)/g;
    
    // Use replace with a function to handle all occurrences
    return text.replace(nostrRegex, (match) => {
      return this.resolveNostrUri(match);
    });
  }

  private resolveNostrUri(uri: string): string {
    try {
      // Remove the nostr: prefix
      const identifier = uri.replace('nostr:', '');
      const decoded = nip19.decode(identifier);

      switch (decoded.type) {
        case 'npub':
        case 'nprofile': {
          const pubkey = decoded.type === 'npub' 
            ? decoded.data as string 
            : (decoded.data as nip19.ProfilePointer).pubkey;
          
          // Try to get cached profile synchronously
          const profile = this.dataService.getCachedProfile(pubkey);
          
          if (profile?.data) {
            const displayName = profile.data.display_name || profile.data.name;
            if (displayName) {
              return `@${displayName}`;
            }
          }
          
          // If not cached, trigger async load for next render
          // Use queueMicrotask to avoid triggering during change detection
          queueMicrotask(() => {
            this.dataService.getProfile(pubkey).catch(() => {
              // Ignore errors - profile will just show as truncated npub
            });
          });
          
          // Return truncated npub as fallback
          // Convert pubkey to npub format for truncation
          try {
            const npub = nip19.npubEncode(pubkey);
            return `@${this.utilities.getTruncatedNpub(npub)}`;
          } catch {
            // If encoding fails, use generic fallback
            return `@${pubkey.substring(0, 8)}...`;
          }
        }

        case 'note':
        case 'nevent': {
          const eventId = decoded.type === 'note' 
            ? decoded.data as string 
            : (decoded.data as nip19.EventPointer).id;
          
          // For events, just show a truncated ID
          // Full event preview would be too complex for notifications
          return `note:${eventId.substring(0, 8)}...`;
        }

        default:
          return uri;
      }
    } catch {
      // If parsing fails (e.g., truncated or malformed URI), show a short placeholder
      // instead of the raw long nostr: URI
      const identifier = uri.replace('nostr:', '');
      if (identifier.startsWith('npub1') || identifier.startsWith('nprofile1')) {
        return `@${identifier.substring(0, 12)}...`;
      }
      if (identifier.startsWith('note1') || identifier.startsWith('nevent1')) {
        return `note:${identifier.substring(0, 12)}...`;
      }
      return uri;
    }
  }
}
