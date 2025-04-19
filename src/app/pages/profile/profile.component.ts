import { Component, inject, signal, effect, untracked, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, ParamMap, RouterModule, RouterOutlet, Router, NavigationEnd } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { LoadingOverlayComponent } from '../../components/loading-overlay/loading-overlay.component';
import { RelayService } from '../../services/relay.service';
import { NostrEvent } from '../../interfaces';
import { ApplicationStateService } from '../../services/application-state.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatListModule } from '@angular/material/list';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import QRCode from 'qrcode';
import { kinds, SimplePool } from 'nostr-tools';
import { StorageService } from '../../services/storage.service';
import { ProfileStateService } from '../../services/profile-state.service';
import { LayoutService } from '../../services/layout.service';
import { ProfileHeaderComponent } from './profile-header/profile-header.component';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    RouterOutlet,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatChipsModule,
    MatDividerModule,
    MatMenuModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatDialogModule,
    LoadingOverlayComponent,
    MatListModule,
    MatMenuModule,
    FormsModule,
    MatFormFieldModule,
    ProfileHeaderComponent

  ],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss'
})
export class ProfileComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private nostrService = inject(NostrService);
  private storage = inject(StorageService);
  private relayService = inject(RelayService);
  private appState = inject(ApplicationStateService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  layoutService = inject(LayoutService);
  profileState = inject(ProfileStateService);

  pubkey = signal<string>('');
  userMetadata = signal<NostrEvent | undefined>(undefined);
  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);
  isOwnProfile = signal<boolean>(false);
  showLightningQR = signal(false);
  lightningQrCode = signal<string>('');
  followingList = signal<string[]>([]); // This would be dynamically updated with real data
  isCompactHeader = signal<boolean>(false); // New signal to track compact header mode

  // Convert route params to a signal
  private routeParams = toSignal<ParamMap>(this.route.paramMap);

  constructor() {
    // React to changes in route parameters and app initialization
    effect(() => {
      // Only proceed if app is initialized and route params are available
      if (this.appState.initialized() && this.routeParams()) {
        let id = this.routeParams()?.get('id');

        if (id) {
          this.logger.debug('Profile page opened with pubkey:', id);

          if (id.startsWith('npub')) {
            id = this.nostrService.getPubkeyFromNpub(id);
          }

          this.pubkey.set(id);

          // Reset state when loading a new profile
          this.userMetadata.set(undefined);
          this.lightningQrCode.set('');
          this.error.set(null);

          // Use untracked to avoid re-running this effect when these signals change
          untracked(async () => {
            await this.loadUserProfile(this.pubkey());
            this.checkIfOwnProfile(this.pubkey());
          });
        } else {
          this.error.set('No user ID provided');
          this.isLoading.set(false);
        }
      }
    });

    // Add an effect to generate QR code when showing it and the profile changes
    effect(() => {
      // Only generate QR code if the lightning address exists and the QR popover is shown
      if (this.showLightningQR() && this.userMetadata()?.content?.lud16) {
        this.generateLightningQRCode();
      }
    });

    // Add effect to monitor router events for sub-route changes
    this.router.events.subscribe(event => {
      if (event instanceof NavigationEnd) {
        // Check if current route is one that should use compact header
        const currentUrl = event.urlAfterRedirects;
        const shouldBeCompact = this.shouldUseCompactHeader(currentUrl);
        
        // Only update if the value changes to avoid unnecessary renders
        if (this.isCompactHeader() !== shouldBeCompact) {
          this.isCompactHeader.set(shouldBeCompact);
        }
      }
    });
  }

  // Helper method to determine if the current route should use compact header
  private shouldUseCompactHeader(url: string): boolean {
    // Check if URL contains these paths that require compact header
    return url.includes('/following') || 
           url.includes('/about') || 
           url.includes('/media');
  }

  private async loadUserData(pubkey: string, disconnect = true): Promise<void> {
    if (!this.nostrService.currentProfileUserPool) {
      this.nostrService.currentProfileUserPool = new SimplePool();
    }

    let relays = await this.nostrService.getRelaysForUser(pubkey, disconnect);
    if (!relays) {
      return this.error.set('No relays found for this user');
    }

    let relayUrls = this.nostrService.getRelayUrls(relays);
    this.nostrService.currentProfileRelayUrls = relayUrls;
    const pool = this.nostrService.currentProfileUserPool;

    // TODO: Move this logic into the relay or nostr service.
    pool?.subscribeMany(this.nostrService.currentProfileRelayUrls, [{
      kinds: [kinds.Contacts],
      authors: [pubkey],
    },
    {
      kinds: [kinds.ShortTextNote],
      authors: [pubkey],
      limit: 30
    },
    {
      kinds: [kinds.LongFormArticle],
      authors: [pubkey],
      limit: 30
    },
    ], {
      onevent: (evt) => {
        console.log('Event received', evt);
    
        if (evt.kind === kinds.Contacts) {
          const followingList = this.storage.getPTagsValues(evt);
          console.log(followingList);
          // this.followingList.set(followingList);
          this.profileState.followingList.set(followingList);

          
          this.storage.saveEvent(evt);

          // Now you can use 'this' here
          // For example: this.handleContacts(evt);
        }
      }, 
      onclose: (reasons) => {
        console.log('Pool closed', reasons);
        // Also changed this to an arrow function for consistency
      },
    });


    // this.isLoading.set(true);
    // this.error.set(null);

    // try {
    //   // Fetch user data from the relay service
    //   const userData = await this.relayService.getUserData(pubkey);
    //   if (userData) {
    //     this.userMetadata.set(userData);
    //   } else {
    //     this.error.set('No user data found');
    //   }
    // } catch (err) {
    //   this.logger.error('Error loading user data', err);
    //   this.error.set('Error loading user data');
    // } finally {
    //   this.isLoading.set(false);
    // }
  }

  private async loadUserProfile(pubkey: string): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      // Try to get from cache first
      let metadata = await this.nostrService.getMetadataForUser(pubkey);
      this.userMetadata.set(metadata);

      if (!metadata) {
        this.error.set('User profile not found');
      } else {
        // Only scroll if profile was successfully loaded
        setTimeout(() => this.layoutService.scrollToOptimalProfilePosition(), 100);

        // After getting the metadata, get other data from this user.
        this.loadUserData(pubkey);
      }
    } catch (err) {
      this.logger.error('Error loading user profile', err);
      this.error.set('Error loading user profile');
    } finally {
      this.isLoading.set(false);
    }
  }

  private checkIfOwnProfile(pubkey: string): void {
    const activeAccount = this.nostrService.activeAccount();
    this.isOwnProfile.set(activeAccount?.pubkey === pubkey);
  }

  getFormattedName(): string {
    const metadata = this.userMetadata();
    if (!metadata) return this.getTruncatedPubkey();

    return metadata.content.name || this.getTruncatedPubkey();
  }

  getVerifiedIdentifier(): string | null {
    const metadata = this.userMetadata();
    if (!metadata || !metadata.content.nip05) return null;

    // Format NIP-05 identifier for display
    return metadata.content.nip05.startsWith('_@')
      ? metadata.content.nip05.substring(1)
      : metadata.content.nip05;
  }

  getTruncatedPubkey(): string {
    return this.nostrService.getTruncatedNpub(this.pubkey());
  }

  getFormattedNpub(): string {
    return this.nostrService.getNpubFromPubkey(this.pubkey());
  }

  getDefaultBanner(): string {
    // Return a default gradient for users without a banner
    return 'linear-gradient(135deg, #8e44ad, #3498db)';
  }

  copyToClipboard(text: string, type: string): void {
    navigator.clipboard.writeText(text)
      .then(() => {
        this.logger.debug(`Copied ${type} to clipboard:`, text);
        this.snackBar.open(`${type.charAt(0).toUpperCase() + type.slice(1)} copied to clipboard`, 'Dismiss', {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: 'copy-snackbar'
        });
      })
      .catch(error => {
        this.logger.error('Failed to copy to clipboard:', error);
        this.snackBar.open('Failed to copy to clipboard', 'Dismiss', {
          duration: 3000,
          horizontalPosition: 'center',
          verticalPosition: 'bottom',
          panelClass: 'error-snackbar'
        });
      });
  }

  copyNpub(): void {
    this.copyToClipboard(this.getFormattedNpub(), 'npub');
  }

  copyNprofile(): void {
    // For simplicity, just using npub here. In a real implementation,
    // would need to create a proper nprofile URI with relays
    this.copyToClipboard(this.getFormattedNpub(), 'nprofile');
  }

  copyProfileData(): void {
    const metadata = this.userMetadata();
    if (metadata) {
      this.copyToClipboard(JSON.stringify(metadata.content, null, 2), 'profile data');
    }
  }

  copyFollowingList(): void {
    // Placeholder for actual implementation that would fetch the following list
    this.logger.debug('Copy following list requested for:', this.pubkey());
    this.copyToClipboard('Following list not implemented yet', 'following list');
  }

  copyRelayList(): void {
    // Placeholder for actual implementation that would fetch the relay list
    this.logger.debug('Copy relay list requested for:', this.pubkey());
    this.copyToClipboard('Relay list not implemented yet', 'relay list');
  }

  shareProfile(): void {
    // Share profile action using the Web Share API if available
    if (navigator.share) {
      navigator.share({
        title: `${this.getFormattedName()}'s Nostr Profile`,
        text: `Check out ${this.getFormattedName()} on Nostr`,
        url: window.location.href
      }).then(() => {
        this.logger.debug('Profile shared successfully');
      }).catch((error) => {
        this.logger.error('Error sharing profile:', error);
      });
    } else {
      // Fallback if Web Share API is not available
      this.copyToClipboard(window.location.href, 'profile URL');
    }
  }

  shareProfileUrl(): void {
    this.copyToClipboard(window.location.href, 'profile URL');
  }

  unfollowUser(): void {
    this.logger.debug('Unfollow requested for:', this.pubkey());
    // TODO: Implement actual unfollow functionality
  }

  muteUser(): void {
    this.logger.debug('Mute requested for:', this.pubkey());
    // TODO: Implement actual mute functionality
  }

  blockUser(): void {
    this.logger.debug('Block requested for:', this.pubkey());
    // TODO: Implement actual block functionality
  }

  /**
   * Follows the user
   */
  followUser(): void {
    this.logger.debug('Follow requested for:', this.pubkey());
    // TODO: Implement actual follow functionality
  }

  /**
   * Opens the profile picture in a larger view dialog
   */
  openProfilePicture(): void {
    const metadata = this.userMetadata();
    if (metadata?.content.picture) {
      const dialogRef = this.dialog.open(ProfilePictureDialogComponent, {
        data: {
          imageUrl: metadata.content.picture,
          userName: this.getFormattedName()
        },
        maxWidth: '100vw',
        maxHeight: '100vh',
        panelClass: 'profile-picture-dialog'
      });

      this.logger.debug('Opened profile picture dialog');
    }
  }

  /**
   * Generates a QR code for the user's lightning address and stores it in the lightningQrCode signal
   */
  async generateLightningQRCode(): Promise<void> {
    const metadata = this.userMetadata();
    if (!metadata?.content?.lud16) {
      this.lightningQrCode.set('');
      return;
    }

    try {
      // Format lightning address for QR code
      const lightning = metadata.content.lud16;

      const dataUrl = await QRCode.toDataURL(`lightning:${lightning}`, {
        margin: 1,
        width: 200,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });

      this.lightningQrCode.set(dataUrl);
    } catch (err) {
      this.logger.error('Error generating QR code:', err);
      this.lightningQrCode.set('');
    }
  }
}

@Component({
  selector: 'app-profile-picture-dialog',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  template: `
    <div class="dialog-container">
      <button mat-icon-button class="close-button" (click)="close()">
        <mat-icon>close</mat-icon>
      </button>
      <img [src]="data.imageUrl" [alt]="data.userName + ' profile picture'" class="full-size-image">
    </div>
  `,
  styles: `
    .dialog-container {
      position: relative;
      padding: 0;
      overflow: hidden;
      text-align: center;
      background-color: rgba(0, 0, 0, 0.8);
      border-radius: 0;
    }
    
    .close-button {
      position: absolute;
      top: 10px;
      right: 10px;
      color: white;
      z-index: 10;
      background-color: rgba(0, 0, 0, 0.5);
    }
    
    .full-size-image {
      max-width: 90vw;
      max-height: 90vh;
      object-fit: contain;
    }
  `
})
export class ProfilePictureDialogComponent {
  constructor(
    @Inject(MAT_DIALOG_DATA) public data: { imageUrl: string, userName: string },
    private dialogRef: MatDialogRef<ProfilePictureDialogComponent>
  ) { }

  close(): void {
    this.dialogRef.close();
  }
}
