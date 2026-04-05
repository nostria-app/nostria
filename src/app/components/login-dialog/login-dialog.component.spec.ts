import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LoginDialogComponent } from './login-dialog.component';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { MnemonicService } from '../../services/mnemonic.service';
import { Profile } from '../../services/profile';
import { AccountStateService } from '../../services/account-state.service';
import { DataService } from '../../services/data.service';
import { LayoutService } from '../../services/layout.service';
import { RegionService } from '../../services/region.service';
import { AndroidSignerService } from '../../services/android-signer.service';
import { ApplicationService } from '../../services/application.service';
import { isTauri } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: vi.fn(() => false),
}));

describe('LoginDialogComponent', () => {
  let component: LoginDialogComponent;
  let fixture: ComponentFixture<LoginDialogComponent>;
  const mockedIsTauri = vi.mocked(isTauri);

  function createComponent() {
    TestBed.configureTestingModule({
      imports: [LoginDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        {
          provide: NostrService, useValue: {
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
          }
        },
        {
          provide: LoggerService, useValue: {
            debug: vi.fn(),
            info: vi.fn(),
            error: vi.fn(),
            warn: vi.fn(),
          }
        },
        {
          provide: MnemonicService, useValue: {
            isMnemonic: vi.fn().mockReturnValue(false),
          }
        },
        {
          provide: Profile, useValue: {
            createInitialProfile: vi.fn(),
          }
        },
        {
          provide: AccountStateService, useValue: {
            account: vi.fn().mockReturnValue(null),
            addToCache: vi.fn(),
            profile: { set: vi.fn() },
          }
        },
        {
          provide: DataService, useValue: {
            toRecord: vi.fn(),
          }
        },
        {
          provide: LayoutService, useValue: {
            openTermsOfUse: vi.fn(),
            handleTermsDialogClose: vi.fn(),
            isMobile: vi.fn().mockReturnValue(false),
          }
        },
        {
          provide: RegionService, useValue: {
            getRelayServer: vi.fn().mockReturnValue(null),
          }
        },
        {
          provide: AndroidSignerService, useValue: {
            isSupported: vi.fn().mockReturnValue(false),
          }
        },
        {
          provide: ApplicationService, useValue: {
            isBrowser: signal(true),
          }
        },
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

  it('should disable extension login in desktop tauri', () => {
    mockedIsTauri.mockReturnValue(true);
    createComponent();

    component.goToStep(component.LoginStep.LOGIN_OPTIONS);
    fixture.detectChanges();

    const extensionCard = fixture.nativeElement.querySelector('.login-card.extension');

    expect(component.isDesktopTauri()).toBe(true);
    expect(extensionCard?.getAttribute('aria-disabled')).toBe('true');
    expect(extensionCard?.textContent).toContain('Not available in desktop app');
  });
});
