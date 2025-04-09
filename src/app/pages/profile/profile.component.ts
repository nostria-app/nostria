import { Component, inject, signal, effect, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { LoadingOverlayComponent } from '../../components/loading-overlay/loading-overlay.component';
import { RelayService } from '../../services/relay.service';
import { NostrEvent } from '../../interfaces';
import { ApplicationStateService } from '../../services/application-state.service';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatChipsModule,
    MatDividerModule,
    LoadingOverlayComponent
  ],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss'
})
export class ProfileComponent {
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private relayService = inject(RelayService);
  private appState = inject(ApplicationStateService);
  private logger = inject(LoggerService);

  pubkey = signal<string>('');
  userMetadata = signal<NostrEvent | undefined>(undefined);
  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);
  isOwnProfile = signal<boolean>(false);

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
  }

  private async loadUserProfile(pubkey: string): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      // Try to get from cache first
      let metadata = await this.nostrService.getMetadataForUser(pubkey);
      this.userMetadata.set(metadata);

      // THIS WILL BE DONE IN THE GET METADATA FUNCTION SOON!
      // if (!metadata) {
      //   // If not in cache, try to fetch it
      //   this.logger.debug('User metadata not found in cache, fetching from network');
      //   metadata = await this.relayService.fetchUserMetadata(pubkey);
      //   this.userMetadata.set(metadata);
      // }

      if (!metadata) {
        this.error.set('User profile not found');
      } else {
        console.log('SCROLLINGSOOON');
        // Only scroll if profile was successfully loaded
        setTimeout(() => this.scrollToOptimalPosition(), 100);
      }
    } catch (err) {
      this.logger.error('Error loading user profile', err);
      this.error.set('Error loading user profile');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Scrolls the page to show half of the banner and the full profile picture
   */
  private scrollToOptimalPosition(): void {
    // We need the banner height to calculate the optimal scroll position
    const bannerHeight = this.getBannerHeight();
    
    // Calculate scroll position that shows half of the banner
    // We divide banner height by 2 to show half of it
    const scrollPosition = bannerHeight / 2;
    
    // Find the content wrapper element
    const contentWrapper = document.querySelector('.content-wrapper');
    if (contentWrapper) {
      // Scroll the content wrapper to the calculated position with smooth animation
      contentWrapper.scrollTo({
        top: scrollPosition,
        behavior: 'smooth'
      });
      
      this.logger.debug('Scrolled content wrapper to optimal profile view position', scrollPosition);
    } else {
      this.logger.error('Could not find content-wrapper element for scrolling');
    }
  }

  /**
   * Returns the banner height based on the current viewport width
   */
  private getBannerHeight(): number {
    // Default height of the banner is 300px (as defined in CSS)
    let bannerHeight = 300;
    
    // Check viewport width and return appropriate banner height
    // matching the responsive CSS values
    if (window.innerWidth <= 480) {
      bannerHeight = 150;
    } else if (window.innerWidth <= 768) {
      bannerHeight = 200;
    }
    
    return bannerHeight;
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
}
