import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { FollowsetComponent, Interest, SuggestedProfile } from '../../../components/followset/followset.component';
import { Followset } from '../../../services/followset';
import { AccountStateService } from '../../../services/account-state.service';
import { ApplicationService } from '../../../services/application.service';
import { LoggerService } from '../../../services/logger.service';
import { NotificationService } from '../../../services/notification.service';
import { FeedsCollectionService } from '../../../services/feeds-collection.service';

@Component({
  selector: 'app-discover-people',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    FollowsetComponent,
  ],
  templateUrl: './discover-people.component.html',
  styleUrl: './discover-people.component.scss',
})
export class DiscoverPeopleComponent implements OnInit {
  private readonly followsetService = inject(Followset);
  private readonly accountState = inject(AccountStateService);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggerService);
  private readonly notificationService = inject(NotificationService);
  private readonly feedsCollectionService = inject(FeedsCollectionService);
  protected readonly app = inject(ApplicationService);

  // Signals for reactive updates
  isLoadingInterests = signal<boolean>(false);
  isLoadingProfiles = signal<boolean>(false);
  availableInterests = signal<Interest[]>([]);
  suggestedProfiles = signal<SuggestedProfile[]>([]);
  selectedInterests = signal<string[]>([]);
  detectedRegion = signal<string>('us');

  // Computed signal for following profiles
  followingProfiles = computed(() => {
    return this.accountState.followingList();
  });

  async ngOnInit() {
    await this.loadStarterPacks();
    this.detectRegion();
  }

  private async loadStarterPacks() {
    this.isLoadingInterests.set(true);

    try {
      // Fetch starter packs from the service
      const starterPacks = await this.followsetService.fetchStarterPacks();

      // Convert to interests for the UI
      const interests = this.followsetService.convertStarterPacksToInterests(starterPacks);
      this.availableInterests.set(interests);
    } catch (error) {
      console.error('Failed to load starter packs:', error);
    } finally {
      this.isLoadingInterests.set(false);
    }
  }

  private detectRegion() {
    // Try to detect region from account settings or browser
    const account = this.accountState.account();
    const region = account?.region || 'us';
    this.detectedRegion.set(region);
  }

  async toggleInterest(interestId: string) {
    const currentSelected = this.selectedInterests();
    const newSelected = currentSelected.includes(interestId)
      ? currentSelected.filter(id => id !== interestId)
      : [...currentSelected, interestId];

    this.selectedInterests.set(newSelected);

    // Fetch suggested profiles based on selected interests
    if (newSelected.length > 0) {
      this.isLoadingProfiles.set(true);
      try {
        const starterPacks = this.followsetService.starterPacks();
        const profiles = await this.followsetService.convertStarterPacksToProfiles(
          starterPacks,
          newSelected
        );
        this.suggestedProfiles.set(profiles);
      } finally {
        this.isLoadingProfiles.set(false);
      }
    } else {
      this.suggestedProfiles.set([]);
    }
  }

  async onFollowProfile(profileId: string) {
    try {
      this.logger.debug('Following profile from followset', { profileId });

      // Follow the profile immediately - accountState.follow handles publishing to relays
      await this.accountState.follow(profileId);

      // this.notificationService.notify(`Following new account.`);

      // Only refresh following feeds if we're on the feeds page
      if (this.router.url.startsWith('/feeds')) {
        await this.feedsCollectionService.refreshFollowingFeeds();
      }
    } catch (error) {
      this.logger.error('Failed to follow profile:', error);
      this.notificationService.notify('Error following account. Please try again.');
    }
  }

  goBack() {
    this.router.navigate(['/people']);
  }
}
