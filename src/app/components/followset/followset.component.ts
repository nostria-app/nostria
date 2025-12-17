import { Component, input, output, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { ImageCacheService } from '../../services/image-cache.service';

export interface Interest {
  id: string;
  name: string;
  icon: string;
}

export interface SuggestedProfile {
  id: string;
  name: string;
  bio: string;
  avatar: string;
  interests: string[];
  region?: string;
}

/**
 * Followset Component - Interest-based profile discovery and following
 *
 * This component allows users to select interests and discover profiles to follow.
 * Each follow action immediately signs and publishes a kind 3 event to the relays.
 */
@Component({
  selector: 'app-followset',
  imports: [MatIconModule, MatButtonModule, MatCheckboxModule, MatProgressSpinnerModule, FormsModule],
  templateUrl: './followset.component.html',
  styleUrl: './followset.component.scss',
})
export class FollowsetComponent {
  private readonly imageCacheService = inject(ImageCacheService);

  // Inputs
  title = input<string>('What interests you?');
  description = input<string>(
    "Select topics you're interested in to discover people and content you'll love. You can always change these later."
  );
  availableInterests = input<Interest[]>([]);
  suggestedProfiles = input<SuggestedProfile[]>([]);
  selectedInterests = input<string[]>([]);
  followingProfiles = input<string[]>([]);
  detectedRegion = input<string>('');
  isLoadingInterests = input<boolean>(false);
  isLoadingProfiles = input<boolean>(false);

  // Outputs
  interestToggled = output<string>();
  followProfile = output<string>();

  // Internal computed property for filtered profiles
  filteredProfiles = computed(() => {
    const selected = this.selectedInterests();
    const profiles = this.suggestedProfiles();
    const region = this.detectedRegion();

    if (selected.length === 0) {
      return [];
    }

    // Filter profiles that have at least one matching interest
    let filteredProfiles = profiles.filter(profile =>
      profile.interests.some(interest => selected.includes(interest))
    );

    // For regional profiles, update their region to match detected region
    if (selected.includes('regional')) {
      filteredProfiles = filteredProfiles.map(profile => {
        if (profile.interests.includes('regional') && profile.region) {
          return { ...profile, region: region };
        }
        return profile;
      });
    }

    return filteredProfiles;
  });

  toggleInterest(interestId: string): void {
    this.interestToggled.emit(interestId);
  }

  toggleFollow(profileId: string): void {
    // Check if already following
    if (this.followingProfiles().includes(profileId)) {
      // Already following - do nothing (user can unfollow from profile page)
      return;
    }

    // Emit event to follow this profile immediately
    this.followProfile.emit(profileId);
  }

  getInterestName(interestId: string): string {
    const interest = this.availableInterests().find(i => i.id === interestId);
    return interest?.name || interestId;
  }

  getOptimizedImageUrl(originalUrl: string): string {
    if (!originalUrl) {
      return '';
    }
    return this.imageCacheService.getOptimizedImageUrl(originalUrl);
  }
}
