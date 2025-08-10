import { Component, input, output, computed, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';

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
 * Follow actions are aggregated locally and only committed to nostr relays when
 * the user clicks "Get Started". This prevents spam and allows users to change
 * their mind before final commitment.
 */
@Component({
  selector: 'app-followset',
  imports: [MatIconModule, MatButtonModule, MatCheckboxModule, FormsModule],
  templateUrl: './followset.component.html',
  styleUrl: './followset.component.scss',
})
export class FollowsetComponent {
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

  // Internal state for pending follows (not yet committed)
  pendingFollows = signal<string[]>([]);

  // Outputs
  interestToggled = output<string>();
  completed = output<{ selectedInterests: string[]; followsToAdd: string[] }>();

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

  // Combined follows - existing follows plus pending follows
  displayedFollows = computed(() => {
    const existing = this.followingProfiles();
    const pending = this.pendingFollows();
    return [...new Set([...existing, ...pending])];
  });

  // Check if user is ready to get started (has selected interests and at least one pending follow)
  canGetStarted = computed(() => {
    return (
      this.selectedInterests().length > 0 && this.pendingFollows().length > 0
    );
  });

  toggleInterest(interestId: string): void {
    this.interestToggled.emit(interestId);
  }

  toggleFollow(profileId: string): void {
    const current = this.pendingFollows();
    if (current.includes(profileId)) {
      // Remove from pending follows - user changed their mind
      this.pendingFollows.set(current.filter(id => id !== profileId));
    } else {
      // Add to pending follows (only if not already following)
      // This will be committed to nostr relays when "Get Started" is clicked
      if (!this.followingProfiles().includes(profileId)) {
        this.pendingFollows.set([...current, profileId]);
      }
    }
  }

  getStarted(): void {
    debugger;
    // Emit both selected interests and the list of new follows to add
    this.completed.emit({
      selectedInterests: this.selectedInterests(),
      followsToAdd: this.pendingFollows(),
    });
  }

  getInterestName(interestId: string): string {
    const interest = this.availableInterests().find(i => i.id === interestId);
    return interest?.name || interestId;
  }
}
