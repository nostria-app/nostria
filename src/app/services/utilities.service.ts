import { inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Event, nip19, UnsignedEvent } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { hexToBytes } from 'nostr-tools/utils';
import { ProfilePointer } from 'nostr-tools/nip19';
import { isPlatformBrowser } from '@angular/common';
import { NostrTagKey } from '../standardized-tags';

@Injectable({
  providedIn: 'root',
})
export class UtilitiesService {
  private sanitizer = inject(DomSanitizer);
  private logger = inject(LoggerService);

  NIP05_REGEX = /^(?:([\w.+-]+)@)?([\w_-]+(\.[\w_-]+)+)$/;
  regexpVideo =
    /(?:(?:https?)+\:\/\/+[a-zA-Z0-9\/\._-]{1,})+(?:(?:mp4|webm))/gi;
  regexpImage =
    /(?:(?:https?)+\:\/\/+[a-zA-Z0-9\/\._-]{1,})+(?:(?:jpe?g|png|gif|webp))/gi;
  regexpYouTube =
    /(?:https?:\/\/)?(?:www\.)?youtu\.?be(?:\.com)?\/?.*(?:watch|embed)?(?:.*v=|v\/|\/)([\w-_]+)/gim;
  regexpThisIsTheWay = /(?:thisistheway.gif)/g;
  regexpAlwaysHasBeen = /(?:alwayshasbeen.jpg)/g;
  regexpSpotify = /((http|https?)?(.+?\.?)(open.spotify.com)(.+?\.?)?)/gi;
  regexpTidal = /((http|https?)?(.+?\.?)(tidal.com)(.+?\.?)?)/gi;
  regexpUrl =
    /([\w+]+\:\/\/)?([\w\d-]+\.)*[\w-]+[\.\:]\w+([\/\?\=\&\#.]?[\w-]+)*\/?/gi;

  private readonly platformId = inject(PLATFORM_ID);
  readonly isBrowser = signal(isPlatformBrowser(this.platformId));

  constructor() {}

  toRecord(event: Event) {
    return {
      event,
      data: this.parseContent(event.content),
    };
  }

  toRecords(events: Event[]) {
    return events.map(event => this.toRecord(event));
  }

  /** Attempts to parse the content if it is a JSON string. */
  parseContent(content: string): any {
    if (content && content !== '') {
      try {
        // First check if the content is already an object (not a string)
        if (typeof content === 'string') {
          // Sanitize the JSON string to remove problematic characters
          // Example npub that is problematic: npub1xdn5apqgt2fyuace95cv7lvx344wdw5ppac7kvwycdqzlg7zdnds2ly4d0
          content = this.sanitizeJsonString(content);

          // Check if it looks like JSON (starts with { or [)
          const trimmedContent = content.trim();

          if (
            (trimmedContent.startsWith('{') && trimmedContent.endsWith('}')) ||
            (trimmedContent.startsWith('[') && trimmedContent.endsWith(']'))
          ) {
            // Try parsing it as JSON
            content = JSON.parse(content);
          }
          // If it doesn't look like JSON or parsing fails, the catch block will keep it as a string
        }
      } catch (e) {
        this.logger.error('Failed to parse event content', e);
      }
    }

    return content;
  }

  sanitizeJsonString(json: string): string {
    return (
      json
        // Specifically handle newlines that appear before closing quotes in JSON values
        .replace(/\n+"/g, '"')
        .trim()
    );
  }

  parseNip05(nip05: string) {
    return nip05.startsWith('_@') ? nip05.substring(1) : nip05;
  }

  // Get a-tag value from an event
  getATagValueFromEvent(event: Event): string | undefined {
    return this.getATagValueFromTags(event.tags);
  }

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

  // Get d-tag value
  getATagValueFromTags(tags: string[][]): string | undefined {
    for (const tag of tags) {
      if (tag.length >= 2 && tag[0] === 'a') {
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

    if (
      urlLower.endsWith('jpg') ||
      urlLower.endsWith('jpeg') ||
      urlLower.endsWith('png') ||
      urlLower.endsWith('webp') ||
      urlLower.endsWith('gif')
    ) {
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
    return urls
      .map(url => this.normalizeRelayUrl(url))
      .filter(url => url !== '');
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
    if (!npub.startsWith('npub')) {
      return npub;
    }

    // Convert the hex public key to a Nostr public key (npub)
    const result = nip19.decode(npub).data;
    return result as string;
  }

  getTags(event: Event | UnsignedEvent, tagType: NostrTagKey): string[] {
    let tags = event.tags
      .filter(tag => tag.length >= 2 && tag[0] === tagType)
      .map(tag => tag[1]);

    return tags;
  }

  arraysEqual(arr1: string[], arr2: string[]): boolean {
    if (arr1.length !== arr2.length) {
      return false;
    }

    // Sort both arrays to ensure order doesn't matter
    const sorted1 = [...arr1].sort();
    const sorted2 = [...arr2].sort();

    return sorted1.every((value, index) => value === sorted2[index]);
  }

  isHex(value: string) {
    const isEncoded =
      value.startsWith('nprofile') ||
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
        const isLocalhost =
          hostname === 'localhost' || hostname === '127.0.0.1';
        return isIp || isLocalhost;
      } catch {
        return false;
      }
    };

    // 1. First tier: Preferred relays
    const preferredRelays = normalizedUrls.filter(
      url => this.preferredRelays.includes(url) && !isIpOrLocalhost(url)
    );

    // 2. Second tier: Normal domain relays (not IP or localhost)
    const normalDomainRelays = normalizedUrls.filter(
      url => !this.preferredRelays.includes(url) && !isIpOrLocalhost(url)
    );

    // 3. Third tier: IP-based and localhost relays
    const ipAndLocalhostRelays = normalizedUrls.filter(url =>
      isIpOrLocalhost(url)
    );

    // Combine all three tiers with preferred relays first, then normal domains, then IPs/localhost
    const sortedRelays = [
      ...preferredRelays,
      ...normalDomainRelays,
      ...ipAndLocalhostRelays,
    ];

    // Return only up to the requested count
    return sortedRelays.slice(0, count);
  }

  currentDate() {
    return Math.floor(Date.now() / 1000);
  }

  isRootPost(event: Event) {
    // A root post has no 'e' tag (no reply or root reference)
    return !event.tags.some(tag => tag[0] === 'e');
  }

  createEvent(
    kind: number,
    content: string,
    tags: string[][],
    pubkey: string
  ): UnsignedEvent {
    const event: UnsignedEvent = {
      kind: kind,
      created_at: this.currentDate(),
      tags,
      content,
      pubkey: pubkey,
    };

    return event;
  }
}
