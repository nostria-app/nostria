import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { LoggerService } from './logger.service';
import { nip19 } from 'nostr-tools';
import { Wallets } from './wallets';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root',
})
export class NostrProtocolService {
  private readonly router = inject(Router);
  private readonly logger = inject(LoggerService);
  private readonly wallets = inject(Wallets);
  private readonly snackBar = inject(MatSnackBar);

  /**
   * Handles nostr protocol URLs by parsing the URI and navigating to the appropriate route
   */
  async handleNostrProtocol(url: string): Promise<void> {
    this.logger.info('[NostrProtocol] ==> Starting protocol handling');
    this.logger.info('[NostrProtocol] Input URL:', url);
    this.logger.info('[NostrProtocol] URL type:', typeof url);
    this.logger.info('[NostrProtocol] URL length:', url?.length || 'undefined');

    try {
      this.logger.debug('[NostrProtocol] Creating URL object from:', url);

      let urlObj: URL;
      try {
        urlObj = new URL(url);
        this.logger.debug('[NostrProtocol] URL object created successfully');
        this.logger.debug('[NostrProtocol] URL href:', urlObj.href);
        this.logger.debug('[NostrProtocol] URL search:', urlObj.search);
        this.logger.debug(
          '[NostrProtocol] URL searchParams keys:',
          Array.from(urlObj.searchParams.keys())
        );
      } catch (urlError) {
        this.logger.error('[NostrProtocol] Failed to create URL object:', urlError);
        throw new Error(`Invalid URL format: ${url}`);
      }

      // Extract parameters from the URL
      this.logger.debug('[NostrProtocol] Extracting parameters from URL');
      const urlParams = new URLSearchParams(urlObj.search);
      this.logger.debug(
        '[NostrProtocol] URLSearchParams created, available keys:',
        Array.from(urlParams.keys())
      );

      const nostrValue = urlParams.get('nostr');
      const nwcValue = urlParams.get('nwc');

      this.logger.debug('[NostrProtocol] Raw nostr parameter value:', nostrValue);
      this.logger.debug('[NostrProtocol] Raw nwc parameter value:', nwcValue);

      const valueToProcess = nwcValue || nostrValue;

      if (!valueToProcess) {
        this.logger.warn('[NostrProtocol] No nostr or nwc parameter found in URL');
        this.logger.warn('[NostrProtocol] Available parameters:', Array.from(urlParams.entries()));
        this.logger.warn('[NostrProtocol] Full URL breakdown:', {
          href: urlObj.href,
          origin: urlObj.origin,
          pathname: urlObj.pathname,
          search: urlObj.search,
          hash: urlObj.hash,
        });
        return;
      }

      // Check for Wallet Connect
      if (
        nwcValue ||
        valueToProcess.startsWith('nostr+walletconnect:') ||
        valueToProcess.startsWith('web+nostr+walletconnect:')
      ) {
        this.logger.info('[NostrProtocol] Wallet Connect protocol detected');
        try {
          // Remove web+ prefix if present to get the standard nostr+walletconnect URI
          let walletConnectUri = valueToProcess;
          if (walletConnectUri.startsWith('web+')) {
            walletConnectUri = walletConnectUri.substring(4);
          }

          const parsed = this.wallets.parseConnectionString(walletConnectUri);
          this.wallets.addWallet(parsed.pubkey, walletConnectUri, {
            relay: parsed.relay,
            secret: parsed.secret,
          });

          this.snackBar.open('Wallet added successfully', 'Dismiss', {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
          });

          await this.router.navigate(['/credentials']);
        } catch (error) {
          this.logger.error('[NostrProtocol] Failed to add wallet:', error);
          this.snackBar.open(
            'Failed to add wallet. Please check the connection string.',
            'Dismiss',
            {
              duration: 3000,
              horizontalPosition: 'center',
              verticalPosition: 'bottom',
            }
          );
        }
        return;
      }

      // Clean the nostr value by removing web+nostr:// protocol wrapper if present
      this.logger.debug('[NostrProtocol] Cleaning nostr value of protocol wrappers');
      let cleanedNostrValue = valueToProcess;

      cleanedNostrValue = cleanedNostrValue.replace('web+nostr://', '');
      cleanedNostrValue = cleanedNostrValue.replace('web+nostr:', '');

      this.logger.debug('[NostrProtocol] Extracted content after replace:', cleanedNostrValue);

      // Remove trailing slash if present
      if (cleanedNostrValue.endsWith('/')) {
        this.logger.debug('[NostrProtocol] Removing trailing slash');
        cleanedNostrValue = cleanedNostrValue.slice(0, -1);
      }

      this.logger.debug('[NostrProtocol] Cleaned nostr value:', cleanedNostrValue);

      // Ensure it has the nostr: prefix
      this.logger.debug('[NostrProtocol] Checking if cleaned value has nostr: prefix');
      const hasPrefix = cleanedNostrValue.startsWith('nostr:');
      this.logger.debug('[NostrProtocol] Has nostr: prefix:', hasPrefix);

      const nostrUri = hasPrefix ? cleanedNostrValue : `nostr:${cleanedNostrValue}`;
      this.logger.info('[NostrProtocol] Final nostr URI to process:', nostrUri);

      // Parse the nostr URI
      this.logger.debug('[NostrProtocol] Calling parsing service to parse nostr URI');
      const parseStartTime = Date.now();

      const parsed = nip19.decodeNostrURI(nostrUri);

      const parseEndTime = Date.now();
      this.logger.debug(
        '[NostrProtocol] Parsing completed in:',
        parseEndTime - parseStartTime,
        'ms'
      );
      this.logger.debug('[NostrProtocol] Parse result:', parsed);

      if (!parsed) {
        this.logger.error('[NostrProtocol] Failed to parse nostr URI');
        this.logger.error('[NostrProtocol] Original URL:', url);
        this.logger.error('[NostrProtocol] Extracted nostr value:', nostrValue);
        this.logger.error('[NostrProtocol] Final nostr URI:', nostrUri);
        return;
      }

      this.logger.info('[NostrProtocol] Successfully parsed nostr URI');
      this.logger.info('[NostrProtocol] Parsed type:', parsed.type);
      this.logger.info('[NostrProtocol] Parsed data:', parsed.data);

      // Route based on the type
      this.logger.debug('[NostrProtocol] Calling routeByNostrType with:', {
        type: parsed.type,
        data: parsed.data,
      });
      await this.routeByNostrType(parsed.type, parsed.data);

      this.logger.info('[NostrProtocol] ==> Protocol handling completed successfully');
    } catch (error) {
      this.logger.error('[NostrProtocol] ==> ERROR: Protocol handling failed');
      this.logger.error('[NostrProtocol] Error details:', error);
      this.logger.error('[NostrProtocol] Original URL that caused error:', url);

      // Log additional context
      if (error instanceof Error) {
        this.logger.error('[NostrProtocol] Error name:', error.name);
        this.logger.error('[NostrProtocol] Error message:', error.message);
        this.logger.error('[NostrProtocol] Error stack:', error.stack);
      }

      // Log environment info
      this.logger.error('[NostrProtocol] User agent:', navigator?.userAgent || 'unknown');
      this.logger.error('[NostrProtocol] Current location:', window?.location?.href || 'unknown');
      this.logger.error('[NostrProtocol] Timestamp:', new Date().toISOString());
    }
  }

  /**
   * Routes to the appropriate page based on the nostr URI type and data
   */
  private async routeByNostrType(type: string, data: any): Promise<void> {
    this.logger.info('[NostrProtocol] --> Starting routing by type');
    this.logger.info('[NostrProtocol] Type:', type);
    this.logger.info('[NostrProtocol] Data:', data);
    this.logger.info('[NostrProtocol] Data type:', typeof data);

    if (data && typeof data === 'object') {
      this.logger.debug('[NostrProtocol] Data object keys:', Object.keys(data));
      this.logger.debug('[NostrProtocol] Data object values:', Object.values(data));
    }

    try {
      switch (type) {
        case 'npub':
          this.logger.info('[NostrProtocol] Routing to profile page for npub');
          this.logger.debug('[NostrProtocol] Profile pubkey:', data);
          await this.router.navigate([{ outlets: { right: ['p', data] } }]);
          this.logger.info('[NostrProtocol] Successfully navigated to profile page');
          break;

        case 'nprofile':
          this.logger.info('[NostrProtocol] Routing to profile page for nprofile');
          this.logger.debug('[NostrProtocol] Profile data:', data);
          this.logger.debug('[NostrProtocol] Profile pubkey:', data?.pubkey);

          if (!data?.pubkey) {
            this.logger.error('[NostrProtocol] No pubkey found in nprofile data:', data);
            throw new Error('Invalid nprofile data: missing pubkey');
          }

          await this.router.navigate([{ outlets: { right: ['p', data.pubkey] } }]);
          this.logger.info('[NostrProtocol] Successfully navigated to profile page from nprofile');
          break;

        case 'note':
          this.logger.info('[NostrProtocol] Routing to event page for note');
          this.logger.debug('[NostrProtocol] Note id:', data);
          await this.router.navigate([{ outlets: { right: ['e', data] } }]);
          this.logger.info('[NostrProtocol] Successfully navigated to event page');
          break;

        case 'nevent':
          this.logger.info('[NostrProtocol] Routing to event page for nevent');
          this.logger.debug('[NostrProtocol] Event data:', data);
          this.logger.debug('[NostrProtocol] Event id:', data?.id);

          if (!data?.id) {
            this.logger.error('[NostrProtocol] No id found in nevent data:', data);
            throw new Error('Invalid nevent data: missing id');
          }

          await this.router.navigate([{ outlets: { right: ['e', data.id] } }]);
          this.logger.info('[NostrProtocol] Successfully navigated to event page from nevent');
          break;

        case 'naddr':
          this.logger.info('[NostrProtocol] Routing for naddr (address pointer)');
          this.logger.debug('[NostrProtocol] Address data:', data);
          this.logger.debug('[NostrProtocol] Address identifier:', data?.identifier);

          // For address pointers, we might need to construct a specific route
          // For now, navigate to the event page with the identifier
          if (data?.identifier) {
            this.logger.debug(
              '[NostrProtocol] Using identifier for naddr routing:',
              data.identifier
            );
            await this.router.navigate([{ outlets: { right: ['e', data.identifier] } }]);
            this.logger.info('[NostrProtocol] Successfully navigated to event page from naddr');
          } else {
            this.logger.error('[NostrProtocol] No identifier found in naddr data:', data);
            this.logger.warn(
              '[NostrProtocol] Falling back to home page for naddr without identifier'
            );
            await this.router.navigate(['/']);
          }
          break;

        default:
          this.logger.warn('[NostrProtocol] Unknown/unsupported nostr URI type:', type);
          this.logger.warn('[NostrProtocol] Available data for unknown type:', data);
          this.logger.info('[NostrProtocol] Falling back to home page for unknown type');
          // Navigate to home page as fallback
          await this.router.navigate(['/']);
          break;
      }

      this.logger.info('[NostrProtocol] --> Routing completed successfully');
    } catch (routingError) {
      this.logger.error('[NostrProtocol] --> ERROR: Routing failed');
      this.logger.error('[NostrProtocol] Routing error:', routingError);
      this.logger.error('[NostrProtocol] Failed for type:', type);
      this.logger.error('[NostrProtocol] Failed for data:', data);

      // Attempt fallback navigation to home
      try {
        this.logger.info('[NostrProtocol] Attempting fallback navigation to home');
        await this.router.navigate(['/']);
        this.logger.info('[NostrProtocol] Fallback navigation to home successful');
      } catch (fallbackError) {
        this.logger.error('[NostrProtocol] Even fallback navigation failed:', fallbackError);
      }
    }
  }
}
