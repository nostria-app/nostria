/* eslint-disable @typescript-eslint/no-explicit-any */
import { signal } from '@angular/core';
import { WalletComponent } from './wallet.component';

function createComponent(): WalletComponent {
    const component = Object.create(WalletComponent.prototype) as WalletComponent;

    // Initialize signals
    (component as any).isAddingWallet = signal(false);
    (component as any).editingWallet = signal<string | null>(null);
    (component as any).expandedWallet = signal<string | null>(null);
    (component as any).selectedConnectionString = signal<string | null>(null);
    (component as any).selectedDonationAmount = signal<number | null>(5);
    (component as any).isDonating = signal(false);
    (component as any).donationSuccess = signal(false);
    (component as any).donationError = signal<string | null>(null);
    (component as any).activeTabIndex = signal(0);

    // Mock services
    (component as any).customDialog = {
        open: vi.fn(),
    };
    (component as any).wallets = {
        wallets: signal({}),
    };
    (component as any).nwcService = {
        getWalletData: vi.fn().mockReturnValue(null),
    };
    (component as any).settingsService = {
        settings: signal({ hideWalletAmounts: false }),
    };
    (component as any).snackBar = {
        open: vi.fn(),
    };

    return component;
}

describe('WalletComponent', () => {
    describe('openAddWalletDialog', () => {
        it('should open the add wallet dialog with title and width', () => {
            const component = createComponent();
            component.openAddWalletDialog();

            expect((component as any).customDialog.open).toHaveBeenCalledTimes(1);
            const args = vi.mocked((component as any).customDialog.open).mock.lastCall;
            expect(args[1].title).toBeTruthy();
            expect(args[1].width).toBe('500px');
        });

        it('should not pass headerIcon to the dialog config', () => {
            const component = createComponent();
            component.openAddWalletDialog();

            const args = vi.mocked((component as any).customDialog.open).mock.lastCall;
            expect(args[1].headerIcon).toBeUndefined();
        });
    });

    describe('getWalletEntries', () => {
        it('should return entries from the wallets signal', () => {
            const component = createComponent();
            (component as any).wallets.wallets = signal({
                pubkey1: { name: 'Test Wallet', connections: ['conn1'] },
            });

            const entries = component.getWalletEntries();
            expect(entries.length).toBe(1);
            expect(entries[0][0]).toBe('pubkey1');
            expect(entries[0][1].name).toBe('Test Wallet');
        });

        it('should return empty array when no wallets exist', () => {
            const component = createComponent();
            const entries = component.getWalletEntries();
            expect(entries.length).toBe(0);
        });
    });

    describe('getWalletName', () => {
        it('should return the wallet name when set', () => {
            const component = createComponent();
            expect(component.getWalletName({ pubkey: 'pk1', name: 'My Wallet', connections: [] })).toBe('My Wallet');
        });

        it('should return "Unnamed Wallet" when name is empty', () => {
            const component = createComponent();
            expect(component.getWalletName({ pubkey: 'pk1', name: '', connections: [] })).toBe('Unnamed Wallet');
        });
    });

    describe('getFirstConnectionString', () => {
        it('should return the first connection string', () => {
            const component = createComponent();
            expect(component.getFirstConnectionString({
                pubkey: 'pk1',
                name: 'Test',
                connections: ['conn1', 'conn2'],
            })).toBe('conn1');
        });

        it('should return empty string when no connections exist', () => {
            const component = createComponent();
            expect(component.getFirstConnectionString({
                pubkey: 'pk1',
                name: 'Test',
                connections: [],
            })).toBe('');
        });
    });

    describe('getDisplayBalance', () => {
        it('should return "..." when balance is undefined', () => {
            const component = createComponent();
            expect(component.getDisplayBalance(undefined)).toBe('...');
        });

        it('should return "****" when hideWalletAmounts is enabled', () => {
            const component = createComponent();
            (component as any).settingsService = {
                settings: signal({ hideWalletAmounts: true }),
            };
            expect(component.getDisplayBalance(100000)).toBe('****');
        });

        it('should format msats to sats', () => {
            const component = createComponent();
            expect(component.getDisplayBalance(1000000)).toBe('1,000');
        });
    });
});
