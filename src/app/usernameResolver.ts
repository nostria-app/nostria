import { inject, Injectable } from "@angular/core";
import { ActivatedRouteSnapshot, Resolve } from "@angular/router";
import { AccountService } from "./api/services";
import { map, Observable } from "rxjs";


@Injectable({ providedIn: 'root' })
export class UsernameResolver implements Resolve<{ id: string | undefined, username: string }> {
    accountService = inject(AccountService)


    resolve(route: ActivatedRouteSnapshot): Observable<{ id: string | undefined, username: string }> {
        const username = route.params['username'];
        return this.accountService.getPublicAccount({ pubkeyOrUsername: username })
            .pipe(map(publicProfile => ({ id: publicProfile.result?.pubkey, username })))

    }
}