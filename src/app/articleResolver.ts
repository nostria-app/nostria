import { inject, Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, Resolve, Router } from '@angular/router';
import { from, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { nip05 } from 'nostr-tools';

export interface ArticleResolverData {
  pubkey: string | undefined;
  slug: string | undefined;
  identifier: string; // The original identifier (nip05 or npub/hex)
}

@Injectable({ providedIn: 'root' })
export class ArticleResolver implements Resolve<ArticleResolverData> {
  private router = inject(Router);

  resolve(route: ActivatedRouteSnapshot): Observable<ArticleResolverData> {
    const id = route.params['id'] as string;
    const slug = route.params['slug'] as string;

    // If we have a slug param, check if id contains @
    if (slug && id.includes('@')) {
      return from(this.resolveNip05Article(id, slug)).pipe(
        map(result => {
          if (!result.pubkey) {
            // Navigate to home if NIP-05 lookup failed
            this.router.navigate(['/']);
            return { pubkey: undefined, slug: undefined, identifier: id };
          }
          return result;
        }),
        catchError(error => {
          console.error('NIP-05 article resolution error:', error);
          this.router.navigate(['/']);
          return of({ pubkey: undefined, slug: undefined, identifier: id });
        })
      );
    }

    // For regular article URLs (naddr, npub, hex), return without resolving
    return of({ pubkey: undefined, slug, identifier: id });
  }

  private async resolveNip05Article(
    nip05Address: string,
    slug: string
  ): Promise<ArticleResolverData> {
    try {
      const profile = await nip05.queryProfile(nip05Address);

      if (profile && profile.pubkey) {
        return { pubkey: profile.pubkey, slug, identifier: nip05Address };
      }

      return { pubkey: undefined, slug, identifier: nip05Address };
    } catch (error) {
      console.error('Error querying NIP-05 profile for article:', error);
      return { pubkey: undefined, slug, identifier: nip05Address };
    }
  }
}
