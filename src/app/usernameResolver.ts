import { inject, Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, Resolve, Router } from '@angular/router';
import { from, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { nip05 } from 'nostr-tools';
import { AccountStateService } from './services/account-state.service';
import { UsernameService } from './services/username';
import { LoggerService } from './services/logger.service';

@Injectable({ providedIn: 'root' })
export class UsernameResolver implements Resolve<{ id: string | undefined; username: string }> {
  private usernameService = inject(UsernameService);
  private accountState = inject(AccountStateService);
  private router = inject(Router);
  private logger = inject(LoggerService);

  resolve(route: ActivatedRouteSnapshot): Observable<{ id: string | undefined; username: string }> {
    const username = route.params['username'] as string;
    this.logger.info('[UsernameResolver] Resolving username:', username);

    const sub = this.accountState.subscription();

    if (sub && sub.username === username) {
      this.logger.info('[UsernameResolver] Found username in subscription:', username);
      return of({ id: sub.pubkey, username });
    }

    // Check if this is a NIP-05 alias (contains @)
    if (username.includes('@')) {
      this.logger.info('[UsernameResolver] Resolving NIP-05 alias:', username);
      return from(this.resolveNip05(username)).pipe(
        map(result => {
          if (!result.id) {
            this.logger.warn('[UsernameResolver] NIP-05 lookup failed for:', username);
            // Navigate to home if NIP-05 lookup failed
            this.router.navigate(['/']);
            return { id: undefined, username };
          }
          this.logger.info('[UsernameResolver] NIP-05 lookup successful:', username, result.id);
          return result;
        }),
        catchError(error => {
          this.logger.error('[UsernameResolver] NIP-05 resolution error:', error);
          this.router.navigate(['/']);
          return of({ id: undefined, username });
        })
      );
    }

    // Regular username lookup
    this.logger.info('[UsernameResolver] Starting regular username lookup for:', username);
    return from(
      this.usernameService.getPubkey(username).then(pubkey => {
        this.logger.info('[UsernameResolver] getPubkey returned:', pubkey, 'for username:', username);
        return { id: pubkey, username };
      })
    ).pipe(
      map(result => {
        // If pubkey is empty string, the username lookup failed
        if (!result.id) {
          this.logger.warn('[UsernameResolver] Username lookup failed for:', username, '- navigating to home');
          // Navigate to home instead of breaking the route
          this.router.navigate(['/']);
          return { id: undefined, username };
        }
        this.logger.info('[UsernameResolver] Successfully resolved username:', username, 'to pubkey:', result.id);
        return result;
      }),
      catchError(error => {
        this.logger.error('[UsernameResolver] Username resolution error:', error);
        // Navigate to home on error
        this.router.navigate(['/']);
        return of({ id: undefined, username });
      })
    );
  }

  private async resolveNip05(nip05Address: string): Promise<{ id: string | undefined; username: string }> {
    try {
      this.logger.info('[UsernameResolver] Querying NIP-05 profile for:', nip05Address);
      const profile = await nip05.queryProfile(nip05Address);

      if (profile && profile.pubkey) {
        this.logger.info('[UsernameResolver] NIP-05 profile found:', profile.pubkey);
        return { id: profile.pubkey, username: nip05Address };
      }

      this.logger.warn('[UsernameResolver] NIP-05 profile not found for:', nip05Address);
      return { id: undefined, username: nip05Address };
    } catch (error) {
      this.logger.error('[UsernameResolver] Error querying NIP-05 profile:', error);
      return { id: undefined, username: nip05Address };
    }
  }
}
