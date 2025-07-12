import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { ApplicationStateService } from './application-state.service';
import { nip47 } from 'nostr-tools';

export interface Wallet {
  pubkey: string;
  connections: string[];
}

@Injectable({
  providedIn: 'root'
})
export class Wallets {
  localStorage = inject(LocalStorageService);
  appState = inject(ApplicationStateService);
  wallets = signal<Record<string, Wallet>>(this.localStorage.getObject(this.appState.WALLETS_KEY) || {});

  hasWallets = computed(() => Object.keys(this.wallets()).length > 0);

  constructor() {
    console.log('Wallets service initialized', this.wallets());

    effect(() => {
      const wallets = this.wallets();
      console.log('Wallets updated in local storage', wallets);
    });
  }

  parseConnectionString(connectionString: string) {
    const { host, pathname, searchParams } = new URL(connectionString)
    const pubkey = pathname || host
    const relay = searchParams.getAll('relay')
    const secret = searchParams.get('secret')

    if (!pubkey || !relay || !secret) {
      throw new Error('invalid connection string')
    }

    return { pubkey, relay, secret }
  }

  addWallet(pubkey: string, connection: string, data: any) {
    debugger;
    const currentWallet = this.wallets()[pubkey] || { pubkey, connections: [], data };
    if (!currentWallet.connections.includes(connection)) {
      currentWallet.connections.push(connection);
      this.wallets.set({ ...this.wallets(), [pubkey]: currentWallet });
    }

    this.save();
  }

  save() {
    this.localStorage.setObject(this.appState.WALLETS_KEY, this.wallets());
    console.log('Wallets saved to local storage', this.wallets());
  }
}
