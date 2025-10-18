import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { FollowsetComponent, Interest, SuggestedProfile } from '../../components/followset/followset.component';
import { Followset } from '../../services/followset';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { LoggerService } from '../../services/logger.service';
import { NotificationService } from '../../services/notification.service';
import { FeedsCollectionService } from '../../services/feeds-collection.service';

@Component({
  selector: 'app-discover',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    FollowsetComponent,
  ],
  templateUrl: './discover.component.html',
  styleUrl: './discover.component.scss',
})
export class DiscoverComponent implements OnInit {
  private readonly followsetService = inject(Followset);
  private readonly accountState = inject(AccountStateService);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggerService);
  private readonly notificationService = inject(NotificationService);
  private readonly feedsCollectionService = inject(FeedsCollectionService);
  protected readonly app = inject(ApplicationService);

  // Signals for reactive updates
  isLoadingInterests = signal<boolean>(false);
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
      const starterPacks = this.followsetService.starterPacks();
      const profiles = await this.followsetService.convertStarterPacksToProfiles(
        starterPacks,
        newSelected
      );
      this.suggestedProfiles.set(profiles);
    } else {
      this.suggestedProfiles.set([]);
    }
  }

  async onFollowsetComplete(event: { selectedInterests: string[]; followsToAdd: string[] }) {
    try {
      const { selectedInterests, followsToAdd } = event;

      this.logger.debug('Followset onboarding completed', {
        selectedInterests,
        followsToAdd,
      });

      // Follow all selected profiles in a single batch operation
      await this.accountState.follow(followsToAdd);

      this.notificationService.notify(`Welcome! Following ${followsToAdd.length} accounts.`);

      // Update local state
      this.selectedInterests.set(selectedInterests);

      // Refresh following feeds to load content from newly followed accounts
      await this.feedsCollectionService.refreshFollowingColumns();

      // Navigate back to people page after completion
      this.router.navigate(['/people']);
    } catch (error) {
      this.logger.error('Failed to complete followset onboarding:', error);
      this.notificationService.notify('Error completing setup. Please try again.');
    }
  }

  goBack() {
    this.router.navigate(['/people']);
  }
}
