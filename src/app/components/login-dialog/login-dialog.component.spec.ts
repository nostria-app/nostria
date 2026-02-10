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
        { provide: MatDialogRef, useValue: { close: jasmine.createSpy('close') } },
        { provide: MatDialog, useValue: { open: jasmine.createSpy('open') } },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy('open') } },
        { provide: NostrService, useValue: {
          loginWithExtension: jasmine.createSpy('loginWithExtension'),
          loginWithNsec: jasmine.createSpy('loginWithNsec'),
          loginWithNostrConnect: jasmine.createSpy('loginWithNostrConnect'),
          generateNewKey: jasmine.createSpy('generateNewKey'),
          usePreviewAccount: jasmine.createSpy('usePreviewAccount'),
          switchToUser: jasmine.createSpy('switchToUser'),
          removeAccount: jasmine.createSpy('removeAccount'),
          setAccount: jasmine.createSpy('setAccount'),
          hasRelayConfiguration: jasmine.createSpy('hasRelayConfiguration'),
          setupNewAccountWithDefaults: jasmine.createSpy('setupNewAccountWithDefaults'),
          users: jasmine.createSpy('users').and.returnValue([]),
        }},
        { provide: LoggerService, useValue: {
          debug: jasmine.createSpy('debug'),
          info: jasmine.createSpy('info'),
          error: jasmine.createSpy('error'),
          warn: jasmine.createSpy('warn'),
        }},
        { provide: MnemonicService, useValue: {
          isMnemonic: jasmine.createSpy('isMnemonic').and.returnValue(false),
        }},
        { provide: RegionService, useValue: {
          regions: jasmine.createSpy('regions').and.returnValue([]),
        }},
        { provide: DiscoveryRelayService, useValue: {
          checkServerLatency: jasmine.createSpy('checkServerLatency'),
          getServersByLatency: jasmine.createSpy('getServersByLatency').and.returnValue([]),
        }},
        { provide: Profile, useValue: {
          createInitialProfile: jasmine.createSpy('createInitialProfile'),
        }},
        { provide: AccountStateService, useValue: {
          account: jasmine.createSpy('account').and.returnValue(null),
          addToCache: jasmine.createSpy('addToCache'),
          profile: { set: jasmine.createSpy('set') },
        }},
        { provide: DataService, useValue: {
          toRecord: jasmine.createSpy('toRecord'),
        }},
        { provide: LayoutService, useValue: {
          openTermsOfUse: jasmine.createSpy('openTermsOfUse'),
          handleTermsDialogClose: jasmine.createSpy('handleTermsDialogClose'),
          isMobile: jasmine.createSpy('isMobile').and.returnValue(false),
        }},
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
    expect(component.isNsecKeyValid()).toBeFalse();
  });

  it('should validate a 64-char hex string as valid nsec key', () => {
    createComponent();
    component.nsecKey = 'a'.repeat(64);
    expect(component.isNsecKeyValid()).toBeTrue();
  });

  it('should validate a short hex string as invalid nsec key', () => {
    createComponent();
    component.nsecKey = 'abcdef';
    expect(component.isNsecKeyValid()).toBeFalse();
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
