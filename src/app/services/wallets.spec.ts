import '@angular/compiler';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { Wallets } from './wallets';

function createService(initialWallets: Record<string, unknown> = {}): Wallets {
  const service = Object.create(Wallets.prototype) as Wallets;

  (service as unknown as { wallets: ReturnType<typeof signal<Record<string, unknown>>> }).wallets = signal(initialWallets);
  (service as unknown as { save: ReturnType<typeof vi.fn> }).save = vi.fn();

  return service;
}

describe('Wallets', () => {
  describe('addWallet', () => {
    it('uses lud16 from the connection string as the initial wallet name', () => {
      const service = createService();

      service.addWallet(
        'pubkey-1',
        'nostr+walletconnect://pubkey-1?relay=wss%3A%2F%2Frelay.example&secret=secret-1&lud16=alice%40wallet.example',
        {
          relay: ['wss://relay.example'],
          secret: 'secret-1',
        }
      );

      expect(service.wallets()['pubkey-1']).toMatchObject({
        name: 'alice@wallet.example',
        isPrimary: true,
      });
    });

    it('falls back to the generated Wallet N name when lud16 is missing', () => {
      const service = createService({
        'pubkey-existing': {
          pubkey: 'pubkey-existing',
          connections: ['nostr+walletconnect://pubkey-existing?relay=wss%3A%2F%2Frelay.example&secret=secret-existing'],
          name: 'Wallet 1',
        },
      });

      service.addWallet(
        'pubkey-2',
        'nostr+walletconnect://pubkey-2?relay=wss%3A%2F%2Frelay.example&secret=secret-2',
        {
          relay: ['wss://relay.example'],
          secret: 'secret-2',
        }
      );

      expect(service.wallets()['pubkey-2']).toMatchObject({
        name: 'Wallet 2',
      });
    });

    it('does not overwrite an existing wallet name when adding another connection', () => {
      const service = createService({
        'pubkey-1': {
          pubkey: 'pubkey-1',
          connections: ['nostr+walletconnect://pubkey-1?relay=wss%3A%2F%2Frelay.example&secret=secret-1'],
          name: 'Manual Name',
          isPrimary: true,
        },
      });

      service.addWallet(
        'pubkey-1',
        'nostr+walletconnect://pubkey-1?relay=wss%3A%2F%2Frelay2.example&secret=secret-2&lud16=alice%40wallet.example',
        {
          relay: ['wss://relay2.example'],
          secret: 'secret-2',
        }
      );

      expect(service.wallets()['pubkey-1']).toMatchObject({
        name: 'Manual Name',
      });
      expect(service.wallets()['pubkey-1'].connections).toHaveLength(2);
    });
  });
});