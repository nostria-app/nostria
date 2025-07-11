import { Component, inject, signal, effect, untracked, Inject, PLATFORM_ID, DOCUMENT, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, ParamMap, RouterModule, RouterOutlet, Router, NavigationEnd, Data } from '@angular/router';
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
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RelayService } from '../../services/relay.service';
import { ApplicationStateService } from '../../services/application-state.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatListModule } from '@angular/material/list';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { Event, kinds, nip19, SimplePool } from 'nostr-tools';
import { StorageService } from '../../services/storage.service';
import { ProfileStateService } from '../../services/profile-state.service';
import { LayoutService } from '../../services/layout.service';
import { ProfileHeaderComponent } from './profile-header/profile-header.component';
import { ApplicationService } from '../../services/application.service';
import { MediaPreviewDialogComponent } from '../../components/media-preview-dialog/media-preview.component';
import { AccountStateService } from '../../services/account-state.service';
import { UserRelayFactoryService } from '../../services/user-relay-factory.service';
import { UserRelayService } from '../../services/user-relay.service';
import { NostrRecord } from '../../interfaces';
import { DataService } from '../../services/data.service';
import { UtilitiesService } from '../../services/utilities.service';
import { UrlUpdateService } from '../../services/url-update.service';
import { UsernameService } from '../../services/username';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
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
    MatProgressSpinnerModule,
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
  private data = inject(DataService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  nostrService = inject(NostrService);
  private storage = inject(StorageService);
  private relayService = inject(RelayService);
  private appState = inject(ApplicationStateService);
  private app = inject(ApplicationService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private document = inject(DOCUMENT);
  private platformId = inject(PLATFORM_ID);
  layoutService = inject(LayoutService);
  profileState = inject(ProfileStateService);
  accountState = inject(AccountStateService);
  readonly utilities = inject(UtilitiesService);
  private readonly url = inject(UrlUpdateService);
  private readonly username = inject(UsernameService);

  pubkey = signal<string>('');
  userMetadata = signal<NostrRecord | undefined>(undefined);
  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);

  isOwnProfile = computed(() => {
    return this.accountState.pubkey() === this.pubkey();
  });

  showLightningQR = signal(false);
  lightningQrCode = signal<string>('');
  followingList = signal<string[]>([]); // This would be dynamically updated with real data
  isCompactHeader = signal<boolean>(false); // New signal to track compact header mode

  // Convert route params to a signal
  private routeParams = toSignal<ParamMap>(this.route.paramMap);
  private routeData = toSignal<Data>(this.route.data);
  // private userRelayFactory = inject(UserRelayFactoryService);
  // private userRelay: UserRelayService | undefined = undefined;

  constructor() {
    if (!this.app.isBrowser()) {
      console.warn('Profile component can only be used in browser context');
      return;
    }

    // Whenever profile is edited by user, update the user metadata if it matches the current pubkey
    effect(() => {
      const profile = this.accountState.profile();

      if (profile?.event.pubkey === this.pubkey() && this.userMetadata()?.event.id != profile?.event.id) {
        this.userMetadata.set(profile);
      }
    });

    // React to changes in route parameters and app initialization
    effect(async () => {
      // Only proceed if app is initialized and route params are available
      if (this.app.initialized() && this.routeParams() && this.routeData()) {
        let id, username;

        // Check if component renders /u/username and we have pubkey resolved from username
        const pubkeyForUsername = this.routeData()?.['data']?.id;
        if (pubkeyForUsername) {
          id = pubkeyForUsername;
          username = this.routeData()?.['data']?.username;
        } else {
          id = this.routeParams()?.get('id')
        }

        if (id) {
          this.logger.debug('Profile page opened with pubkey:', id);

          // Reset state when loading a new profile
          this.userMetadata.set(undefined);
          this.lightningQrCode.set('');
          this.error.set(null);

          if (id.startsWith('npub')) {
            id = this.utilities.getPubkeyFromNpub(id);

            // First update URL to have npub in URL.
            if (username) {
              this.url.updatePathSilently(['/u', username]);
            } else {
              username = await this.username.getUsername(id);

              if (username) {
                this.url.updatePathSilently(['/u', username]);
              }
              else {
                // If we find event only by ID, we should update the URL to include the NIP-19 encoded value that includes the pubkey.
                const encoded = nip19.npubEncode(id);
                this.url.updatePathSilently(['/p', id]);
              }
            }
          } else {
            if (!username) {
              username = await this.username.getUsername(id);

              if (username) {
                this.url.updatePathSilently(['/u', username]);
              }
              else {
                // If we find event only by ID, we should update the URL to include the NIP-19 encoded value that includes the pubkey.
                const encoded = nip19.npubEncode(id);
                this.url.updatePathSilently(['/p', encoded]);
              }
            }
          }

          this.profileState.setCurrentProfilePubkey(id);
          this.pubkey.set(id);

         

          // Always attempt to load user profile and check if own profile, regardless of relay status
          untracked(async () => {
            await this.loadUserProfile(this.pubkey());
          });

          // this.userRelay.subscribe([{
          //   kinds: [kinds.ShortTextNote],
          //   authors: [id],
          //   limit: 30
          // }], (event) => {
          //   this.profileState.replies.update(events => [...events, event]);
          // }, () => {
          //   console.log('FINISHED!!!');
          // });


        } else {
          this.error.set('No user ID provided');
          this.isLoading.set(false);
        }
      }
    });

    // Add an effect to generate QR code when showing it and the profile changes
    effect(() => {
      // Only generate QR code if the lightning address exists and the QR popover is shown
      if (this.showLightningQR() && this.userMetadata()?.data?.lud16) {
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
      url.includes('/details') ||
      url.includes('/relays') ||
      url.includes('/media');
  }

  /**
   * Safely access window object in browser context
   * @returns Window object or null if not in browser
   */
  private getWindow(): Window | null {
    return isPlatformBrowser(this.platformId) ? this.document.defaultView : null;
  }

  // private async loadUserData(pubkey: string, disconnect = true): Promise<void> {
  //   if (!this.userRelay) {
  //     this.logger.warn('UserRelay service not available, cannot load user data');
  //     return;
  //   }

  //   if (this.userRelay.relayUrls.length === 0) {
  //     this.logger.warn('No relay URLs available for user, cannot load user data');
  //     return;
  //   }

  //   await this.profileState.loadUserData();

  //   // if (!this.nostrService.currentProfileUserPool) {
  //   //   this.nostrService.currentProfileUserPool = new SimplePool();
  //   // }

  //   // let relays = await this.nostrService.getRelaysForUser(pubkey, disconnect);
  //   // if (!relays) {
  //   //   return this.error.set('No relays found for this user');
  //   // }

  //   // let relayUrls = this.nostrService.getRelayUrls(relays);
  //   // this.nostrService.currentProfileRelayUrls = relayUrls;
  //   // const pool = this.nostrService.currentProfileUserPool;
  // }

  private async loadUserProfile(pubkey: string): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      // Try to get from cache first
      let metadata = await this.nostrService.getMetadataForUser(pubkey, true);
      this.userMetadata.set(metadata);

      if (!metadata) {
        // Don't set an error - allow the profile page to load without metadata
        this.logger.warn('User profile metadata not found, but continuing to load profile content');
      }

      // Always scroll and load data, regardless of whether metadata was found
      setTimeout(() => this.layoutService.scrollToOptimalProfilePosition(), 100);

      // Load user data regardless of metadata availability
      // this.loadUserData(pubkey);

    } catch (err) {
      this.logger.error('Error loading user profile', err);
      this.error.set('Error loading user profile');
    } finally {
      this.isLoading.set(false);
    }
  }

  getFormattedName(): string {
    const metadata = this.userMetadata();
    if (!metadata) return this.getTruncatedPubkey();

    return metadata.data.name || this.getTruncatedPubkey();
  }

  getVerifiedIdentifier(): string | null {
    const metadata = this.userMetadata();
    if (!metadata || !metadata.data.nip05) return null;

    return this.utilities.parseNip05(metadata.data.nip05);
  }

  getTruncatedPubkey(): string {
    return this.utilities.getTruncatedNpub(this.pubkey());
  }

  getFormattedNpub(): string {
    console.debug('LOCATION 3:');
    return this.utilities.getNpubFromPubkey(this.pubkey());
  }

  getDefaultBanner(): string {
    // Return a default gradient for users without a banner
    return 'linear-gradient(135deg, #8e44ad, #3498db)';
  }

  copyToClipboard(text: string, type: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      this.logger.error('Cannot copy to clipboard in server environment');
      return;
    }

    const navigator = this.getWindow()?.navigator;
    if (!navigator?.clipboard) {
      this.logger.error('Clipboard API not available');
      return;
    }

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
      this.copyToClipboard(metadata.event.content, 'profile data');
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
    const window = this.getWindow();

    if (isPlatformBrowser(this.platformId) && window?.navigator?.share) {
      window.navigator.share({
        title: `${this.getFormattedName()}'s Nostr Profile`,
        text: `Check out ${this.getFormattedName()} on Nostr`,
        url: this.getCurrentUrl()
      }).then(() => {
        this.logger.debug('Profile shared successfully');
      }).catch((error) => {
        this.logger.error('Error sharing profile:', error);
      });
    } else {
      // Fallback if Web Share API is not available
      this.copyToClipboard(this.getCurrentUrl(), 'profile URL');
    }
  }

  shareProfileUrl(): void {
    this.copyToClipboard(this.getCurrentUrl(), 'profile URL');
  }

  async unfollowUser() {
    this.logger.debug('Unfollow requested for:', this.pubkey());
    await this.accountState.unfollow(this.pubkey());
  }

  isFollowing = computed(() => {
    const followingList = this.accountState.followingList();
    return followingList.includes(this.pubkey());
  });

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
  async followUser() {
    this.logger.debug('Follow requested for:', this.pubkey());
    await this.accountState.follow(this.pubkey());
  }

  /**
   * Opens the profile picture in a larger view dialog
   */
  openProfilePicture(): void {
    const metadata = this.userMetadata();
    if (metadata?.data.picture) {
      const dialogRef = this.dialog.open(MediaPreviewDialogComponent, {
        data: {
          mediaUrl: metadata.data.picture,
          mediaType: 'image',
          mediaTitle: this.getFormattedName() + ' Profile Picture'
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
    // if (!isPlatformBrowser(this.platformId)) {
    //   this.logger.debug('Cannot generate QR code in server environment');
    //   return;
    // }

    // const metadata = this.userMetadata();
    // if (!metadata?.data?.lud16) {
    //   this.lightningQrCode.set('');
    //   return;
    // }

    // try {
    //   // Format lightning address for QR code
    //   const lightning = metadata.data.lud16;

    //   const dataUrl = await QRCode.toDataURL(`lightning:${lightning}`, {
    //     margin: 1,
    //     width: 200,
    //     color: {
    //       dark: '#000000',
    //       light: '#FFFFFF'
    //     }
    //   });

    //   this.lightningQrCode.set(dataUrl);
    // } catch (err) {
    //   this.logger.error('Error generating QR code:', err);
    //   this.lightningQrCode.set('');
    // }
  }

  /**
   * Gets the current URL safely in both browser and server environments
   */
  private getCurrentUrl(): string {
    if (isPlatformBrowser(this.platformId)) {
      const window = this.getWindow();
      return window?.location?.href || this.getServerSideUrl();
    }
    return this.getServerSideUrl();
  }

  /**
   * Creates a URL from router state for server-side rendering
   */
  private getServerSideUrl(): string {
    const url = this.router.url;
    // Use configured app URL or fallback
    const baseUrl = isPlatformBrowser(this.platformId)
      ? this.document.location?.origin
      : 'https://nostria.app/';
    return `${baseUrl}${url}`;
  }
}