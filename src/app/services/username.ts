import { inject, Injectable } from '@angular/core';
import { AccountStateService } from './account-state.service';

@Injectable({
  providedIn: 'root'
})
export class UsernameService {
  accountState = inject(AccountStateService);

  constructor() {

  }

  async getUsername(pubkey: string): Promise<string> {
    const sub = this.accountState.subscription();

    if (sub && sub.pubkey == pubkey && sub.username) {
      return sub.username!;
    }

    // TODO: Implement query and cache for username mapping.
    return '';
  }
}
