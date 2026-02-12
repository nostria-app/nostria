import { ChangeDetectionStrategy, Component, computed, input, inject } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';
import { Event } from 'nostr-tools';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';

@Component({
  selector: 'app-starter-pack-event',
  imports: [MatCardModule, MatIconModule, MatButtonModule, MatTooltipModule, RouterModule, UserProfileComponent],
  templateUrl: './starter-pack-event.component.html',
  styleUrl: './starter-pack-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StarterPackEventComponent {
  private accountState = inject(AccountStateService);
  private layout = inject(LayoutService);

  event = input.required<Event>();

  // Extract the title from tags
  title = computed(() => {
    const event = this.event();
    if (!event) return null;

    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return titleTag?.[1] || 'Starter Pack';
  });

  // Extract the image URL from tags
  image = computed(() => {
    const event = this.event();
    if (!event) return null;

    const imageTag = event.tags.find(tag => tag[0] === 'image');
    return imageTag?.[1] || null;
  });

  // Extract all public keys (p tags) that represent users in the starter pack
  publicKeys = computed(() => {
    const event = this.event();
    if (!event) return [];

    return event.tags.filter(tag => tag[0] === 'p' && tag[1]).map(tag => tag[1]);
  });

  // Extract the d tag (identifier)
  identifier = computed(() => {
    const event = this.event();
    if (!event) return null;

    const dTag = event.tags.find(tag => tag[0] === 'd');
    return dTag?.[1] || null;
  });

  // Check if a user is being followed
  isFollowing(pubkey: string): boolean {
    return this.accountState.isFollowing()(pubkey);
  }

  // Navigate to user profile
  navigateToProfile(pubkey: string): void {
    this.layout.navigateToProfile(pubkey);
  }

  // Follow a user
  async followUser(pubkey: string, event: MouseEvent): Promise<void> {
    event.stopPropagation(); // Prevent card click when follow button is clicked
    await this.accountState.follow(pubkey);
  }

  // Unfollow a user
  async unfollowUser(pubkey: string, event: MouseEvent): Promise<void> {
    event.stopPropagation(); // Prevent card click when unfollow button is clicked
    await this.accountState.unfollow(pubkey);
  }
}
