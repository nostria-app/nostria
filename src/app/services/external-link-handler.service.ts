import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
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
    // If Ctrl/Cmd/Shift key is pressed, always open in new tab (browser default behavior)
    if (event && (event.ctrlKey || event.metaKey || event.shiftKey)) {
      return false;
    }

    if (!this.shouldHandleInternally(url)) {
      return false;
    }

    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname;

      this.logger.info('[ExternalLinkHandler] Handling link internally:', url);

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

      // Pattern 1: Path prefix patterns like /e/, /p/, /profile/, /note/, /users/, /people/, /u/, /n/
      const prefixMatch = path.match(/^\/(p|profile|e|event|a|article|note|notes|users|people|u|n)\/([a-zA-Z0-9]+)/i);

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
   * Map URL path type prefix to internal route
   */
  private mapTypeToRoute(type: string, identifier: string): string | null {
    // Route mappings based on path prefix
    const profileTypes = ['p', 'profile', 'users', 'people', 'u'];
    const eventTypes = ['e', 'event', 'note', 'notes', 'n'];
    const articleTypes = ['a', 'article'];

    if (profileTypes.includes(type)) {
      return `/p/${identifier}`;
    } else if (eventTypes.includes(type)) {
      return `/e/${identifier}`;
    } else if (articleTypes.includes(type)) {
      return `/a/${identifier}`;
    }

    return null;
  }

  /**
   * Map a Nostr identifier to internal route based on its prefix
   */
  private mapIdentifierToRoute(identifier: string): string | null {
    const lowerIdentifier = identifier.toLowerCase();

    // Profile identifiers
    if (lowerIdentifier.startsWith('npub1') || lowerIdentifier.startsWith('nprofile1')) {
      return `/p/${identifier}`;
    }

    // Event identifiers
    if (lowerIdentifier.startsWith('note1') || lowerIdentifier.startsWith('nevent1')) {
      return `/e/${identifier}`;
    }

    // Article/address identifiers
    if (lowerIdentifier.startsWith('naddr1')) {
      return `/a/${identifier}`;
    }

    return null;
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
