import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { nip19 } from 'nostr-tools';
import { ProfilePointer } from 'nostr-tools/nip19';
import { LoggerService } from './logger.service';
import { LocalStorageService } from './local-storage.service';

/**
 * Service for handling external links and optionally routing them internally
 * when they match configured domains
 */
@Injectable({
  providedIn: 'root',
})
export class ExternalLinkHandlerService {
  private readonly router = inject(Router);
  private readonly logger = inject(LoggerService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly STORAGE_KEY = 'nostria-external-domains';

  // Default domains that should be handled internally
  private readonly DEFAULT_DOMAINS = [
    'nostria.app',
    'primal.net',
    'yakihonne.com',
    'njump.me',
    'snort.social',
    'phoenix.social',
    'iris.to',
    'yakbak.app',
    'coracle.social',
    'jumble.social',
    'nostrudel.ninja',
    'nostter.app',
    'sunami.app',
  ];

  /**
   * Get the list of configured external domains
   */
  getConfiguredDomains(): string[] {
    const stored = this.localStorage.getObject<string[]>(this.STORAGE_KEY);
    return stored || [...this.DEFAULT_DOMAINS];
  }

  /**
   * Set the list of configured external domains
   */
  setConfiguredDomains(domains: string[]): void {
    this.localStorage.setObject(this.STORAGE_KEY, domains);
  }

  /**
   * Add a domain to the configured list
   */
  addDomain(domain: string): void {
    const domains = this.getConfiguredDomains();
    const normalizedDomain = this.normalizeDomain(domain);

    if (!domains.includes(normalizedDomain)) {
      domains.push(normalizedDomain);
      this.setConfiguredDomains(domains);
    }
  }

  /**
   * Remove a domain from the configured list
   */
  removeDomain(domain: string): void {
    const domains = this.getConfiguredDomains();
    const normalizedDomain = this.normalizeDomain(domain);
    const filtered = domains.filter(d => d !== normalizedDomain);
    this.setConfiguredDomains(filtered);
  }

  /**
   * Check if a URL should be handled internally
   */
  shouldHandleInternally(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const domains = this.getConfiguredDomains();

      // Check if the URL's hostname matches any configured domain
      return domains.some(domain => {
        // Handle both exact match and subdomain match
        return urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`);
      });
    } catch (error) {
      this.logger.warn('[ExternalLinkHandler] Invalid URL:', url, error);
      return false;
    }
  }

  /**
   * Handle a link click event, routing internally if configured
   * Returns true if handled internally, false if should open externally
   */
  handleLinkClick(url: string, event?: MouseEvent): boolean {
    // If Ctrl/Alt/Shift key is pressed, always open in new tab (browser default behavior)
    if (event && (event.ctrlKey || event.altKey || event.shiftKey)) {
      return false;
    }

    if (!this.shouldHandleInternally(url)) {
      return false;
    }

    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;

      this.logger.info('[ExternalLinkHandler] Handling link internally:', url);

      // Check for nostria.app-specific routes first
      // These are app-specific paths that don't follow the nostr identifier pattern
      const nostriaRoute = this.handleNostriaAppRoute(path);
      if (nostriaRoute) {
        this.logger.info('[ExternalLinkHandler] Navigating to nostria route:', nostriaRoute);
        this.router.navigate(nostriaRoute);
        return true;
      }

      // Try to extract nostr identifiers from the path
      // Different clients use different URL patterns:
      // - primal.net: /e/nevent..., /p/nprofile...
      // - yakihonne.com: /note/nevent..., /profile/nprofile...
      // - phoenix.social/snort.social: /nevent..., /nprofile... (direct)
      // - jumble.social: /users/npub..., /notes/naddr...
      // - iris.to: /note1..., /npub... (direct)
      // - yakbak.app: /npub..., /nevent... (direct)
      // - coracle.social: /people/nprofile..., /notes/nevent...
      // - nostrudel.ninja: /u/npub..., /n/nevent...

      // Pattern 1: Path prefix patterns like /e/, /p/, /profile/, /note/, /users/, /people/, /u/, /n/, /release/
      const prefixMatch = path.match(/^\/(p|profile|e|event|a|article|note|notes|users|people|u|n|release)\/([a-zA-Z0-9]+)/i);

      if (prefixMatch) {
        const [, type, identifier] = prefixMatch;
        const route = this.mapTypeToRoute(type.toLowerCase(), identifier);

        if (route) {
          this.logger.info('[ExternalLinkHandler] Navigating to:', route);
          this.router.navigate([route]);
          return true;
        }
      }

      // Pattern 2: Direct identifier in path like /npub..., /nprofile..., /nevent..., /note1..., /naddr...
      const directMatch = path.match(/^\/(n(?:pub|profile|event|addr|ote)1[a-zA-Z0-9]+)/i);

      if (directMatch) {
        const [, identifier] = directMatch;
        const route = this.mapIdentifierToRoute(identifier);

        if (route) {
          this.logger.info('[ExternalLinkHandler] Navigating to:', route);
          this.router.navigate([route]);
          return true;
        }
      }

      // If we can't extract a valid route, log and return false
      this.logger.warn('[ExternalLinkHandler] Could not extract valid route from:', url);
      return false;
    } catch (error) {
      this.logger.error('[ExternalLinkHandler] Error handling link:', error);
      return false;
    }
  }

  /**
   * Handle nostria.app-specific routes that don't follow the nostr identifier pattern
   * Returns the route segments array if matched, null otherwise
   */
  private handleNostriaAppRoute(path: string): string[] | null {
    // Music song: /music/song/:pubkey/:identifier
    const musicSongMatch = path.match(/^\/music\/song\/([a-zA-Z0-9]+)\/(.+)$/i);
    if (musicSongMatch) {
      const [, pubkey, identifier] = musicSongMatch;
      return ['/music/song', pubkey, identifier];
    }

    // Music artist: /music/artist/:pubkey
    const musicArtistMatch = path.match(/^\/music\/artist\/([a-zA-Z0-9]+)$/i);
    if (musicArtistMatch) {
      const [, pubkey] = musicArtistMatch;
      return ['/music/artist', pubkey];
    }

    // Music playlist: /music/playlist/:pubkey/:identifier
    const musicPlaylistMatch = path.match(/^\/music\/playlist\/([a-zA-Z0-9]+)\/(.+)$/i);
    if (musicPlaylistMatch) {
      const [, pubkey, identifier] = musicPlaylistMatch;
      return ['/music/playlist', pubkey, identifier];
    }

    // Stream: /stream/:encodedEvent
    const streamMatch = path.match(/^\/stream\/([a-zA-Z0-9]+)$/i);
    if (streamMatch) {
      const [, encodedEvent] = streamMatch;
      return ['/stream', encodedEvent];
    }

    // Badge details: /b/:id or /badges/details/:id
    const badgeMatch = path.match(/^\/(b|badges\/details)\/([a-zA-Z0-9]+)$/i);
    if (badgeMatch) {
      const [, , id] = badgeMatch;
      return ['/b', id];
    }

    // Username profile: /u/:username
    const usernameMatch = path.match(/^\/u\/([^/]+)$/i);
    if (usernameMatch) {
      const [, username] = usernameMatch;
      return ['/u', username];
    }

    // Messages: /messages/:id
    const messagesMatch = path.match(/^\/messages\/([^/]+)$/i);
    if (messagesMatch) {
      const [, id] = messagesMatch;
      return ['/messages', id];
    }

    // Simple static routes that can be navigated directly
    const staticRoutes = [
      '/music',
      '/music/offline',
      '/music/liked',
      '/music/liked-playlists',
      '/music/tracks',
      '/music/playlists',
      '/music/terms',
      '/articles',
      '/streams',
      '/meetings',
      '/discover',
      '/discover/media',
      '/notifications',
      '/search',
      '/settings',
      '/accounts',
      '/credentials',
      '/messages',
      '/badges',
      '/relays',
      '/terms',
      '/about',
    ];

    const normalizedPath = path.toLowerCase().replace(/\/$/, ''); // Remove trailing slash
    if (staticRoutes.includes(normalizedPath)) {
      return [normalizedPath];
    }

    return null;
  }

  /**
   * Map URL path type prefix to internal route
   */
  private mapTypeToRoute(type: string, identifier: string): string | null {
    // Route mappings based on path prefix
    const profileTypes = ['p', 'profile', 'users', 'people', 'u'];
    const eventTypes = ['e', 'event', 'note', 'notes', 'n'];
    const articleTypes = ['a', 'article', 'release'];

    if (profileTypes.includes(type)) {
      // For profile types, decode nprofile to get npub
      const npub = this.extractNpubFromIdentifier(identifier);
      return npub ? `/p/${npub}` : null;
    } else if (eventTypes.includes(type)) {
      return `/e/${identifier}`;
    } else if (articleTypes.includes(type)) {
      // For naddr identifiers, decode and route to specific section (e.g. music)
      if (identifier.toLowerCase().startsWith('naddr1')) {
        return this.mapNaddrToRoute(identifier);
      }
      return `/a/${identifier}`;
    }

    return null;
  }

  /**
   * Map a Nostr identifier to internal route based on its prefix
   */
  private mapIdentifierToRoute(identifier: string): string | null {
    const lowerIdentifier = identifier.toLowerCase();

    // Profile identifiers - decode nprofile to npub
    if (lowerIdentifier.startsWith('npub1')) {
      return `/p/${identifier}`;
    }

    if (lowerIdentifier.startsWith('nprofile1')) {
      const npub = this.extractNpubFromIdentifier(identifier);
      return npub ? `/p/${npub}` : null;
    }

    // Event identifiers
    if (lowerIdentifier.startsWith('note1') || lowerIdentifier.startsWith('nevent1')) {
      return `/e/${identifier}`;
    }

    // Article/address identifiers
    if (lowerIdentifier.startsWith('naddr1')) {
      return this.mapNaddrToRoute(identifier);
    }

    return null;
  }

  /**
   * Decode an naddr1 identifier and route music kinds to the music section.
   * Falls back to /a/{naddr} for non-music addressable events.
   */
  private mapNaddrToRoute(identifier: string): string | null {
    try {
      const decoded = nip19.decode(identifier);
      if (decoded.type === 'naddr') {
        const data = decoded.data as { kind: number; pubkey: string; identifier: string };
        const npub = nip19.npubEncode(data.pubkey);

        if (data.kind === 34139) {
          // Music playlist - route directly to music playlist page
          return `/music/playlist/${npub}/${data.identifier}`;
        }

        if (data.kind === 36787) {
          // Music track - route directly to song detail page
          return `/music/song/${npub}/${data.identifier}`;
        }
      }
    } catch (error) {
      this.logger.warn('[ExternalLinkHandler] Failed to decode naddr:', identifier, error);
    }

    // Fallback to generic article/addressable route
    return `/a/${identifier}`;
  }

  /**
   * Extract npub from a Nostr identifier (npub, nprofile, or hex pubkey)
   */
  private extractNpubFromIdentifier(identifier: string): string | null {
    const lowerIdentifier = identifier.toLowerCase();

    try {
      // Already an npub - return as is
      if (lowerIdentifier.startsWith('npub1')) {
        return identifier;
      }

      // Decode nprofile to get pubkey, then encode to npub
      if (lowerIdentifier.startsWith('nprofile1')) {
        const decoded = nip19.decode(identifier);
        if (decoded.type === 'nprofile') {
          const profileData = decoded.data as ProfilePointer;
          return nip19.npubEncode(profileData.pubkey);
        }
      }

      // Hex pubkey - encode to npub
      if (/^[0-9a-f]{64}$/i.test(identifier)) {
        return nip19.npubEncode(identifier);
      }

      return null;
    } catch (error) {
      this.logger.warn('[ExternalLinkHandler] Failed to extract npub from identifier:', identifier, error);
      return null;
    }
  }

  /**
   * Normalize a domain by removing protocol, www prefix, paths, and trailing slashes
   */
  private normalizeDomain(domain: string): string {
    return domain
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '')  // Remove multiple trailing slashes
      .split('/')[0]        // Remove any path components
      .toLowerCase();
  }

  /**
   * Reset to default domains
   */
  resetToDefaults(): void {
    this.setConfiguredDomains([...this.DEFAULT_DOMAINS]);
  }
}
