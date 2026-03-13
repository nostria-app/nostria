import { computed, effect, inject, Injectable, Injector, signal, runInInjectionContext } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { ApplicationStateService } from './application-state.service';
import { AccountLocalStateService, AccountWallet } from './account-local-state.service';
import { LoggerService } from './logger.service';

// Re-export Wallet type for backwards compatibility
export type Wallet = AccountWallet;

// Import type only to avoid circular dependency at runtime
import type { AccountStateService as AccountStateServiceType } from './account-state.service';

@Injectable({
  providedIn: 'root',
})
export class Wallets {
  private readonly localStorage = inject(LocalStorageService);
  private readonly appState = inject(ApplicationStateService);
  private readonly accountLocalState = inject(AccountLocalStateService);
  private readonly injector = inject(Injector);
  private readonly logger = inject(LoggerService);

  // Cached reference to avoid repeated lookups
  private _accountState: AccountStateServiceType | null = null;

  // Track the current account pubkey
  private currentAccountPubkey = signal<string | null>(null);

  // Track if the effect has been set up
  private effectInitialized = false;

  wallets = signal<Record<string, Wallet>>({});

  hasWallets = computed(() => Object.keys(this.wallets()).length > 0);

  primaryWalletPubkey = computed(() => {
    const primaryEntry = this.getPrimaryWallet();
    return primaryEntry ? primaryEntry[0] : null;
  });

  constructor() {
    // Note: We don't log wallet data as it contains secrets

    // Defer initialization to avoid circular dependency during construction
    setTimeout(() => this.initialize(), 0);
  }

  /**
   * Get AccountStateService lazily to avoid circular dependency.
   * Uses dynamic import to break the module-level circular dependency.
   */
  private getAccountState(): AccountStateServiceType {
    if (!this._accountState) {
      // Use dynamic import to get the class at runtime
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const module = require('./account-state.service');
      this._accountState = this.injector.get(module.AccountStateService);
    }
    return this._accountState!;
  }

  /**
   * Initialize the service after construction to avoid circular dependency
   */
  private initialize(): void {
    if (this.effectInitialized) return;
    this.effectInitialized = true;

    this.logger.debug('[Wallets] Initializing wallet service...');

    // Perform one-time migration of global wallets to all accounts
    this.migrateGlobalWalletsToAllAccounts();

    // Set up effect to reload wallets when account changes
    runInInjectionContext(this.injector, () => {
      effect(() => {
        const accountState = this.getAccountState();
        const accountPubkey = accountState.pubkey();
        const previousPubkey = this.currentAccountPubkey();

        this.logger.debug('[Wallets] Account change detected:', {
          accountPubkey: accountPubkey ? accountPubkey.substring(0, 8) + '...' : 'none',
          previousPubkey: previousPubkey ? previousPubkey.substring(0, 8) + '...' : 'none'
        });

        // Only reload if the account actually changed
        if (accountPubkey !== previousPubkey) {
          this.currentAccountPubkey.set(accountPubkey);
          this.loadWalletsForAccount(accountPubkey);
        }
      });
    });
  }

  /**
   * One-time migration: Copy wallets from old "nostria-wallets" storage to all accounts
   * in "nostria-state", then delete the old storage key.
   */
  private migrateGlobalWalletsToAllAccounts(): void {
    // Check if there are wallets in the old global storage
    const globalWallets = this.localStorage.getObject<Record<string, Wallet>>(this.appState.WALLETS_KEY);

    if (!globalWallets || Object.keys(globalWallets).length === 0) {
      // No global wallets to migrate
      this.logger.debug('[Wallets] No global wallets to migrate');
      return;
    }

    // Get all account pubkeys from nostria-state
    const allStates = this.localStorage.getObject<Record<string, unknown>>('nostria-state') || {};
    const accountPubkeys = Object.keys(allStates);

    if (accountPubkeys.length === 0) {
      this.logger.debug('[Wallets] No accounts in nostria-state, keeping global wallets for later');
      return;
    }

    this.logger.debug(`[Wallets] Migrating ${Object.keys(globalWallets).length} wallet(s) to ${accountPubkeys.length} account(s)...`);

    // Copy wallets to each account that doesn't already have wallets
    for (const pubkey of accountPubkeys) {
      const existingWallets = this.accountLocalState.getWallets(pubkey);

      if (!existingWallets || Object.keys(existingWallets).length === 0) {
        this.accountLocalState.setWallets(pubkey, globalWallets);
        this.logger.debug(`[Wallets] Copied wallets to account ${pubkey.substring(0, 8)}...`);
      } else {
        this.logger.debug(`[Wallets] Account ${pubkey.substring(0, 8)}... already has wallets, skipping`);
      }
    }

    // Remove the old global storage key
    this.localStorage.removeItem(this.appState.WALLETS_KEY);
    this.logger.debug('[Wallets] Migration complete - removed old "nostria-wallets" storage');
  }

  /**
   * Load wallets for a specific account from storage
   */
  private loadWalletsForAccount(accountPubkey: string | null): void {
    if (!accountPubkey) {
      // No account logged in, clear wallets
      this.logger.debug('[Wallets] No account, clearing wallets');
      this.wallets.set({});
      return;
    }

    const storedWallets = this.accountLocalState.getWallets(accountPubkey);
    const migratedWallets = this.migrateCorruptedWallets(storedWallets, accountPubkey);
    const normalizedWallets = this.normalizePrimaryWallets(migratedWallets);

    if (normalizedWallets.changed) {
      this.accountLocalState.setWallets(accountPubkey, normalizedWallets.wallets);
    }

    this.logger.debug('[Wallets] Loading wallets for account:', {
      accountPubkey: accountPubkey.substring(0, 8) + '...',
      walletCount: Object.keys(normalizedWallets.wallets).length
    });

    this.wallets.set(normalizedWallets.wallets);
  }

  private normalizePrimaryWallets(wallets: Record<string, Wallet>): {
    wallets: Record<string, Wallet>;
    changed: boolean;
  } {
    const walletEntries = Object.entries(wallets);
    if (walletEntries.length === 0) {
      return { wallets, changed: false };
    }

    const primaryEntries = walletEntries.filter(([, wallet]) => wallet.isPrimary);
    const primaryPubkey = primaryEntries.length > 0 ? primaryEntries[0][0] : walletEntries[0][0];

    let changed = false;
    const normalizedWallets: Record<string, Wallet> = {};

    for (const [pubkey, wallet] of walletEntries) {
      const shouldBePrimary = pubkey === primaryPubkey;
      if ((wallet.isPrimary ?? false) !== shouldBePrimary) {
        changed = true;
      }

      normalizedWallets[pubkey] = {
        ...wallet,
        isPrimary: shouldBePrimary,
      };
    }

    return {
      wallets: normalizedWallets,
      changed,
    };
  }

  /**
   * Migrates wallet data to fix corrupted pubkeys with leading slashes.
   * This was caused by a bug in parseConnectionString that used pathname instead of host.
   */
  private migrateCorruptedWallets(wallets: Record<string, Wallet>, accountPubkey: string): Record<string, Wallet> {
    const migratedWallets: Record<string, Wallet> = {};
    let needsSave = false;

    for (const [key, wallet] of Object.entries(wallets)) {
      // Check if the key or pubkey has leading slashes
      const cleanKey = key.replace(/^\/+/, '');
      const cleanPubkey = wallet.pubkey.replace(/^\/+/, '');

      if (key !== cleanKey || wallet.pubkey !== cleanPubkey) {
        needsSave = true;
        console.warn(`[Wallets] Migrating corrupted wallet pubkey: ${key} -> ${cleanKey}`);
      }

      migratedWallets[cleanKey] = {
        ...wallet,
        pubkey: cleanPubkey,
      };
    }

    if (needsSave) {
      // Save the migrated wallets
      this.accountLocalState.setWallets(accountPubkey, migratedWallets);
      this.logger.debug('[Wallets] Corrupted wallet migration complete');
    }

    return migratedWallets;
  }

  parseConnectionString(connectionString: string) {
    const normalizedConnectionString = connectionString.startsWith('web+nostr+walletconnect://')
      ? connectionString.replace('web+nostr+walletconnect://', 'nostr+walletconnect://')
      : connectionString;

    const parsedUrl = new URL(normalizedConnectionString);
    if (parsedUrl.protocol !== 'nostr+walletconnect:') {
      throw new Error('invalid connection string');
    }

    const { host, pathname, searchParams } = parsedUrl;
    // The pathname may contain leading slashes (e.g., "//pubkey"), so we need to strip them
    // Use host as primary since it contains the clean pubkey without slashes
    const pubkey = host || pathname.replace(/^\/+/, '');
    const relay = searchParams.getAll('relay');
    const secret = searchParams.get('secret');

    if (!pubkey || !relay || !secret) {
      throw new Error('invalid connection string');
    }

    return { pubkey, relay, secret };
  }

  addWallet(pubkey: string, connection: string, data: { relay: string[]; secret: string }) {
    const currentWallets = this.wallets();
    const currentWallet = currentWallets[pubkey] || {
      pubkey,
      connections: [],
      data,
      name: this.generateWalletName(currentWallets),
      isPrimary: Object.keys(currentWallets).length === 0,
    };

    if (!currentWallet.connections.includes(connection)) {
      currentWallet.connections.push(connection);
      this.wallets.set({ ...currentWallets, [pubkey]: currentWallet });
    }

    this.save();
  }

  save() {
    const accountPubkey = this.currentAccountPubkey();
    if (!accountPubkey) {
      console.warn('[Wallets] Cannot save wallets - no account logged in');
      return;
    }
    this.accountLocalState.setWallets(accountPubkey, this.wallets());
  }

  removeWallet(pubkey: string) {
    const currentWallets = this.wallets();
    if (currentWallets[pubkey]) {
      const removedWasPrimary = currentWallets[pubkey].isPrimary ?? false;
      delete currentWallets[pubkey];

      if (removedWasPrimary) {
        const firstRemainingPubkey = Object.keys(currentWallets)[0];
        if (firstRemainingPubkey && currentWallets[firstRemainingPubkey]) {
          currentWallets[firstRemainingPubkey] = {
            ...currentWallets[firstRemainingPubkey],
            isPrimary: true,
          };
        }
      }

      this.wallets.set({ ...currentWallets });
      this.save();
    }
  }

  getPrimaryWallet(): [string, Wallet] | null {
    const walletEntries = Object.entries(this.wallets());
    if (walletEntries.length === 0) {
      return null;
    }

    const explicitPrimary = walletEntries.find(([, wallet]) => wallet.isPrimary);
    return explicitPrimary || walletEntries[0];
  }

  setPrimaryWallet(pubkey: string): void {
    const currentWallets = this.wallets();
    if (!currentWallets[pubkey]) {
      return;
    }

    const updatedWallets: Record<string, Wallet> = {};
    for (const [walletPubkey, wallet] of Object.entries(currentWallets)) {
      updatedWallets[walletPubkey] = {
        ...wallet,
        isPrimary: walletPubkey === pubkey,
      };
    }

    this.wallets.set(updatedWallets);
    this.save();
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
