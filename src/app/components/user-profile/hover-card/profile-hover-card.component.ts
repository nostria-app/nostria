import {
  Component,
  input,
  signal,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { RouterModule } from '@angular/router';
import { DataService } from '../../../services/data.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { SettingsService } from '../../../services/settings.service';
import { ImageCacheService } from '../../../services/image-cache.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ReportingService } from '../../../services/reporting.service';
import { LayoutService } from '../../../services/layout.service';
import { StorageService } from '../../../services/storage.service';
import { UserDataService } from '../../../services/user-data.service';
import { nip19 } from 'nostr-tools';
import { TrustService } from '../../../services/trust.service';

interface ProfileData {
  data?: {
    picture?: string;
    display_name?: string;
    name?: string;
    nip05?: string;
    about?: string;
    banner?: string;
    lud16?: string;
    lud06?: string;
    [key: string]: unknown;
  };
  isEmpty?: boolean;
}

@Component({
  selector: 'app-profile-hover-card',
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    RouterModule,
  ],
  templateUrl: './profile-hover-card.component.html',
  styleUrl: './profile-hover-card.component.scss',
})
export class ProfileHoverCardComponent {
  private dataService = inject(DataService);
  private utilities = inject(UtilitiesService);
  readonly settingsService = inject(SettingsService);
  private imageCacheService = inject(ImageCacheService);
  private accountState = inject(AccountStateService);
  private reportingService = inject(ReportingService);
  private layout = inject(LayoutService);
  private storage = inject(StorageService);
  private userDataService = inject(UserDataService);
  private trustService = inject(TrustService);
  private dialog = inject(MatDialog);

  pubkey = input.required<string>();
  profile = signal<ProfileData | null>(null);
  isLoading = signal(false);
  imageLoadError = signal(false);
  isFollowing = signal(false);
  isLoadingFollowing = signal(false);
  mutualFollowing = signal<string[]>([]);
  mutualFollowingProfiles = signal<ProfileData[]>([]);
  isMenuOpen = signal(false);
  trustRank = signal<number | undefined>(undefined);

  trustEnabled = computed(() => this.trustService.isEnabled());

  npubValue = computed<string>(() => {
    const pubkey = this.pubkey();
    if (!pubkey) {
      return '';
    }
    return nip19.npubEncode(pubkey);
  });

  aliasOrNpub = computed(() => {
    const profile = this.profile();

    if (!profile || !profile.data || !profile.data.nip05) {
      return this.truncateNpub(this.npubValue());
    }

    return this.utilities.parseNip05(profile.data.nip05);
  });

  constructor() {
    effect(() => {
      const pubkey = this.pubkey();

      if (pubkey) {
        untracked(() => {
          this.loadProfile(pubkey);
          this.checkFollowingStatus(pubkey);
          this.loadMutualFollowing(pubkey);
          this.loadTrustMetrics(pubkey);
        });
      }
    });
  }

  private async loadProfile(pubkey: string): Promise<void> {
    if (this.profile()) {
      return;
    }

    this.isLoading.set(true);

    try {
      const profile = await this.dataService.getProfile(pubkey);
      this.profile.set((profile as ProfileData) || { isEmpty: true });
    } catch (error) {
      console.error('Failed to load profile for hover card:', error);
      this.profile.set({ isEmpty: true });
    } finally {
      this.isLoading.set(false);
    }
  }

  private checkFollowingStatus(pubkey: string): void {
    const followingList = this.accountState.followingList();
    this.isFollowing.set(followingList.includes(pubkey));
  }

  private async loadMutualFollowing(pubkey: string): Promise<void> {
    try {
      // Get current account's following list
      const myFollowing = this.accountState.followingList();

      if (myFollowing.length === 0) {
        return;
      }

      // Get the target profile's following list (kind 3 event)
      // Try storage first, then fetch from relays if not found
      let targetFollowingEvent = await this.storage.getEventByPubkeyAndKind(pubkey, 3);

      if (!targetFollowingEvent) {
        // Not in cache, fetch from relays
        const record = await this.userDataService.getEventByPubkeyAndKind(pubkey, 3);
        targetFollowingEvent = record?.event || null;
      }

      if (!targetFollowingEvent?.tags) {
        return;
      }

      const targetFollowing = targetFollowingEvent.tags
        .filter((tag: string[]) => tag[0] === 'p')
        .map((tag: string[]) => tag[1]);

      // Find mutual follows (people that both follow)
      const mutual = myFollowing.filter(p => targetFollowing.includes(p));
      this.mutualFollowing.set(mutual);

      // Load profiles for the first 2 mutual follows
      if (mutual.length > 0) {
        const profilesToLoad = mutual.slice(0, 2);
        const profiles = await Promise.all(
          profilesToLoad.map(async p => {
            try {
              const prof = await this.dataService.getProfile(p);
              return prof as ProfileData;
            } catch {
              return null;
            }
          })
        );
        this.mutualFollowingProfiles.set(profiles.filter(p => p !== null) as ProfileData[]);
      }
    } catch (error) {
      console.error('Failed to load mutual following:', error);
    }
  }

  private async loadTrustMetrics(pubkey: string): Promise<void> {
    if (!this.trustService.isEnabled()) {
      return;
    }

    try {
      const metrics = await this.trustService.fetchMetrics(pubkey);
      this.trustRank.set(metrics?.rank);
    } catch (error) {
      console.error('Failed to load trust metrics for hover card:', error);
    }
  }

  async toggleFollow(): Promise<void> {
    const pubkey = this.pubkey();
    this.isLoadingFollowing.set(true);

    try {
      if (this.isFollowing()) {
        await this.accountState.unfollow(pubkey);
        this.isFollowing.set(false);
      } else {
        await this.accountState.follow(pubkey);
        this.isFollowing.set(true);
      }
    } catch (error) {
      console.error('Failed to toggle follow:', error);
    } finally {
      this.isLoadingFollowing.set(false);
    }
  }

  async reportProfile(): Promise<void> {
    try {
      const reportEvent = this.reportingService.createReportEvent(
        { type: 'user', pubkey: this.pubkey() },
        'spam',
        'Reported from profile hover card'
      );

      // Publish using account state
      this.accountState.publish.set(reportEvent);
      this.layout.toast('Profile reported');
    } catch (error) {
      console.error('Failed to report profile:', error);
      this.layout.toast('Failed to report profile', 3000, 'error-snackbar');
    }
  }

  async blockUser(): Promise<void> {
    try {
      await this.reportingService.muteUser(this.pubkey());
      this.layout.toast('User blocked');
    } catch (error) {
      console.error('Failed to block user:', error);
      this.layout.toast('Failed to block user', 3000, 'error-snackbar');
    }
  }

  getOptimizedImageUrl(url: string): string {
    if (!this.settingsService.settings().imageCacheEnabled) {
      return url;
    }

    return this.imageCacheService.getOptimizedImageUrl(url, 80, 80);
  }

  onImageLoadError(): void {
    this.imageLoadError.set(true);
  }

  private truncateNpub(npub: string): string {
    if (!npub || npub.length <= 16) {
      return npub;
    }
    return `${npub.substring(0, 8)}...${npub.substring(npub.length - 8)}`;
  }

  getMutualFollowingText(): string {
    const count = this.mutualFollowing().length;
    if (count === 0) return '';

    const profiles = this.mutualFollowingProfiles();
    const names = profiles
      .map(p => p?.data?.display_name || p?.data?.name || 'Unknown')
      .filter(n => n !== 'Unknown');

    if (count === 1) {
      return names.length > 0 ? `Also follows ${names[0]}` : '1 follower in common';
    } else if (count === 2) {
      return names.length === 2
        ? `Also follows ${names[0]} and ${names[1]}`
        : `${count} followers in common`;
    } else {
      const remaining = count - names.length;
      if (names.length === 0) {
        return `${count} followers in common`;
      } else if (names.length === 1) {
        return `Also follows ${names[0]} and ${remaining} other${remaining !== 1 ? 's' : ''}`;
      } else {
        return `Also follows ${names[0]}, ${names[1]} and ${remaining} other${remaining !== 1 ? 's' : ''}`;
      }
    }
  }
}
