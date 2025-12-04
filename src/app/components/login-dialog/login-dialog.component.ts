import { Component, inject, signal, output, effect, ViewChild, ElementRef } from '@angular/core';
import { nip19 } from 'nostr-tools';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

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
import { NostrService, NostrUser } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { MnemonicService } from '../../services/mnemonic.service';
import { QrcodeScanDialogComponent } from '../qrcode-scan-dialog/qrcode-scan-dialog.component';
import { StandaloneTermsDialogComponent } from '../standalone-terms-dialog/standalone-terms-dialog.component';
import { SetupNewAccountDialogComponent } from '../setup-new-account-dialog/setup-new-account-dialog.component';
import { Region, RegionService } from '../../services/region.service';
import { DiscoveryService, ServerInfo } from '../../services/discovery.service';
import { MatButtonModule } from '@angular/material/button';
import { Profile } from '../../services/profile';
import { AccountStateService } from '../../services/account-state.service';
import { DataService } from '../../services/data.service';
import { LayoutService } from '../../services/layout.service';

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
  EXTERNAL_SIGNER = 'external-signer',
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
    StandaloneTermsDialogComponent,
  ],
  templateUrl: './login-dialog.component.html',
  styleUrl: './login-dialog.component.scss',
})
export class LoginDialogComponent {
  private dialogRef = inject(MatDialogRef<LoginDialogComponent>, { optional: true });
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  private mnemonicService = inject(MnemonicService);
  region = inject(RegionService);
  private discoveryService = inject(DiscoveryService);
  private profileService = inject(Profile);
  private accountState = inject(AccountStateService);
  private data = inject(DataService);
  layout = inject(LayoutService);
  private sanitizer = inject(DomSanitizer);

  // Event emitter for when dialog should close (used in standalone mode)
  dialogClosed = output<void>();

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
  externalSignerPubkey = '';
  // previewPubkey = 'npub1sg6plzptd64u62a878hep2kev88swjh3tw00gjsfl8f237lmu63q0uf63m'; // jack
  previewPubkey = 'npub1lmtv5qjrgjak504pc0a2885w72df69lmk8jfaet2xc3x2rppjy8sfzxvac' // Coffee

  @ViewChild('externalSignerInput') externalSignerInput!: ElementRef<HTMLInputElement>;

  constructor() {
    effect(() => {
      if (this.currentStep() === LoginStep.EXTERNAL_SIGNER) {
        window.addEventListener('focus', this.onWindowFocusExternalSigner);
        // Focus input after a short delay to allow rendering
        setTimeout(() => {
          this.externalSignerInput?.nativeElement?.focus();
        }, 100);
      } else {
        window.removeEventListener('focus', this.onWindowFocusExternalSigner);
      }
    });
  }

  onWindowFocusExternalSigner = async () => {
    this.externalSignerInput?.nativeElement?.focus();
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text && (text.startsWith('npub') || /^[0-9a-fA-F]{64}$/.test(text))) {
        this.externalSignerPubkey = text;
      }
    } catch {
      // Ignore clipboard read errors
    }
  }

  /**
   * Validates if the nsecKey is in a valid format (nsec, 64-char hex, or mnemonic phrase)
   */
  isNsecKeyValid(): boolean {
    const trimmedKey = this.nsecKey.trim();
    if (!trimmedKey) {
      return false;
    }

    // Check if it's an nsec format
    if (trimmedKey.startsWith('nsec')) {
      // Basic length check for nsec (should be around 63 characters)
      return trimmedKey.length >= 60;
    }

    // Check if it's a valid 64-character hex string
    const hexRegex = /^[0-9a-fA-F]{64}$/;
    if (hexRegex.test(trimmedKey)) {
      return true;
    }

    // Check if it's a valid mnemonic phrase
    return this.mnemonicService.isMnemonic(trimmedKey);
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

  clearProfileImage(): void {
    this.logger.debug('Clearing profile image');
    this.profileImage.set(null);
    this.profileImageFile.set(null);
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

      // Check if the user has relay configuration
      const currentAccount = this.accountState.account();
      if (currentAccount) {
        const hasRelays = await this.nostrService.hasRelayConfiguration(currentAccount.pubkey);

        if (!hasRelays) {
          this.logger.info('No relay configuration found, showing setup dialog');
          await this.showSetupNewAccountDialog(currentAccount);
        }
      }

      this.closeDialog();
    } catch (err) {
      this.logger.error('Login with extension failed', err);
      this.extensionError.set(
        err instanceof Error ? err.message : 'Unknown error connecting to extension'
      );
      this.goToStep(LoginStep.LOGIN_OPTIONS);
    }
  }

  async loginWithNsec(): Promise<void> {
    this.logger.debug('Attempting login with nsec');
    this.loading.set(true);

    try {
      await this.nostrService.loginWithNsec(this.nsecKey.trim());
      this.logger.debug('Login with nsec successful');

      // Check if the user has relay configuration
      const currentAccount = this.accountState.account();
      if (currentAccount) {
        const hasRelays = await this.nostrService.hasRelayConfiguration(currentAccount.pubkey);

        if (!hasRelays) {
          this.logger.info('No relay configuration found, showing setup dialog');
          await this.showSetupNewAccountDialog(currentAccount);
        }
      }

      this.closeDialog();
    } catch (err) {
      this.logger.error('Login with nsec failed', err);
      this.loading.set(false);

      // Show error message to user
      const errorMessage = err instanceof Error ? err.message : 'Failed to login with private key';
      this.snackBar.open(errorMessage, 'Close', {
        duration: 5000,
        horizontalPosition: 'center',
        verticalPosition: 'top',
      });
    }
  }

  /**
   * Show the setup new account dialog and handle the user's response
   */
  private async showSetupNewAccountDialog(user: NostrUser): Promise<void> {
    const setupDialogRef = this.dialog.open(SetupNewAccountDialogComponent, {
      width: '600px',
      maxWidth: '90vw',
      disableClose: true, // User must make a choice
    });

    const result = await setupDialogRef.afterClosed().toPromise();

    if (result && result.confirmed) {
      this.logger.info('User confirmed new account setup', {
        region: result.region,
      });
      try {
        await this.nostrService.setupNewAccountWithDefaults(user, result.region || undefined);
        this.snackBar.open('Account setup completed successfully!', 'Dismiss', {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
        });
      } catch (error) {
        this.logger.error('Failed to setup new account', error);
        this.snackBar.open('Failed to setup account. Please try again.', 'Dismiss', {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
        });
      }
    } else {
      this.logger.info('User declined new account setup');
      // User declined - they can continue with no relays but might have limited functionality
      this.snackBar.open(
        'Account setup skipped. You can configure relays later in settings.',
        'Dismiss',
        {
          duration: 5000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
        }
      );
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
    reader.onload = async e => {
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
          await this.nostrService.loginWithNsec(credentials.nsec.trim());
          this.logger.debug('Login with loaded nsec successful');

          // Check if the user has relay configuration
          const currentAccount = this.accountState.account();
          if (currentAccount) {
            const hasRelays = await this.nostrService.hasRelayConfiguration(currentAccount.pubkey);

            if (!hasRelays) {
              this.logger.info('No relay configuration found, showing setup dialog');
              await this.showSetupNewAccountDialog(currentAccount);
            }
          }

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

      // Check if the user has relay configuration
      const currentAccount = this.accountState.account();
      if (currentAccount) {
        const hasRelays = await this.nostrService.hasRelayConfiguration(currentAccount.pubkey);

        if (!hasRelays) {
          this.logger.info('No relay configuration found, showing setup dialog');
          await this.showSetupNewAccountDialog(currentAccount);
        }
      }

      this.closeDialog();
    } catch (err) {
      this.logger.error('Login with Nostr Connect failed', err);

      let errorMessage = 'Failed to connect using Nostr Connect';
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      } else if (err && typeof err === 'object' && 'toString' in err) {
        errorMessage = err.toString();
      }

      this.nostrConnectError.set(errorMessage);
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

  scanQrCodeForNsec(): void {
    this.logger.debug('Opening QR code scanner for nsec');

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

        // Check if the result is a valid nsec
        if (result.startsWith('nsec1')) {
          this.nsecKey = result;
          this.snackBar.open('Private key scanned successfully', 'Dismiss', {
            duration: 2000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
          });
          // Automatically trigger login with the scanned key
          await this.loginWithNsec();
        } else {
          this.snackBar.open('Invalid QR code. Expected a private key (nsec1...)', 'Dismiss', {
            duration: 3000,
            horizontalPosition: 'center',
            verticalPosition: 'bottom',
          });
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
    this.layout.openTermsOfUse();
  }

  closeTermsDialog(): void {
    this.layout.handleTermsDialogClose();
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

    // If used inside MatDialog
    if (this.dialogRef) {
      this.dialogRef.close();
    }

    // If used standalone with custom dialog
    this.dialogClosed.emit();
  }

  getExternalSignerUrl(): string {
    return `nostrsigner:?compressionType=none&returnType=signature&type=get_public_key&appName=Nostria`;
  }

  get safeExternalSignerUrl(): SafeUrl {
    return this.sanitizer.bypassSecurityTrustUrl(this.getExternalSignerUrl());
  }

  /**
   * Opens the external signer app without navigating away from the main app.
   * Uses an anchor element click to trigger the Android intent system
   * while keeping the web app running in the background.
   */
  openExternalSignerApp(event: Event): void {
    event.preventDefault();

    const anchor = document.createElement('a');
    anchor.href = this.getExternalSignerUrl();
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  async loginWithExternalSigner(): Promise<void> {
    this.logger.debug('Attempting login with external signer');
    this.loading.set(true);

    try {
      let pubkey = this.externalSignerPubkey.trim();

      // Handle npub if pasted
      if (pubkey.startsWith('npub')) {
        try {
          const decoded = nip19.decode(pubkey);
          if (decoded.type === 'npub') {
            pubkey = decoded.data as string;
          }
        } catch (e) {
          this.logger.error('Invalid npub', e);
          throw new Error('Invalid public key format');
        }
      }

      // Basic validation
      if (!pubkey || pubkey.length !== 64) {
        throw new Error('Invalid public key length. It should be 64 characters (hex).');
      }

      const newUser: NostrUser = {
        pubkey,
        name: 'External Signer',
        source: 'external',
        lastUsed: Date.now(),
        hasActivated: true,
      };

      await this.nostrService.setAccount(newUser);
      this.logger.debug('External signer account set successfully', { pubkey });

      // Check if the user has relay configuration
      const currentAccount = this.accountState.account();
      if (currentAccount) {
        const hasRelays = await this.nostrService.hasRelayConfiguration(currentAccount.pubkey);

        if (!hasRelays) {
          this.logger.info('No relay configuration found, showing setup dialog');
          await this.showSetupNewAccountDialog(currentAccount);
        }
      }

      this.closeDialog();
    } catch (err) {
      this.logger.error('Login with external signer failed', err);
      this.loading.set(false);

      const errorMessage = err instanceof Error ? err.message : 'Failed to login with external signer';
      this.snackBar.open(errorMessage, 'Close', {
        duration: 5000,
        panelClass: 'error-snackbar',
      });
    }
  }
}
