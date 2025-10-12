import { inject, Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, Resolve, Router } from '@angular/router';
import { from, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { AccountStateService } from './services/account-state.service';
import { UsernameService } from './services/username';

@Injectable({ providedIn: 'root' })
export class UsernameResolver implements Resolve<{ id: string | undefined; username: string }> {
  private usernameService = inject(UsernameService);
  private accountState = inject(AccountStateService);
  private router = inject(Router);

  resolve(route: ActivatedRouteSnapshot): Observable<{ id: string | undefined; username: string }> {
    const username = route.params['username'] as string;

    const sub = this.accountState.subscription();

    if (sub && sub.username === username) {
      return of({ id: sub.pubkey, username });
    }

    return from(
      this.usernameService.getPubkey(username).then(pubkey => ({ id: pubkey, username }))
    ).pipe(
      map(result => {
        // If pubkey is empty string, the username lookup failed
        if (!result.id) {
          // Navigate to home instead of breaking the route
          this.router.navigate(['/']);
          return { id: undefined, username };
        }
        return result;
      }),
      catchError(error => {
        console.error('UsernameResolver error:', error);
        // Navigate to home on error
        this.router.navigate(['/']);
        return of({ id: undefined, username });
      })
    );
  }
}
