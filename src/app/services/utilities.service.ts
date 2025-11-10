import { inject, Injectable, PLATFORM_ID, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Event, nip19, UnsignedEvent } from 'nostr-tools';
import { LoggerService } from './logger.service';
import { hexToBytes } from 'nostr-tools/utils';
import { isPlatformBrowser } from '@angular/common';
import { NostrTagKey } from '../standardized-tags';
import { NostrRecord } from '../interfaces';
import { encode } from 'blurhash';

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
   * Validate if a pubkey (hex or npub) is valid
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

    return false;
  }

  /**
   * Safely get hex pubkey from either hex or npub input
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

    return null;
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
      });

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
   * Get unique normalized relay URLs by removing duplicates and normalizing each URL
   * @param urls - Array of relay URLs to deduplicate and normalize
   * @returns Array of unique normalized relay URLs
   */
  getUniqueNormalizedRelayUrls(urls: string[]): string[] {
    // Remove duplicates first
    const uniqueUrls = [...new Set(urls)]
      .map(url => url.trim())
      .filter(url => url.length > 0);

    // Normalize all URLs (normalizeRelayUrls already filters out invalid ones)
    return this.normalizeRelayUrls(uniqueUrls);
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
    const event: UnsignedEvent = {
      kind: kind,
      created_at: this.currentDate(),
      tags,
      content,
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
    video.preload = 'metadata';
    video.muted = true;
    video.crossOrigin = 'anonymous';
    video.src = videoUrl;

    // Wait for video metadata to load
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video'));
    });

    // Calculate seek time if not provided
    const calculatedSeekTime = seekTime ?? Math.min(1, video.duration * 0.1);
    const clampedSeekTime = Math.min(calculatedSeekTime, video.duration - 0.5);
    video.currentTime = clampedSeekTime;

    // Wait for seek to complete
    await new Promise<void>(resolve => {
      video.onseeked = () => resolve();
    });

    // Create canvas and draw the video frame
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

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
    dimensions?: { width: number; height: number };
    fallbackUrls?: string[];
  }> {
    const metadata: {
      url: string;
      mimeType: string;
      blurhash?: string;
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
   * Format: ["imeta", "url <url>", "m <mime-type>", "blurhash <hash>", "dim <widthxheight>", ...]
   * @param metadata Media metadata object
   * @returns imeta tag array or null if invalid
   */
  buildImetaTag(metadata: {
    url: string;
    mimeType?: string;
    blurhash?: string;
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
}
