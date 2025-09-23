import { computed, effect, inject, Injectable, signal } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { ApplicationStateService } from './application-state.service';

export interface Wallet {
  pubkey: string;
  connections: string[];
  name?: string;
}

@Injectable({
  providedIn: 'root',
})
export class Wallets {
  localStorage = inject(LocalStorageService);
  appState = inject(ApplicationStateService);
  wallets = signal<Record<string, Wallet>>(
    this.localStorage.getObject(this.appState.WALLETS_KEY) || {}
  );

  hasWallets = computed(() => Object.keys(this.wallets()).length > 0);

  constructor() {
    console.log('Wallets service initialized', this.wallets());

    effect(() => {
      const wallets = this.wallets();
      console.log('Wallets updated in local storage', wallets);
    });
  }

  parseConnectionString(connectionString: string) {
    const { host, pathname, searchParams } = new URL(connectionString);
    const pubkey = pathname || host;
    const relay = searchParams.getAll('relay');
    const secret = searchParams.get('secret');

    if (!pubkey || !relay || !secret) {
      throw new Error('invalid connection string');
    }

    return { pubkey, relay, secret };
  }

  addWallet(pubkey: string, connection: string, data: any) {
    const currentWallets = this.wallets();
    const currentWallet = currentWallets[pubkey] || {
      pubkey,
      connections: [],
      data,
      name: this.generateWalletName(currentWallets),
    };

    if (!currentWallet.connections.includes(connection)) {
      currentWallet.connections.push(connection);
      this.wallets.set({ ...currentWallets, [pubkey]: currentWallet });
    }

    this.save();
  }

  save() {
    this.localStorage.setObject(this.appState.WALLETS_KEY, this.wallets());
    console.log('Wallets saved to local storage', this.wallets());
  }

  removeWallet(pubkey: string) {
    const currentWallets = this.wallets();
    if (currentWallets[pubkey]) {
      delete currentWallets[pubkey];
      this.wallets.set({ ...currentWallets });
      this.save();
    }
  }

  generateWalletName(wallets: Record<string, Wallet>): string {
    const existingNumbers = Object.values(wallets)
      .map(w => w.name || '')
      .filter(name => name.match(/^Wallet \d+$/))
      .map(name => parseInt(name.replace('Wallet ', '')))
      .sort((a, b) => a - b);

    let nextNumber = 1;
    for (const num of existingNumbers) {
      if (num === nextNumber) {
        nextNumber++;
      } else {
        break;
      }
    }

    return `Wallet ${nextNumber}`;
  }

  updateWalletName(pubkey: string, newName: string) {
    const currentWallets = this.wallets();
    if (currentWallets[pubkey]) {
      currentWallets[pubkey].name = newName;
      this.wallets.set({ ...currentWallets });
      this.save();
    }
  }
}
