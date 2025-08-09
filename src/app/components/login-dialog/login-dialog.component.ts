import { Component, inject, signal } from '@angular/core';

import {
  MatDialogModule,
  MatDialogRef,
  MatDialog,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { QrcodeScanDialogComponent } from '../qrcode-scan-dialog/qrcode-scan-dialog.component';
import { TermsOfUseDialogComponent } from '../terms-of-use-dialog/terms-of-use-dialog.component';
import { Region, RegionService } from '../../services/region.service';

// Define the login steps
enum LoginStep {
  INITIAL = 'initial',
  REGION_SELECTION = 'region',
  LOGIN_OPTIONS = 'login-options',
  NSEC_LOGIN = 'nsec',
  EXTENSION_LOADING = 'extension-loading',
  EXISTING_ACCOUNTS = 'existing-accounts',
  NOSTR_CONNECT = 'nostr-connect',
  PREVIEW = 'preview',
}

@Component({
  selector: 'app-unified-login-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatListModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    FormsModule,
  ],
  templateUrl: './login-dialog.component.html',
  styleUrl: './login-dialog.component.scss',
})
export class LoginDialogComponent {
  private dialogRef = inject(MatDialogRef<LoginDialogComponent>);
  private dialog = inject(MatDialog);
  nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  region = inject(RegionService);

  // Use signal for the current step
  currentStep = signal<LoginStep>(LoginStep.INITIAL);

  // For template access
  LoginStep = LoginStep;

  // Expose states as signals
  loading = signal(false);
  extensionError = signal<string | null>(null);
  nostrConnectUrl = signal('');
  nostrConnectError = signal<string | null>(null);
  nostrConnectLoading = signal<boolean>(false);
  selectedRegionId = signal<string | null>(null);

  // Region discovery signals (similar to welcome component)
  isDetectingRegion = signal(true);
  detectedRegion = signal('');
  showRegionSelector = signal(false);
  availableRegions = signal([
    { name: 'United States', latency: '45ms', flag: '🇺🇸', id: 'us' },
    { name: 'Europe', latency: '78ms', flag: '🇪🇺', id: 'eu' },
    { name: 'Asia Pacific', latency: '120ms', flag: '🌏', id: 'as' },
    { name: 'Africa', latency: '85ms', flag: '🌍', id: 'af' },
    { name: 'South America', latency: '95ms', flag: '🌎', id: 'sa' },
  ]);

  // Profile setup signals (similar to welcome component)
  displayName = signal('');
  profileImage = signal<string | null>(null);

  // Input fields
  nsecKey = '';
  previewPubkey =
    'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m'; // jack

  constructor() {
    this.logger.debug('UnifiedLoginDialogComponent initialized');
  }

  // Navigation methods
  goToStep(step: LoginStep): void {
    this.logger.debug('Changing login step', {
      from: this.currentStep(),
      to: step,
    });
    this.currentStep.set(step);
  }

  // Initial dialog methods
  startNewAccountFlow(): void {
    this.logger.debug('Starting account creation flow');
    this.goToStep(LoginStep.REGION_SELECTION);
    // Start region detection when entering region selection
    this.startRegionDetection();
  }

  // Region detection and selection methods (similar to welcome component)
  startRegionDetection(): void {
    this.logger.debug('Starting region detection');
    this.isDetectingRegion.set(true);
    this.detectedRegion.set('');

    // Simulate region detection process (you can replace with actual latency testing)
    setTimeout(() => {
      // Mock detection logic - find the region with lowest latency
      const sortedRegions = [...this.availableRegions()].sort(
        (a, b) => parseInt(a.latency) - parseInt(b.latency)
      );
      const bestRegion = sortedRegions[0];

      this.detectedRegion.set(bestRegion.name);
      this.selectedRegionId.set(bestRegion.id);
      this.isDetectingRegion.set(false);

      this.logger.debug('Region detection completed', {
        detectedRegion: bestRegion.name,
        selectedRegionId: bestRegion.id,
      });
    }, 2000); // 2 second delay to show detection process
  }

  toggleRegionSelector(): void {
    this.showRegionSelector.set(!this.showRegionSelector());
  }

  selectRegionManually(region: { name: string; id: string }): void {
    this.logger.debug('Manual region selection', { region });
    this.detectedRegion.set(region.name);
    this.selectedRegionId.set(region.id);
    this.showRegionSelector.set(false);
  }

  // Profile setup methods (similar to welcome component)
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const reader = new FileReader();

      reader.onload = e => {
        const result = e.target?.result as string;
        this.profileImage.set(result);
        this.logger.debug('Profile image selected');
      };

      reader.readAsDataURL(file);
    }
  }

  // Region selection methods
  selectRegion(region: Region): void {
    if (region.enabled) {
      this.logger.debug('Region selected', { region: region.id });
      this.selectedRegionId.set(region.id);
      this.generateNewKey();
    }
  }

  // Account generation - now includes profile setup
  generateNewKey(): void {
    this.logger.debug('Generating new key', {
      regionId: this.selectedRegionId(),
      displayName: this.displayName(),
      hasProfileImage: !!this.profileImage(),
    });
    if (this.selectedRegionId()) {
      this.loading.set(true);

      // TODO: Pass profile data to the service when it supports it
      // const profileData = {
      //   name: this.displayName() || undefined,
      //   picture: this.profileImage() || undefined,
      // };

      this.nostrService.generateNewKey(this.selectedRegionId()!);
      this.closeDialog();
    }
  }

  // Login dialog methods
  async loginWithExtension(): Promise<void> {
    this.logger.debug('Attempting login with extension');
    this.goToStep(LoginStep.EXTENSION_LOADING);
    this.extensionError.set(null);

    try {
      await this.nostrService.loginWithExtension();
      this.logger.debug('Login with extension successful');
      this.closeDialog();
    } catch (err) {
      this.logger.error('Login with extension failed', err);
      this.extensionError.set(
        err instanceof Error
          ? err.message
          : 'Unknown error connecting to extension'
      );
      this.goToStep(LoginStep.LOGIN_OPTIONS);
    }
  }

  loginWithNsec(): void {
    this.logger.debug('Attempting login with nsec');
    try {
      this.nostrService.loginWithNsec(this.nsecKey.trim());
      this.logger.debug('Login with nsec successful');
      this.closeDialog();
    } catch (err) {
      this.logger.error('Login with nsec failed', err);
      // Could add error handling here
    }
  }

  async loginWithNostrConnect(): Promise<void> {
    this.logger.debug('Attempting login with Nostr Connect');
    this.nostrConnectLoading.set(true);
    this.nostrConnectError.set(null);

    try {
      await this.nostrService.loginWithNostrConnect(this.nostrConnectUrl());
      this.logger.debug('Login with Nostr Connect successful');
      this.closeDialog();
    } catch (err) {
      this.logger.error('Login with Nostr Connect failed', err);
      this.nostrConnectError.set(
        err instanceof Error
          ? err.message
          : 'Failed to connect using Nostr Connect'
      );
      this.nostrConnectLoading.set(false);
    }
  }

  scanQrCodeForNostrConnect(): void {
    this.logger.debug('Opening QR code scanner for Nostr Connect');

    const scanDialogRef = this.dialog.open(QrcodeScanDialogComponent, {
      width: '100vw',
      height: '100vh',
      maxWidth: '100vw',
      maxHeight: '100vh',
      panelClass: 'qr-scan-dialog',
      hasBackdrop: true,
      disableClose: false,
    });

    scanDialogRef.afterClosed().subscribe(async result => {
      if (result && typeof result === 'string') {
        this.logger.debug('QR scan result:', { result });

        if (result.startsWith('nostr+') || result.startsWith('bunker://')) {
          this.nostrConnectUrl.set(result);
          await this.loginWithNostrConnect();
        } else {
          this.nostrConnectError.set(
            'Invalid QR code. Expected a Nostr Connect URL.'
          );
        }
      }
    });
  }

  usePreviewAccount(pubkey?: string): void {
    this.logger.debug('Using preview account', { pubkey });

    // Use the provided pubkey or the one from the input field
    const keyToUse = pubkey || this.previewPubkey;
    this.nostrService.usePreviewAccount(keyToUse);
    this.closeDialog();
  }

  async selectExistingAccount(pubkey: string) {
    this.logger.debug('Selecting existing account', { pubkey });
    await this.nostrService.switchToUser(pubkey);
    this.closeDialog();
  }

  removeAccount(event: Event, pubkey: string): void {
    // Prevent the click event from propagating to the parent
    event.stopPropagation();
    this.logger.debug('Removing account', { pubkey });

    // Call the service to remove the account
    this.nostrService.removeAccount(pubkey);
  }

  openTermsOfUse(): void {
    this.logger.debug('Opening Terms of Use dialog');
    this.dialog.open(TermsOfUseDialogComponent, {
      width: '600px',
      maxWidth: '90vw',
    });
  }

  closeDialog(): void {
    this.logger.debug('Closing unified login dialog');
    this.dialogRef.close();
  }
}
