import { Component, inject, signal } from '@angular/core';

import { MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { QrcodeScanDialogComponent } from '../qrcode-scan-dialog/qrcode-scan-dialog.component';
import { TermsOfUseDialogComponent } from '../terms-of-use-dialog/terms-of-use-dialog.component';
import { Region, RegionService } from '../../services/region.service';
import { DiscoveryService, ServerInfo } from '../../services/discovery.service';
import { MatButtonModule } from '@angular/material/button';
import { Profile } from '../../services/profile';
import { AccountStateService } from '../../services/account-state.service';
import { DataService } from '../../services/data.service';

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
  private snackBar = inject(MatSnackBar);
  nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  region = inject(RegionService);
  private discoveryService = inject(DiscoveryService);
  private profileService = inject(Profile);
  private accountState = inject(AccountStateService);
  private data = inject(DataService);

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

  // Region discovery signals
  isDetectingRegion = signal(true);
  detectedRegion = signal('');
  showRegionSelector = signal(false);
  availableRegions = signal<{ name: string; latency: string; id: string }[]>([]);

  // Profile setup signals (similar to welcome component)
  displayName = signal('');
  profileImage = signal<string | null>(null);
  profileImageFile = signal<File | null>(null);

  // Input fields
  nsecKey = '';
  // previewPubkey = 'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m'; // jack
  previewPubkey = 'npub1lmtv5qjrgjak504pc0a2885w72df69lmk8jfaet2xc3x2rppjy8sfzxvac' // Coffee

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
  async startRegionDetection(): Promise<void> {
    this.isDetectingRegion.set(true);
    this.detectedRegion.set('');
    this.showRegionSelector.set(false);

    try {
      // First trigger the latency check to populate the servers with latency data
      await this.discoveryService.checkServerLatency();

      // Get all servers sorted by latency
      const serversWithLatency = this.discoveryService.getServersByLatency();

      // Convert ServerInfo to our UI format
      const regions = serversWithLatency.map((server: ServerInfo) => {
        const regionId = this.getRegionIdFromServer(server);

        return {
          name: server.region,
          latency: `${server.latency || 9999}ms`,
          id: regionId,
        };
      });

      this.availableRegions.set(regions);

      // The first server should be the fastest since they're sorted by latency
      const fastestRegion = regions[0];

      if (fastestRegion) {
        // Set the detected region and selected region
        this.detectedRegion.set(fastestRegion.name);
        this.selectedRegionId.set(fastestRegion.id);
      }

      // Simulate detection time for better UX (minimum display time)
      await new Promise(resolve => setTimeout(resolve, 1500));

      this.isDetectingRegion.set(false);
    } catch (error) {
      this.logger.error('Failed to detect region:', error);
      // Fallback to manual selection
      this.isDetectingRegion.set(false);
      this.showRegionSelector.set(true);
    }
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

      // Store the actual file for upload
      this.profileImageFile.set(file);

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
  async generateNewKey(): Promise<void> {
    this.logger.debug('Generating new key', {
      regionId: this.selectedRegionId(),
      displayName: this.displayName(),
      hasProfileImage: !!this.profileImage(),
    });
    if (this.selectedRegionId()) {
      this.loading.set(true);

      try {
        // First generate the new key and set up the account
        const newUser = await this.nostrService.generateNewKey(this.selectedRegionId()!);

        // If the user has set a display name and/or profile image, create the profile
        const displayName = this.displayName();
        const profileImageFile = this.profileImageFile();

        if (displayName || profileImageFile) {
          this.logger.debug('Creating initial profile for new user');
          const result = await this.profileService.createInitialProfile(
            newUser.pubkey,
            displayName || undefined,
            profileImageFile || undefined
          );

          if (!result.success) {
            this.logger.error('Failed to create initial profile', result.error);
            // Don't fail the entire process, just log the error
            // The user can always edit their profile later
          } else {
            this.logger.debug('Initial profile created successfully');
            if (result.profileEvent) {
              const metadata = this.data.toRecord(result.profileEvent);
              this.accountState.addToCache(metadata.event.pubkey, metadata);
              this.accountState.profile.set(metadata);
            }
          }
        }

        // Perform the set account after we've uploaded the profile.
        // await this.nostrService.setAccount(newUser);

        this.loading.set(false);
        this.closeDialog();
      } catch (error) {
        this.logger.error('Failed to generate new key', error);
        // Handle error appropriately - you might want to show an error message to the user
        this.loading.set(false);
      }
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
        err instanceof Error ? err.message : 'Unknown error connecting to extension'
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

  loadCredentialsFromFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];

    // Validate file type
    if (!file.name.endsWith('.json')) {
      this.snackBar.open('Please select a JSON file', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const content = e.target?.result as string;
        const credentials = JSON.parse(content);

        // Validate the JSON structure
        if (!credentials.nsec || typeof credentials.nsec !== 'string') {
          throw new Error('Invalid credentials file format');
        }

        // Validate nsec format
        if (!credentials.nsec.startsWith('nsec')) {
          throw new Error('Invalid nsec format in credentials file');
        }

        // Start login process automatically with the loaded nsec
        this.logger.debug('Credentials loaded from file, starting login process');

        try {
          this.nostrService.loginWithNsec(credentials.nsec.trim());
          this.logger.debug('Login with loaded nsec successful');
          this.snackBar.open('Login successful', 'Dismiss', {
            duration: 2000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
          });
          this.closeDialog();
        } catch (loginError) {
          this.logger.error('Login with loaded nsec failed', loginError);
          // Fallback: set the nsec in the input field if login fails
          this.nsecKey = credentials.nsec;
          this.snackBar.open('Credentials loaded. Please try login manually.', 'Dismiss', {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
          });
        }
      } catch (error) {
        this.logger.error('Failed to parse credentials file:', error);
        this.snackBar.open('Invalid credentials file format', 'Dismiss', {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
        });
      }
    };

    reader.onerror = () => {
      this.logger.error('Failed to read credentials file');
      this.snackBar.open('Failed to read file', 'Dismiss', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    };

    reader.readAsText(file);

    // Clear the input so the same file can be selected again
    input.value = '';
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
        err instanceof Error ? err.message : 'Failed to connect using Nostr Connect'
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
          this.nostrConnectError.set('Invalid QR code. Expected a Nostr Connect URL.');
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

  /**
   * Maps a ServerInfo object to a region ID for the RegionService
   */
  private getRegionIdFromServer(server: ServerInfo): string {
    // Extract region from the server URL or region property
    const url = server.url.toLowerCase();

    if (url.includes('.eu.') || server.region.toLowerCase().includes('europe')) {
      return 'eu';
    } else if (url.includes('.us.') || server.region.toLowerCase().includes('usa')) {
      return 'us';
    } else if (url.includes('.af.') || server.region.toLowerCase().includes('africa')) {
      return 'af';
    } else if (url.includes('.as.') || server.region.toLowerCase().includes('asia')) {
      return 'as';
    } else if (url.includes('.sa.') || server.region.toLowerCase().includes('south america')) {
      return 'sa';
    } else if (url.includes('.au.') || server.region.toLowerCase().includes('australia')) {
      return 'au';
    } else if (url.includes('.jp.') || server.region.toLowerCase().includes('japan')) {
      return 'jp';
    }

    // Default fallback
    return 'us';
  }

  closeDialog(): void {
    this.logger.debug('Closing unified login dialog');
    this.dialogRef.close();
  }
}
