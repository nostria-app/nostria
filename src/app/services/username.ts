import { inject, Injectable } from '@angular/core';
import { AccountStateService } from './account-state.service';
import { AccountService } from '../api/services';

@Injectable({
  providedIn: 'root'
})
export class UsernameService {
  accountState = inject(AccountStateService);
  accountService = inject(AccountService);

  constructor() {

  }

  async getPubkey(username: string): Promise<string> {
    const sub = this.accountState.subscription();

    if (sub && sub.username == username && sub.pubkey) {
      return sub.pubkey;
    }

    debugger;

    let publicProfile = await this.accountService.getPublicAccount({ pubkeyOrUsername: username }).toPromise();

    if (publicProfile && publicProfile.success && publicProfile.result) {
      return publicProfile.result.pubkey || '';
    }

    return '';
  }

  async getUsername(pubkey: string): Promise<string> {
    const sub = this.accountState.subscription();

    if (sub && sub.pubkey == pubkey && sub.username) {
      return sub.username!;
    }

    let username = await this.accountService.getPublicAccount({ pubkeyOrUsername: pubkey }).toPromise();

    debugger;

    if (username && username.success && username.result) {
      return username.result.username || '';
    }

    return '';
  }
}
