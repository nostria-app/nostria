import { inject, Injectable } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Event, nip19 } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { hexToBytes } from 'nostr-tools/utils';

@Injectable({
  providedIn: 'root'
})
export class UtilitiesService {
  private sanitizer = inject(DomSanitizer);
  private logger = inject(LoggerService);

  NIP05_REGEX = /^(?:([\w.+-]+)@)?([\w_-]+(\.[\w_-]+)+)$/
  regexpVideo = /(?:(?:https?)+\:\/\/+[a-zA-Z0-9\/\._-]{1,})+(?:(?:mp4|webm))/gi;
  regexpImage = /(?:(?:https?)+\:\/\/+[a-zA-Z0-9\/\._-]{1,})+(?:(?:jpe?g|png|gif|webp))/gi;
  regexpYouTube = /(?:https?:\/\/)?(?:www\.)?youtu\.?be(?:\.com)?\/?.*(?:watch|embed)?(?:.*v=|v\/|\/)([\w-_]+)/gim;
  regexpThisIsTheWay = /(?:thisistheway.gif)/g;
  regexpAlwaysHasBeen = /(?:alwayshasbeen.jpg)/g;
  regexpSpotify = /((http|https?)?(.+?\.?)(open.spotify.com)(.+?\.?)?)/gi;
  regexpTidal = /((http|https?)?(.+?\.?)(tidal.com)(.+?\.?)?)/gi;
  regexpUrl = /([\w+]+\:\/\/)?([\w\d-]+\.)*[\w-]+[\.\:]\w+([\/\?\=\&\#.]?[\w-]+)*\/?/gi;

  constructor() { }

  // Get d-tag value from an event
  getDTagValueFromEvent(event: Event): string | undefined {
    return this.getDTagValueFromTags(event.tags);
  }

  // Get all p-tag values from an event
  getPTagsValuesFromEvent(event: Event): string[] {
    return this.getPTagsValuesFromTags(event.tags);
  }

  // Get d-tag value
  getDTagValueFromTags(tags: string[][]): string | undefined {
    for (const tag of tags) {
      if (tag.length >= 2 && tag[0] === 'd') {
        return tag[1];
      }
    }
    return undefined;
  }

  // Get all p-tag values
  getPTagsValuesFromTags(tags: string[][]): string[] {
    const pTagValues: string[] = [];

    for (const tag of tags) {
      if (tag.length >= 2 && tag[0] === 'p') {
        pTagValues.push(tag[1]);
      }
    }

    return pTagValues;
  }

  getTagValues(tagName: string, tags: string[][]): string[] {
    const pTagValues: string[] = [];

    for (const tag of tags) {
      if (tag.length >= 2 && tag[0] === tagName) {
        pTagValues.push(tag[1]);
      }
    }

    return pTagValues;
  }

  sanitizeUrlAndBypass(url?: string) {
    const cleanedUrl = this.sanitizeUrl(url);
    return this.bypassUrl(cleanedUrl);
  }

  sanitizeUrlAndBypassFrame(url?: string) {
    const cleanedUrl = this.sanitizeUrl(url);
    return this.bypassFrameUrl(cleanedUrl);
  }

  sanitizeUrl(url?: string, appendHttpsIfMissing?: boolean) {
    if (!url) {
      return '';
    }

    if (!url?.startsWith('http')) {
      if (appendHttpsIfMissing) {
        url = 'https://' + url;
      } else {
        // Local file, maybe attempt at loading local scripts/etc?
        // Verify that the URL must start with /assets.
        if (url.startsWith('/assets')) {
          return url;
        } else {
          return '';
        }
      }
    }

    return url;
  }

  sanitizeImageUrl(url?: string) {
    url = this.sanitizeUrl(url);

    if (!url) {
      return undefined;
    }

    let urlLower = url.toLowerCase();
    urlLower = urlLower.split('?')[0]; // Remove the query part.

    if (urlLower.endsWith('jpg') || urlLower.endsWith('jpeg') || urlLower.endsWith('png') || urlLower.endsWith('webp') || urlLower.endsWith('gif')) {
      return url;
    }

    return undefined;
  }

  bypassUrl(url: string) {
    const clean = this.sanitizer.bypassSecurityTrustUrl(url);
    return clean;
  }

  bypassFrameUrl(url: string) {
    const clean = this.sanitizer.bypassSecurityTrustResourceUrl(url);
    return clean;
  }


  /** Parses the URLs and cleans up, ensuring only wss:// instances are returned. */
  getRelayUrlsFromFollowing(event: Event): string[] {
    // Check if event.content is a string, return empty array if it is
    if (!event.content || typeof event.content === 'string') {
      return [];
    }

    let relayUrls = Object.keys(event.content).map(url => {
      const wssIndex = url.indexOf('wss://');
      return wssIndex >= 0 ? url.substring(wssIndex) : url;
    });

    // Filter out timed out relays if timeouts parameter is true
    // if (timeouts) {
    //   const timedOutRelays = this.relayService.timeouts().map(relay => relay.url);
    //   relayUrls = relayUrls.filter(relay => !timedOutRelays.includes(this.relayService.normalizeRelayUrl(relay)));
    // }

    return relayUrls;
  }

  /** Parses the URLs and cleans up, ensuring only wss:// instances are returned. */
  getRelayUrls(event: Event): string[] {
    let relayUrls = event.tags
      .filter(tag => tag.length >= 2 && tag[0] === 'r')
      .map(tag => {
        const url = tag[1];
        const wssIndex = url.indexOf('wss://');
        return wssIndex >= 0 ? url.substring(wssIndex) : url;
      });

    // Filter out timed out relays if timeouts parameter is true
    // if (timeouts) {
    //   const timedOutRelays = this.relayService.timeouts().map(relay => relay.url);
    //   relayUrls = relayUrls.filter(relay => !timedOutRelays.includes(this.relayService.normalizeRelayUrl(relay)));
    // }

    return relayUrls;
  }


  /** This is an optimization we had to do to ensure that we have more success finding
   * the profile of users. Many users have a lot of relays, many which are long dead and gone.
   * Some have malformed URLs, private relays (required auth), etc.
   */
  preferredRelays: string[] = [
    'wss://relay.damus.io/',
    'wss://nos.lol/',
    'wss://relay.primal.net/',
    'wss://nostr.wine/',
    'wss://eden.nostr.land/',
    'wss://relay.snort.social/',
    'wss://relay.nostr.band/',
    'wss://nostr.oxtr.dev/',
    'wss://nostr.mom/',
  ];

  normalizeRelayUrls(urls: string[]): string[] {
    return urls.map(url => this.normalizeRelayUrl(url)).filter(url => url !== '');
  }


  /**
 * Normalizes relay URLs by ensuring root URLs have a trailing slash
 * but leaves URLs with paths unchanged
 */
  normalizeRelayUrl(url: string): string {
    try {
      if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
        return '';
      }

      const parsedUrl = new URL(url);

      // If the URL has no pathname (or just '/'), ensure it ends with a slash
      if (parsedUrl.pathname === '' || parsedUrl.pathname === '/') {
        // Add trailing slash if missing
        return url.endsWith('/') ? url : `${url}/`;
      }

      // URL already has a path, return as is
      return url;
    } catch (error) {
      debugger;
      // If URL parsing fails, return original URL
      this.logger.warn(`Failed to parse URL: ${url}`, error);
      return '';
    }
  }

  getTruncatedNpub(pubkey: string): string {
    const npub = this.getNpubFromPubkey(pubkey);
    return npub.length > 12
      ? `${npub.substring(0, 6)}...${npub.substring(npub.length - 6)}`
      : npub;
  }

  getNsecFromPrivkey(privkey: string): string {
    // Convert the hex private key to a Nostr secret key (nsec)
    const bytes = hexToBytes(privkey);
    const nsec = nip19.nsecEncode(bytes);
    return nsec;
  }

  getNpubFromPubkey(pubkey: string): string {
    // Convert the hex public key to a Nostr public key (npub)
    const npub = nip19.npubEncode(pubkey);
    return npub;
  }

  getPubkeyFromNpub(npub: string): string {
    // Convert the hex public key to a Nostr public key (npub)
    const result = nip19.decode(npub).data;
    return result as string;
  }

  isHex(value: string) {
    const isEncoded = value.startsWith('nprofile') ||
      value.startsWith('nevent') ||
      value.startsWith('naddr') ||
      value.startsWith('nsec') ||
      value.startsWith('npub') ||
      value.startsWith('note');

    return !isEncoded;
  }

  getHex(value: string) {
    if (this.isHex(value)) {
      return value;
    }

    const decoded = this.decode(value) as any;
    return decoded.data.id;
  }

  decode(value: string) {
    return nip19.decode(value);
  }

  parseNip05(nip05: string) {
    return nip05.startsWith('_@')
      ? nip05.substring(1)
      : nip05;
  }

  parseNostrUri(uri: string): { type: string; data: any; displayName?: string } | null {
    try {
      // Use the proper nip19 function for decoding nostr URIs
      const decoded = nip19.decodeNostrURI(uri);

      if (!decoded) return null;

      return {
        type: decoded.type,
        data: decoded.data,
        displayName: this.getDisplayNameFromNostrUri(decoded.type, decoded.data)
      };
    } catch (error) {
      this.logger.warn(`Failed to parse nostr URI: ${uri}`, error);
      return null;
    }
  }

  private getDisplayNameFromNostrUri(type: string, data: any): string {
    switch (type) {
      case 'npub':
        return this.getTruncatedNpub(data);
      case 'nprofile':
        return this.getTruncatedNpub(data.pubkey);
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

  /** Used to optimize the selection of a few relays from the user's relay list. */
  pickOptimalRelays(relayUrls: string[], count: number): string[] {
    // Filter out malformed URLs first
    const validUrls = relayUrls.filter(url => {
      // Must start with wss:// and have something after it
      if (!url.startsWith('wss://') || url === 'wss://') {
        return false;
      }

      // Attempt to parse the URL to ensure it's valid
      try {
        new URL(url);
        return true;
      } catch (e) {
        return false;
      }
    });

    const normalizedUrls = this.normalizeRelayUrls(validUrls);

    // Helper function to check if a URL is IP-based or localhost
    const isIpOrLocalhost = (url: string): boolean => {
      try {
        const hostname = new URL(url).hostname;
        const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
        const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
        return isIp || isLocalhost;
      } catch {
        return false;
      }
    };

    // 1. First tier: Preferred relays
    const preferredRelays = normalizedUrls.filter(url =>
      this.preferredRelays.includes(url) && !isIpOrLocalhost(url)
    );

    // 2. Second tier: Normal domain relays (not IP or localhost)
    const normalDomainRelays = normalizedUrls.filter(url =>
      !this.preferredRelays.includes(url) && !isIpOrLocalhost(url)
    );

    // 3. Third tier: IP-based and localhost relays
    const ipAndLocalhostRelays = normalizedUrls.filter(url =>
      isIpOrLocalhost(url)
    );

    // Combine all three tiers with preferred relays first, then normal domains, then IPs/localhost
    const sortedRelays = [...preferredRelays, ...normalDomainRelays, ...ipAndLocalhostRelays];

    // Return only up to the requested count
    return sortedRelays.slice(0, count);
  }
}
