import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LoginDialogComponent } from './login-dialog.component';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { MnemonicService } from '../../services/mnemonic.service';
import { RegionService } from '../../services/region.service';
import { DiscoveryRelayService } from '../../services/discovery-relay.service';
import { Profile } from '../../services/profile';
import { AccountStateService } from '../../services/account-state.service';
import { DataService } from '../../services/data.service';
import { LayoutService } from '../../services/layout.service';

describe('LoginDialogComponent', () => {
    let component: LoginDialogComponent;
    let fixture: ComponentFixture<LoginDialogComponent>;

    function createComponent() {
        TestBed.configureTestingModule({
            imports: [LoginDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: MatDialogRef, useValue: { close: vi.fn() } },
                { provide: MatDialog, useValue: { open: vi.fn() } },
                { provide: MatSnackBar, useValue: { open: vi.fn() } },
                { provide: NostrService, useValue: {
                        loginWithExtension: vi.fn(),
                        loginWithNsec: vi.fn(),
                        loginWithNostrConnect: vi.fn(),
                        generateNewKey: vi.fn(),
                        usePreviewAccount: vi.fn(),
                        switchToUser: vi.fn(),
                        removeAccount: vi.fn(),
                        setAccount: vi.fn(),
                        hasRelayConfiguration: vi.fn(),
                        setupNewAccountWithDefaults: vi.fn(),
                        users: vi.fn().mockReturnValue([]),
                    } },
                { provide: LoggerService, useValue: {
                        debug: vi.fn(),
                        info: vi.fn(),
                        error: vi.fn(),
                        warn: vi.fn(),
                    } },
                { provide: MnemonicService, useValue: {
                        isMnemonic: vi.fn().mockReturnValue(false),
                    } },
                { provide: RegionService, useValue: {
                        regions: vi.fn().mockReturnValue([]),
                    } },
                { provide: DiscoveryRelayService, useValue: {
                        checkServerLatency: vi.fn(),
                        getServersByLatency: vi.fn().mockReturnValue([]),
                    } },
                { provide: Profile, useValue: {
                        createInitialProfile: vi.fn(),
                    } },
                { provide: AccountStateService, useValue: {
                        account: vi.fn().mockReturnValue(null),
                        addToCache: vi.fn(),
                        profile: { set: vi.fn() },
                    } },
                { provide: DataService, useValue: {
                        toRecord: vi.fn(),
                    } },
                { provide: LayoutService, useValue: {
                        openTermsOfUse: vi.fn(),
                        handleTermsDialogClose: vi.fn(),
                        isMobile: vi.fn().mockReturnValue(false),
                    } },
            ],
        });

        fixture = TestBed.createComponent(LoginDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    }

    it('should create', () => {
        createComponent();
        expect(component).toBeTruthy();
    });

    it('should start on INITIAL step', () => {
        createComponent();
        expect(component.currentStep()).toBe('initial');
    });

    it('should navigate to region selection on startNewAccountFlow', () => {
        createComponent();
        component.startNewAccountFlow();
        expect(component.currentStep()).toBe('region');
    });

    it('should validate empty nsec key as invalid', () => {
        createComponent();
        component.nsecKey = '';
        expect(component.isNsecKeyValid()).toBe(false);
    });

    it('should validate a 64-char hex string as valid nsec key', () => {
        createComponent();
        component.nsecKey = 'a'.repeat(64);
        expect(component.isNsecKeyValid()).toBe(true);
    });

    it('should validate a short hex string as invalid nsec key', () => {
        createComponent();
        component.nsecKey = 'abcdef';
        expect(component.isNsecKeyValid()).toBe(false);
    });

    it('should close dialog when closeDialog is called', () => {
        createComponent();
        const dialogRef = TestBed.inject(MatDialogRef);
        component.closeDialog();
        expect(dialogRef.close).toHaveBeenCalled();
    });

    it('should navigate steps with goToStep', () => {
        createComponent();
        component.goToStep('nsec' as never);
        expect(component.currentStep()).toBe('nsec');
    });
});
