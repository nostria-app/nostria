import { inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Event, nip19, UnsignedEvent } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { hexToBytes } from 'nostr-tools/utils';
import { isPlatformBrowser } from '@angular/common';
import { NostrTagKey } from '../standardized-tags';
import { NostrRecord } from '../interfaces';
import { encode } from 'blurhash';

/**
 * Represents a relay entry with its read/write markers per NIP-65.
 * If neither read nor write is specified, the relay is both read and write.
 */
export interface RelayEntry {
  url: string;
  read: boolean;
  write: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class UtilitiesService {
  private sanitizer = inject(DomSanitizer);
  private logger = inject(LoggerService);

  NIP05_REGEX = /^(?:([\w.+-]+)@)?([\w_-]+(\.[\w_-]+)+)$/;
  regexpVideo = /(?:(?:https?)+\:\/\/+[a-zA-Z0-9\/\._-]{1,})+(?:(?:mp4|webm|mov|avi|wmv|flv|mkv))/gi;
  regexpImage = /(?:(?:https?)+\:\/\/+[a-zA-Z0-9\/\._-]{1,})+(?:(?:jpe?g|png|gif|webp))/gi;
  regexpYouTube =
    /(?:https?:\/\/)?(?:www\.)?youtu\.?be(?:\.com)?\/?.*(?:watch|embed)?(?:.*v=|v\/|\/)([\w-_]+)/gim;
  regexpThisIsTheWay = /(?:thisistheway.gif)/g;
  regexpAlwaysHasBeen = /(?:alwayshasbeen.jpg)/g;
  regexpSpotify = /((http|https?)?(.+?\.?)(open.spotify.com)(.+?\.?)?)/gi;
  regexpTidal = /((http|https?)?(.+?\.?)(tidal.com)(.+?\.?)?)/gi;
  regexpUrl = /([\w+]+\:\/\/)?([\w\d-]+\.)*[\w-]+[\.\:]\w+([\/\?\=\&\#.]?[\w-]+)*\/?/gi;

  private readonly platformId = inject(PLATFORM_ID);
  readonly isBrowser = signal(isPlatformBrowser(this.platformId));

  constructor() { }

  /**
   * Wait for window.nostr to become available (browser extensions inject it asynchronously).
   * This is useful because NIP-07 extensions like Alby or nos2x inject window.nostr after page load.
   * Returns true if window.nostr becomes available, false if timeout or running in SSR.
   * 
   * @param timeoutMs Maximum time to wait in milliseconds (default: 5000ms)
   * @returns Promise<boolean> - true if extension is available, false otherwise
   */
  async waitForNostrExtension(timeoutMs = 5000): Promise<boolean> {
    // Skip in SSR - extensions only exist in browser
    if (!this.isBrowser()) {
      return false;
    }

    if (window.nostr) {
      return true;
    }

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (window.nostr) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve(true);
        }
      }, 100); // Check every 100ms

      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, timeoutMs);
    });
  }

  /**
   * Validate if a string is a valid hex pubkey (64 character hex string)
   */
  isValidHexPubkey(pubkey: string): boolean {
    if (!pubkey || typeof pubkey !== 'string') {
      return false;
    }

    // Must be exactly 64 characters of valid hex
    return /^[0-9a-fA-F]{64}$/.test(pubkey);
  }

  /**
   * Validate if a string is a valid npub
   */
  isValidNpub(npub: string): boolean {
    if (!npub || typeof npub !== 'string' || !npub.startsWith('npub1')) {
      return false;
    }

    try {
      const result = nip19.decode(npub);
      return result.type === 'npub' && typeof result.data === 'string' && result.data.length === 64;
    } catch {
      return false;
    }
  }

  /**
   * Validate if a pubkey (hex, npub, or nprofile) is valid
   */
  isValidPubkey(pubkey: string): boolean {
    if (!pubkey || typeof pubkey !== 'string') {
      return false;
    }

    // Check if it's a valid hex pubkey
    if (this.isValidHexPubkey(pubkey)) {
      return true;
    }

    // Check if it's a valid npub and convert to hex for validation
    if (this.isValidNpub(pubkey)) {
      try {
        const hexPubkey = this.getPubkeyFromNpub(pubkey);
        return this.isValidHexPubkey(hexPubkey);
      } catch {
        return false;
      }
    }

    // Check if it's a valid nprofile
    if (pubkey.startsWith('nprofile1')) {
      try {
        const decoded = nip19.decode(pubkey);
        if (decoded.type === 'nprofile') {
          const profileData = decoded.data as { pubkey: string };
          return this.isValidHexPubkey(profileData.pubkey);
        }
        return false;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Safely get hex pubkey from hex, npub, or nprofile input
   */
  safeGetHexPubkey(pubkey: string): string | null {
    if (!this.isValidPubkey(pubkey)) {
      return null;
    }

    if (this.isValidHexPubkey(pubkey)) {
      return pubkey;
    }

    if (this.isValidNpub(pubkey)) {
      try {
        return this.getPubkeyFromNpub(pubkey);
      } catch {
        return null;
      }
    }

    // Handle nprofile format
    if (pubkey.startsWith('nprofile1')) {
      try {
        const decoded = nip19.decode(pubkey);
        if (decoded.type === 'nprofile') {
          const profileData = decoded.data as { pubkey: string };
          return profileData.pubkey;
        }
        return null;
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Extract lyrics from a Nostr music event (kind 32123).
   * Lyrics can be in: 1) 'lyrics' tag, 2) content with "Lyrics:" section, 3) plain content
   */
  extractLyricsFromEvent(event: Event): string | undefined {
    // First check for lyrics tag
    const lyricsTag = event.tags.find(t => t[0] === 'lyrics');
    if (lyricsTag?.[1]) {
      return lyricsTag[1];
    }

    // Check content for lyrics
    const content = event.content;
    if (!content || content.match(/^https?:\/\//)) {
      return undefined;
    }

    // Try to parse "Lyrics:" section from content
    const sectionRegex = /^(Lyrics|Credits|Description|Notes|About|Info):\s*\n?/gim;
    const parts = content.split(sectionRegex).filter(p => p.trim());

    if (parts.length >= 2) {
      for (let i = 0; i < parts.length; i += 2) {
        const header = parts[i]?.trim().toLowerCase();
        const body = parts[i + 1]?.trim();
        if (header === 'lyrics' && body) {
          return body;
        }
      }
    } else if (content.trim()) {
      // No section headers, treat content as lyrics if it's not empty
      return content.trim();
    }

    return undefined;
  }

  toRecord(event: Event): NostrRecord {
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
          // Check if it looks like JSON (starts with { or [)
          const trimmedContent = content.trim();

          if (
            (trimmedContent.startsWith('{') && trimmedContent.endsWith('}')) ||
            (trimmedContent.startsWith('[') && trimmedContent.endsWith(']'))
          ) {
            // Only sanitize JSON strings to remove problematic characters
            // Example npub that is problematic: npub1xdn5apqgt2fyuace95cv7lvx344wdw5ppac7kvwycdqzlg7zdnds2ly4d0
            const sanitizedContent = this.sanitizeJsonString(content);
            // Try parsing it as JSON
            content = JSON.parse(sanitizedContent);
          }
          // If it doesn't look like JSON, keep the original content with newlines preserved
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
    if (!event.content) {
      return [];
    }

    let content = [];

    if (typeof event.content === 'string') {
      try {
        // This is a workaround for handling single wss:// URLs in content, which
        // has been observed in the "wild".
        if (event.content.startsWith('wss://')) {
          event.content = `{"${event.content}":{"read":true,"write":true}}`;
        }

        content = JSON.parse(event.content);
      } catch (err) {
        console.error(err);
      }
    }

    const relayUrls = Object.keys(content).map(url => {
      const wssIndex = url.indexOf('wss://');
      return wssIndex >= 0 ? url.substring(wssIndex) : url;
    });

    return relayUrls;
  }

  /** Parses the URLs and cleans up, ensuring only wss:// instances are returned. */
  getRelayUrls(event: Event): string[] {
    const relayUrls = event.tags
      .filter(tag => tag.length >= 2 && tag[0] === 'r')
      .map(tag => {
        const url = tag[1];
        const wssIndex = url.indexOf('wss://');
        return wssIndex >= 0 ? url.substring(wssIndex) : url;
      })
      .filter(url => url.trim() !== '');

    return relayUrls;
  }

  /**
   * Parses relay list (NIP-65 kind 10002) and returns relay entries with read/write markers.
   * Per NIP-65:
   * - If no marker is present, the relay is both read and write
   * - If "read" marker is present, it's a read-only relay (for receiving mentions)
   * - If "write" marker is present, it's a write-only relay (where user publishes events)
   *
   * When fetching events FROM a user, prefer WRITE relays.
   * When fetching events ABOUT a user (mentions), prefer READ relays.
   */
  getRelayEntries(event: Event): RelayEntry[] {
    return event.tags
      .filter(tag => tag.length >= 2 && tag[0] === 'r')
      .map(tag => {
        let url = tag[1];
        const wssIndex = url.indexOf('wss://');
        url = wssIndex >= 0 ? url.substring(wssIndex) : url;

        const marker = tag[2]?.toLowerCase();

        // Per NIP-65: If no marker, relay is both read and write
        const isRead = marker === 'read' || !marker;
        const isWrite = marker === 'write' || !marker;

        return { url, read: isRead, write: isWrite };
      })
      .filter(entry => entry.url.trim() !== '');
  }

  /**
   * Get relay URLs that are marked for writing (where user publishes events).
   * Per NIP-65: When downloading events FROM a user, use their WRITE relays.
   * Falls back to all relays if no specific write relays are found.
   */
  getWriteRelayUrls(event: Event): string[] {
    const entries = this.getRelayEntries(event);
    const writeRelays = entries.filter(e => e.write).map(e => e.url);

    // If we have write-specific relays, return those
    if (writeRelays.length > 0) {
      return writeRelays;
    }

    // Fallback to all relays if no write relays are specified
    return entries.map(e => e.url);
  }

  /**
   * Get relay URLs that are marked for reading (where user receives mentions).
   * Per NIP-65: When downloading events ABOUT a user (mentions), use their READ relays.
   * Falls back to all relays if no specific read relays are found.
   */
  getReadRelayUrls(event: Event): string[] {
    const entries = this.getRelayEntries(event);
    const readRelays = entries.filter(e => e.read).map(e => e.url);

    // If we have read-specific relays, return those
    if (readRelays.length > 0) {
      return readRelays;
    }

    // Fallback to all relays if no read relays are specified
    return entries.map(e => e.url);
  }

  /**
   * Get optimal relay URLs for fetching events from a user.
   * Prioritizes WRITE relays first, then falls back to READ/WRITE relays.
   * This follows NIP-65: "When downloading events from a user, use the write relays of that user."
   */
  getOptimalRelayUrlsForFetching(event: Event): string[] {
    const entries = this.getRelayEntries(event);

    // Separate into write-only, read-write, and read-only
    const writeOnly = entries.filter(e => e.write && !e.read).map(e => e.url);
    const readWrite = entries.filter(e => e.write && e.read).map(e => e.url);
    const readOnly = entries.filter(e => e.read && !e.write).map(e => e.url);

    // Prioritize: write-only first, then read-write, then read-only as last resort
    return [...writeOnly, ...readWrite, ...readOnly];
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
    // 'wss://relay.nostr.band/',
    'wss://nostr.oxtr.dev/',
    'wss://nostr.mom/',
  ];

  normalizeRelayUrls(urls: string[]): string[] {
    return urls.map(url => this.normalizeRelayUrl(url)).filter(url => url !== '');
  }

  /**
   * Get unique normalized relay URLs by removing duplicates and normalizing each URL
   * @param urls - Array of relay URLs to deduplicate and normalize
   * @returns Array of unique normalized relay URLs
   */
  getUniqueNormalizedRelayUrls(urls: string[]): string[] {
    // Normalize all URLs first, then deduplicate
    const normalizedUrls = urls
      .map(url => this.normalizeRelayUrl(url.trim()))
      .filter(url => url.length > 0);

    // Remove duplicates after normalization
    return [...new Set(normalizedUrls)];
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
    try {
      if (!this.isValidPubkey(pubkey)) {
        this.logger.warn('Invalid pubkey format in getTruncatedNpub:', pubkey);
        return this.formatInvalidPubkey(pubkey);
      }

      const hexPubkey = this.safeGetHexPubkey(pubkey);
      if (!hexPubkey) {
        return this.formatInvalidPubkey(pubkey);
      }

      const npub = this.getNpubFromPubkey(hexPubkey);
      return npub.length > 12
        ? `${npub.substring(0, 6)}...${npub.substring(npub.length - 6)}`
        : npub;
    } catch (error) {
      this.logger.warn('Error in getTruncatedNpub:', pubkey, error);
      return this.formatInvalidPubkey(pubkey);
    }
  }

  formatInvalidPubkey(pubkey: string): string {
    if (!pubkey || typeof pubkey !== 'string') {
      return 'Invalid pubkey';
    }

    // If it's already an npub format, truncate it safely
    if (pubkey.startsWith('npub1')) {
      return pubkey.length > 16
        ? `${pubkey.substring(0, 12)}...${pubkey.substring(pubkey.length - 4)}`
        : pubkey;
    }

    // For other formats, truncate safely
    if (pubkey.length > 16) {
      return `${pubkey.substring(0, 8)}...${pubkey.substring(pubkey.length - 8)}`;
    }

    return pubkey;
  }

  getNsecFromPrivkey(privkey: string): string {
    // Convert the hex private key to a Nostr secret key (nsec)
    const bytes = hexToBytes(privkey);
    const nsec = nip19.nsecEncode(bytes);
    return nsec;
  }

  getNpubFromPubkey(pubkey: string): string {
    try {
      if (!this.isValidHexPubkey(pubkey)) {
        throw new Error(`Invalid hex pubkey: ${pubkey}`);
      }

      // Convert the hex public key to a Nostr public key (npub)
      const npub = nip19.npubEncode(pubkey);
      return npub;
    } catch (error) {
      this.logger.warn('Error converting pubkey to npub:', pubkey, error);
      throw error;
    }
  }

  getPubkeyFromNpub(npub: string): string {
    if (!npub.startsWith('npub')) {
      return npub;
    }

    try {
      // Convert the npub to hex public key
      const result = nip19.decode(npub).data;
      return result as string;
    } catch (error) {
      console.warn('Failed to decode npub:', npub, error);
      // Return the original string if decoding fails - it might be a raw pubkey
      return npub;
    }
  }

  getTags(event: Event | UnsignedEvent, tagType: NostrTagKey): string[] {
    const tags = event.tags.filter(tag => tag.length >= 2 && tag[0] === tagType).map(tag => tag[1]);

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
    try {
      return nip19.decode(value);
    } catch (error) {
      console.warn('Failed to decode value:', value, error);
      throw error; // Re-throw since this is a generic decode method that callers might want to handle
    }
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
    const preferredRelays = normalizedUrls.filter(
      url => this.preferredRelays.includes(url) && !isIpOrLocalhost(url)
    );

    // 2. Second tier: Normal domain relays (not IP or localhost)
    const normalDomainRelays = normalizedUrls.filter(
      url => !this.preferredRelays.includes(url) && !isIpOrLocalhost(url)
    );

    // 3. Third tier: IP-based and localhost relays
    const ipAndLocalhostRelays = normalizedUrls.filter(url => isIpOrLocalhost(url));

    // Combine all three tiers with preferred relays first, then normal domains, then IPs/localhost
    const sortedRelays = [...preferredRelays, ...normalDomainRelays, ...ipAndLocalhostRelays];

    // Return only up to the requested count
    return sortedRelays.slice(0, count);
  }

  currentDate() {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Check if an event has expired according to NIP-40
   * @param event The event to check
   * @returns true if the event has expired, false otherwise
   */
  isEventExpired(event: Event): boolean {
    const expirationTag = event.tags.find(tag => tag[0] === 'expiration');

    if (!expirationTag || expirationTag.length < 2) {
      return false; // No expiration tag means the event doesn't expire
    }

    const expirationTimestamp = parseInt(expirationTag[1], 10);

    if (isNaN(expirationTimestamp)) {
      return false; // Invalid expiration timestamp
    }

    const currentTimestamp = this.currentDate();
    return currentTimestamp >= expirationTimestamp;
  }

  /**
   * Get the expiration timestamp from an event (NIP-40)
   * @param event The event to check
   * @returns The expiration timestamp in seconds, or null if no expiration
   */
  getEventExpiration(event: Event): number | null {
    const expirationTag = event.tags.find(tag => tag[0] === 'expiration');

    if (!expirationTag || expirationTag.length < 2) {
      return null;
    }

    const expirationTimestamp = parseInt(expirationTag[1], 10);
    return isNaN(expirationTimestamp) ? null : expirationTimestamp;
  }

  /**
   * Filter out expired events from an array
   * @param events Array of events to filter
   * @returns Array of non-expired events
   */
  filterExpiredEvents(events: Event[]): Event[] {
    return events.filter(event => !this.isEventExpired(event));
  }

  isRootPost(event: Event) {
    // A root post has no 'e' tag (no reply or root reference)
    return !event.tags.some(tag => tag[0] === 'e');
  }

  createEvent(kind: number, content: string, tags: string[][], pubkey: string): UnsignedEvent {
    // Order fields so content appears before tags for easier user review when signing
    const event: UnsignedEvent = {
      kind: kind,
      content,
      created_at: this.currentDate(),
      tags,
      pubkey: pubkey,
    };

    return event;
  }

  // ============================================================================
  // Media Utilities (NIP-92, NIP-94)
  // ============================================================================

  /**
   * Extract thumbnail from video at a specific time offset
   * @param videoUrl URL of the video file
   * @param seekTime Time offset in seconds (default: 1s or 10% of duration)
   * @returns Object containing blob, dimensions, and object URL
   */
  async extractThumbnailFromVideo(
    videoUrl: string,
    seekTime?: number
  ): Promise<{
    blob: Blob;
    dimensions: { width: number; height: number };
    objectUrl: string;
  }> {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true; // Important for mobile browsers
    video.crossOrigin = 'anonymous';

    // Load the video
    video.src = videoUrl;
    video.load();

    // Wait for enough data to be loaded
    await new Promise<void>((resolve, reject) => {
      video.oncanplay = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video'));

      // Timeout after 10 seconds
      setTimeout(() => reject(new Error('Video loading timeout')), 10000);
    });

    // Calculate seek time
    const calculatedSeekTime = seekTime ?? Math.min(1, video.duration * 0.1);
    const clampedSeekTime = Math.max(0, Math.min(calculatedSeekTime, video.duration - 0.5));

    // Seek to the desired time
    video.currentTime = clampedSeekTime;

    // Wait for seek to complete
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error('Failed to seek video'));

      // Timeout
      setTimeout(() => reject(new Error('Video seek timeout')), 5000);
    });

    // Play for a brief moment to ensure frame is rendered, then pause
    try {
      await video.play();
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
      video.pause();
    } catch (error) {
      // Play might fail, but we can still try to capture
      console.warn('Could not play video, attempting capture anyway:', error);
    }

    // Wait a bit more to ensure the frame is painted
    await new Promise(resolve => setTimeout(resolve, 100));

    // Create canvas and draw the video frame
    const canvas = document.createElement('canvas');

    // Respect aspect ratio - create thumbnail at a standard size while maintaining aspect
    const maxWidth = 1280;
    const maxHeight = 720;
    const videoAspect = video.videoWidth / video.videoHeight;
    const targetAspect = maxWidth / maxHeight;

    let targetWidth: number;
    let targetHeight: number;

    if (videoAspect > targetAspect) {
      // Video is wider - fit to width
      targetWidth = maxWidth;
      targetHeight = Math.round(maxWidth / videoAspect);
    } else {
      // Video is taller - fit to height
      targetHeight = maxHeight;
      targetWidth = Math.round(maxHeight * videoAspect);
    }

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // Draw the video frame at the calculated dimensions
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

    // Convert canvas to blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        blob => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create thumbnail blob'));
          }
        },
        'image/jpeg',
        0.9
      );
    });

    const objectUrl = URL.createObjectURL(blob);

    return {
      blob,
      dimensions: { width: canvas.width, height: canvas.height },
      objectUrl,
    };
  }

  /**
   * Generate blurhash from an image URL or File
   * @param source Image URL or File object
   * @param componentX Horizontal components (1-9, default: 6)
   * @param componentY Vertical components (1-9, default: 4)
   * @returns Object containing blurhash and dimensions
   */
  async generateBlurhash(
    source: string | File,
    componentX = 6,
    componentY = 4
  ): Promise<{
    blurhash: string;
    dimensions: { width: number; height: number };
  }> {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    let imageUrl: string;
    let shouldRevokeUrl = false;

    // Handle File or URL
    if (source instanceof File) {
      imageUrl = URL.createObjectURL(source);
      shouldRevokeUrl = true;
    } else {
      imageUrl = source;
    }

    try {
      // Load image
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageUrl;
      });

      const dimensions = { width: img.width, height: img.height };

      // Create canvas for blurhash generation
      const canvas = document.createElement('canvas');
      const width = 64;
      const height = Math.floor((img.height / img.width) * width);

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to get canvas context');
      }

      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);

      // Generate blurhash
      const blurhash = encode(imageData.data, width, height, componentX, componentY);

      return { blurhash, dimensions };
    } finally {
      // Clean up object URL if we created one
      if (shouldRevokeUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    }
  }

  /**
   * Get image dimensions from URL or File
   * @param source Image URL or File object
   * @returns Image dimensions
   */
  async getImageDimensions(
    source: string | File
  ): Promise<{ width: number; height: number }> {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    let imageUrl: string;
    let shouldRevokeUrl = false;

    // Handle File or URL
    if (source instanceof File) {
      imageUrl = URL.createObjectURL(source);
      shouldRevokeUrl = true;
    } else {
      imageUrl = source;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = imageUrl;
      });

      return { width: img.width, height: img.height };
    } finally {
      if (shouldRevokeUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    }
  }

  /**
   * Extract complete media metadata for NIP-92/NIP-94 compliance
   * Note: This method only generates blurhash for compatibility.
   * For thumbhash support, use the ImagePlaceholderService.generatePlaceholders() method.
   * @param file File object
   * @param url URL where the file is hosted
   * @returns Complete metadata object
   */
  async extractMediaMetadata(
    file: File,
    url: string
  ): Promise<{
    url: string;
    mimeType: string;
    blurhash?: string;
    thumbhash?: string;
    dimensions?: { width: number; height: number };
    fallbackUrls?: string[];
  }> {
    const metadata: {
      url: string;
      mimeType: string;
      blurhash?: string;
      thumbhash?: string;
      dimensions?: { width: number; height: number };
      fallbackUrls?: string[];
    } = {
      url,
      mimeType: file.type,
    };

    // Only generate blurhash and dimensions for images
    if (file.type.startsWith('image/')) {
      try {
        const result = await this.generateBlurhash(file);
        metadata.blurhash = result.blurhash;
        metadata.dimensions = result.dimensions;
      } catch (error) {
        this.logger.warn('Failed to generate blurhash for image:', error);
        // Continue without blurhash
      }
    }

    return metadata;
  }

  /**
   * Build an imeta tag from media metadata (NIP-92)
   * Format: ["imeta", "url <url>", "m <mime-type>", "blurhash <hash>", "thumbhash <hash>", "dim <widthxheight>", ...]
   * @param metadata Media metadata object
   * @returns imeta tag array or null if invalid
   */
  buildImetaTag(metadata: {
    url: string;
    mimeType?: string;
    blurhash?: string;
    thumbhash?: string;
    dimensions?: { width: number; height: number };
    alt?: string;
    sha256?: string;
    size?: number;
    duration?: number;
    image?: string; // Preview image URL (for videos)
    imageMirrors?: string[]; // Mirror URLs for the preview image
    fallbackUrls?: string[]; // Fallback URLs for the main media file
  }): string[] | null {
    if (!metadata.url) {
      return null;
    }

    const tag: string[] = ['imeta'];

    // URL is required (NIP-92)
    tag.push(`url ${metadata.url}`);

    // Add MIME type if available (NIP-94)
    if (metadata.mimeType) {
      tag.push(`m ${metadata.mimeType}`);
    }

    // Add blurhash if available (NIP-94)
    if (metadata.blurhash) {
      tag.push(`blurhash ${metadata.blurhash}`);
    }

    // Add thumbhash if available (newer alternative to blurhash)
    if (metadata.thumbhash) {
      tag.push(`thumbhash ${metadata.thumbhash}`);
    }

    // Add dimensions if available (NIP-94)
    if (metadata.dimensions) {
      tag.push(`dim ${metadata.dimensions.width}x${metadata.dimensions.height}`);
    }

    // Add alt text if available (NIP-94)
    if (metadata.alt) {
      tag.push(`alt ${metadata.alt}`);
    }

    // Add SHA-256 hash if available (NIP-94)
    if (metadata.sha256) {
      tag.push(`x ${metadata.sha256}`);
    }

    // Add file size if available (NIP-94)
    if (metadata.size) {
      tag.push(`size ${metadata.size}`);
    }

    // Add duration for videos if available (NIP-94)
    if (metadata.duration !== undefined) {
      tag.push(`duration ${metadata.duration}`);
    }

    // Add preview image URL if available (NIP-94)
    // This is a regular screen capture for videos, not just a thumbnail
    if (metadata.image) {
      tag.push(`image ${metadata.image}`);
    }

    // Add preview image mirrors if available (NIP-94)
    if (metadata.imageMirrors && metadata.imageMirrors.length > 0) {
      metadata.imageMirrors.forEach(mirrorUrl => {
        tag.push(`image ${mirrorUrl}`);
      });
    }

    // Add fallback URLs for the main media file (NIP-94)
    if (metadata.fallbackUrls && metadata.fallbackUrls.length > 0) {
      metadata.fallbackUrls.forEach(fallbackUrl => {
        tag.push(`fallback ${fallbackUrl}`);
      });
    }

    return tag;
  }

  /**
   * Encode a Nostr event to a NIP-19 nevent string for sharing
   * @param event The Nostr event to encode
   * @param relays Optional relay hints for the event
   * @returns NIP-19 nevent or naddr string
   */
  encodeEventForUrl(event: Event, relays?: string[]): string {
    // For parameterized replaceable events (kinds 30000-39999), use naddr encoding
    // These events are identified by kind + pubkey + d-tag, not by event ID
    if (event.kind >= 30000 && event.kind < 40000) {
      const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
      return nip19.naddrEncode({
        kind: event.kind,
        pubkey: event.pubkey,
        identifier: dTag,
        relays: relays || [],
      });
    }

    // For other events, use nevent encoding
    return nip19.neventEncode({
      id: event.id,
      relays: relays || [],
      author: event.pubkey,
      kind: event.kind,
    });
  }

  /**
   * Decode a NIP-19 encoded event from URL (supports both nevent and naddr)
   * @param encodedEvent The NIP-19 nevent or naddr string
   * @returns Decoded event pointer with id, relays, and author, or null if decoding fails
   */
  decodeEventFromUrl(encodedEvent: string): { id?: string; relays?: string[]; author?: string; kind?: number; identifier?: string } | null {
    try {
      const decoded = nip19.decode(encodedEvent);

      if (decoded.type === 'nevent') {
        return decoded.data;
      }

      if (decoded.type === 'naddr') {
        // For naddr (replaceable events), return the address data
        // The caller will need to fetch the actual event using kind, pubkey, and identifier
        return {
          kind: decoded.data.kind,
          author: decoded.data.pubkey,
          identifier: decoded.data.identifier,
          relays: decoded.data.relays,
        };
      }

      this.logger.error('Invalid event format - expected nevent or naddr, got:', decoded.type);
      return null;
    } catch (error) {
      this.logger.error('Failed to decode event from URL:', error);
      return null;
    }
  }

  /**
   * Check if an event kind is a replaceable event (NIP-01)
   * Replaceable events: kind 0, 3, or 10000-19999
   * These events should always be fetched from relays to ensure we have the latest version
   */
  isReplaceableEvent(kind: number): boolean {
    // NIP-01 defines replaceable events as:
    // - Kind 0 (Metadata)
    // - Kind 3 (Contact list)
    // - Kinds 10000-19999 (Replaceable events)
    const METADATA_KIND = 0;
    const CONTACT_LIST_KIND = 3;
    const REPLACEABLE_MIN = 10000;
    const REPLACEABLE_MAX = 20000; // Exclusive upper bound (includes 10000-19999)

    return kind === METADATA_KIND ||
      kind === CONTACT_LIST_KIND ||
      (kind >= REPLACEABLE_MIN && kind < REPLACEABLE_MAX);
  }

  /**
   * Check if an event kind is a parameterized replaceable event (NIP-01)
   * Parameterized replaceable events: kind 30000-39999 (e.g., articles, long-form content)
   * These events should always be fetched from relays to ensure we have the latest version
   */
  isParameterizedReplaceableEvent(kind: number): boolean {
    // NIP-01 defines parameterized replaceable events as kinds 30000-39999
    const PARAMETERIZED_REPLACEABLE_MIN = 30000;
    const PARAMETERIZED_REPLACEABLE_MAX = 40000; // Exclusive upper bound (includes 30000-39999)

    return kind >= PARAMETERIZED_REPLACEABLE_MIN && kind < PARAMETERIZED_REPLACEABLE_MAX;
  }

  /**
   * Check if an event should be fetched from relays even if found in local storage
   * Returns true for replaceable and parameterized replaceable events
   */
  shouldAlwaysFetchFromRelay(kind: number): boolean {
    return this.isReplaceableEvent(kind) || this.isParameterizedReplaceableEvent(kind);
  }
}
