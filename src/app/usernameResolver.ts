import { inject, Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, Resolve } from '@angular/router';
import { from, Observable } from 'rxjs';
import { AccountStateService } from './services/account-state.service';
import { UsernameService } from './services/username';

@Injectable({ providedIn: 'root' })
export class UsernameResolver implements Resolve<{ id: string | undefined; username: string }> {
  private usernameService = inject(UsernameService);
  private accountState = inject(AccountStateService);

  resolve(route: ActivatedRouteSnapshot): Observable<{ id: string | undefined; username: string }> {
    const username = route.params['username'] as string;

    const sub = this.accountState.subscription();

    if (sub && sub.username === username) {
      return new Observable((observer) => {
        observer.next({ id: sub.pubkey, username });
        observer.complete();
      });
    }

    return from(
      this.usernameService.getPubkey(username).then((pubkey) => ({ id: pubkey, username })),
    );
  }
}
