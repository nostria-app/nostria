import { inject, Injectable, signal } from '@angular/core';
import { AccountStateService } from './account-state.service';
import { AccountService } from '../api/services';
import { firstValueFrom, map } from 'rxjs';
import { ApiResponse } from '../api/models';
import { LocalStorageService } from './local-storage.service';
import { ApplicationStateService } from './application-state.service';

type UsernameByPubkeyMap = { [pubkey: string]: string };
type PubkeyByUsernameMap = { [username: string]: string };

@Injectable({
  providedIn: 'root',
})
export class UsernameService {
  private readonly localStorage = inject(LocalStorageService);
  private readonly appState = inject(ApplicationStateService);
  private accountState = inject(AccountStateService);
  private accountService = inject(AccountService);
  private usernameByKey = signal<UsernameByPubkeyMap>({});
  private pubkeyByUsername = signal<PubkeyByUsernameMap>({});

  constructor() {
    this.loadUsernamesCache();
  }

  private loadUsernamesCache() {
    const data = this.localStorage.getObject<UsernameByPubkeyMap>(
      this.appState.USERNAMES_STORAGE_KEY
    );

    console.log('load', data);

    if (data) {
      this.usernameByKey.set(data);

      // invert the map username → pubkey to pubkey → username
      const pubkeyByUsername = Object.keys(data).reduce(
        (acc, username) => ({
          ...acc,
          [data[username]]: username,
        }),
        {} as PubkeyByUsernameMap
      );
      this.pubkeyByUsername.set(pubkeyByUsername);
    }
  }

  private saveUsernameToCache(username: string, pubkey: string) {
    this.usernameByKey.set({
      ...this.usernameByKey(),
      [pubkey]: username,
    });
    this.pubkeyByUsername.set({
      ...this.pubkeyByUsername(),
      [username]: pubkey,
    });
    this.localStorage.setObject<UsernameByPubkeyMap>(
      this.appState.USERNAMES_STORAGE_KEY,
      this.usernameByKey()
    );
  }

  async getPubkey(username: string): Promise<string> {
    const sub = this.accountState.subscription();

    if (sub && sub.username == username && sub.pubkey) {
      return sub.pubkey;
    }

    const pubkey = this.pubkeyByUsername()[username];

    if (pubkey) return pubkey;

    const publicProfile = await firstValueFrom(
      this.accountService.getPublicAccount({ pubkeyOrUsername: username })
    );

    if (publicProfile && publicProfile.success && publicProfile.result) {
      const pubkey = publicProfile.result.pubkey || '';
      this.saveUsernameToCache(username, pubkey);
      return pubkey;
    }

    return '';
  }

  async getUsername(pubkey: string): Promise<string> {
    const sub = this.accountState.subscription();

    if (sub && sub.pubkey == pubkey && sub.username) {
      return sub.username!;
    }

    const username = this.usernameByKey()[pubkey];

    if (username) return username;

    const publicProfile = await firstValueFrom(
      this.accountService.getPublicAccount({ pubkeyOrUsername: pubkey })
    );

    if (publicProfile && publicProfile.success && publicProfile.result) {
      const username = publicProfile.result.username || '';
      this.saveUsernameToCache(username, pubkey);
      return username;
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
