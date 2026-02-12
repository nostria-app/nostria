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
    
    let result = text;
    let match: RegExpExecArray | null;
    
    // Reset regex state
    nostrRegex.lastIndex = 0;
    
    while ((match = nostrRegex.exec(text)) !== null) {
      const nostrUri = match[0];
      const replacement = this.resolveNostrUri(nostrUri);
      result = result.replace(nostrUri, replacement);
    }
    
    return result;
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
          // Use setTimeout to avoid triggering during change detection
          setTimeout(() => {
            this.dataService.getProfile(pubkey).catch(() => {
              // Ignore errors - profile will just show as truncated npub
            });
          }, 0);
          
          // Return truncated npub as fallback
          return `@${this.utilities.getTruncatedNpub(identifier)}`;
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
      // If parsing fails, return the original URI
      return uri;
    }
  }
}
