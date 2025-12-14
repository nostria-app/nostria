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
    'snort.social',
    'iris.to',
    'coracle.social',
    'nostur.com',
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
      // Common patterns:
      // - /p/npub... or /profile/npub...
      // - /e/note... or /event/note...
      // - /e/nevent...
      // - /a/naddr...
      
      // Updated regex to match all valid Nostr identifier characters (alphanumeric + underscore)
      const pathMatch = path.match(/^\/(p|profile|e|event|a|article)\/([a-zA-Z0-9_]+)/i);
      
      if (pathMatch) {
        const [, type, identifier] = pathMatch;
        
        // Map the type to internal routes using a lookup object
        const routeMap: Record<string, string> = {
          p: '/p/',
          profile: '/p/',
          e: '/e/',
          event: '/e/',
          a: '/a/',
          article: '/a/',
        };
        
        const route = routeMap[type.toLowerCase()];
        
        if (route) {
          const fullRoute = route + identifier;
          this.logger.info('[ExternalLinkHandler] Navigating to:', fullRoute);
          this.router.navigate([fullRoute]);
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
