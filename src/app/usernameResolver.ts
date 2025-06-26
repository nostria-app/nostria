import { inject, Injectable } from "@angular/core";
import { ActivatedRouteSnapshot, Resolve } from "@angular/router";
import { AccountService } from "./api/services";
import { map, Observable } from "rxjs";
import { AccountStateService } from "./services/account-state.service";


@Injectable({ providedIn: 'root' })
export class UsernameResolver implements Resolve<{ id: string | undefined, username: string }> {
    accountService = inject(AccountService)
    accountState = inject(AccountStateService);

    resolve(route: ActivatedRouteSnapshot): Observable<{ id: string | undefined, username: string }> {
        const username = route.params['username'];

        const sub = this.accountState.subscription();

        if (sub && sub.username === username) {
            return new Observable(observer => {
                observer.next({ id: sub.pubkey, username });
                observer.complete();
            });
        }

        return this.accountService.getPublicAccount({ pubkeyOrUsername: username })
            .pipe(map(publicProfile => ({ id: publicProfile.result?.pubkey, username })))

    }
}