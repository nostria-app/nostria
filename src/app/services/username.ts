import { inject, Injectable } from '@angular/core';
import { AccountStateService } from './account-state.service';
import { AccountService } from '../api/services';
import { firstValueFrom, map } from 'rxjs';
import { ApiResponse } from '../api/models';

@Injectable({
  providedIn: 'root'
})
export class UsernameService {
  private accountState = inject(AccountStateService);
  private accountService = inject(AccountService);

  constructor() {

  }

  async getPubkey(username: string): Promise<string> {
    const sub = this.accountState.subscription();

    if (sub && sub.username == username && sub.pubkey) {
      return sub.pubkey;
    }

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

    if (username && username.success && username.result) {
      return username.result.username || '';
    }

    return '';
  }


  /**
   * Checks if a username is available:
   * - not reserved
   * - is not taken by other account
   * @param username The username to check
   * @returns A boolean indicating whether the username is available
   */
  isUsernameAvailable(username: string): Promise<ApiResponse> {
    return firstValueFrom(this.accountService.checkUsername({ username }));
  }

}
