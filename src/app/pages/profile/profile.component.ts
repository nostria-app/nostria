import { Component, inject, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { NostrService } from '../../services/nostr.service';
import { UserMetadata, NostrEventData } from '../../services/storage.service';
import { LoggerService } from '../../services/logger.service';
import { LoadingOverlayComponent } from '../../components/loading-overlay/loading-overlay.component';
import { RelayService } from '../../services/relay.service';

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
  private logger = inject(LoggerService);

  pubkey = signal<string>('');
  userMetadata = signal<NostrEventData<UserMetadata> | undefined>(undefined);
  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);
  isOwnProfile = signal<boolean>(false);

  constructor() {
    // Extract the pubkey from the route parameter
    effect(() => {
      const id = this.route.snapshot.paramMap.get('id');
      if (id) {
        this.logger.debug('Profile page opened with pubkey:', id);
        this.pubkey.set(id);
        this.loadUserProfile(id);
        this.checkIfOwnProfile(id);
      } else {
        this.error.set('No user ID provided');
        this.isLoading.set(false);
      }
    });
  }

  private async loadUserProfile(pubkey: string): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      // Try to get from cache first
      let metadata = this.nostrService.findUserMetadata(pubkey);
      this.userMetadata.set(metadata);

      if (!metadata) {
        // If not in cache, try to fetch it
        this.logger.debug('User metadata not found in cache, fetching from network');
        metadata = await this.relayService.fetchUserMetadata(pubkey);
        this.userMetadata.set(metadata);
      }
      
      if (!metadata) {
        this.error.set('User profile not found');
      }
    } catch (err) {
      this.logger.error('Error loading user profile', err);
      this.error.set('Error loading user profile');
    } finally {
      this.isLoading.set(false);
    }
  }

  private checkIfOwnProfile(pubkey: string): void {
    const currentUser = this.nostrService.currentUser();
    this.isOwnProfile.set(currentUser?.pubkey === pubkey);
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
