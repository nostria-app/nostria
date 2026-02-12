import { ChangeDetectionStrategy, Component, computed, input, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { Event } from 'nostr-tools';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';

@Component({
  selector: 'app-people-set-event',
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    UserProfileComponent,
  ],
  templateUrl: './people-set-event.component.html',
  styleUrl: './people-set-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PeopleSetEventComponent {
  private accountState = inject(AccountStateService);
  private layout = inject(LayoutService);
  private snackBar = inject(MatSnackBar);

  event = input.required<Event>();

  // Loading states
  isFollowingAll = signal(false);
  isUnfollowingAll = signal(false);

  // Extract the title from tags
  title = computed(() => {
    const event = this.event();
    if (!event) return 'People Set';

    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return titleTag?.[1] || 'People Set';
  });

  // Extract the description from tags
  description = computed(() => {
    const event = this.event();
    if (!event) return null;

    const descTag = event.tags.find(tag => tag[0] === 'description');
    return descTag?.[1] || null;
  });

  // Extract the d tag (identifier)
  identifier = computed(() => {
    const event = this.event();
    if (!event) return null;

    const dTag = event.tags.find(tag => tag[0] === 'd');
    return dTag?.[1] || null;
  });

  // Extract all public keys (p tags) that represent users in the people set
  publicKeys = computed(() => {
    const event = this.event();
    if (!event) return [];

    return event.tags.filter(tag => tag[0] === 'p' && tag[1]).map(tag => tag[1]);
  });

  // Extract petnames for each pubkey (optional 4th element in p tag)
  petnames = computed(() => {
    const event = this.event();
    if (!event) return new Map<string, string>();

    const namesMap = new Map<string, string>();
    event.tags
      .filter(tag => tag[0] === 'p' && tag[1] && tag[3])
      .forEach(tag => namesMap.set(tag[1], tag[3]));
    return namesMap;
  });

  // Count how many users in the list are being followed
  followedCount = computed(() => {
    const pubkeys = this.publicKeys();
    return pubkeys.filter(pk => this.accountState.isFollowing()(pk)).length;
  });

  // Check if all users in the list are being followed
  allFollowed = computed(() => {
    const pubkeys = this.publicKeys();
    if (pubkeys.length === 0) return false;
    return pubkeys.every(pk => this.accountState.isFollowing()(pk));
  });

  // Check if none of the users are being followed
  noneFollowed = computed(() => {
    const pubkeys = this.publicKeys();
    return pubkeys.every(pk => !this.accountState.isFollowing()(pk));
  });

  // Check if a user is being followed
  isFollowing(pubkey: string): boolean {
    return this.accountState.isFollowing()(pubkey);
  }

  // Navigate to user profile
  navigateToProfile(pubkey: string): void {
    this.layout.navigateToProfile(pubkey);
  }

  // Follow a single user
  async followUser(pubkey: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    await this.accountState.follow(pubkey);
  }

  // Unfollow a single user
  async unfollowUser(pubkey: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    await this.accountState.unfollow(pubkey);
  }

  // Follow all users in the list
  async followAll(): Promise<void> {
    const pubkeys = this.publicKeys();
    const toFollow = pubkeys.filter(pk => !this.accountState.isFollowing()(pk));

    if (toFollow.length === 0) {
      this.snackBar.open('Already following all users in this list', 'Close', { duration: 3000 });
      return;
    }

    this.isFollowingAll.set(true);
    try {
      await this.accountState.follow(toFollow);
      this.snackBar.open(`Followed ${toFollow.length} users`, 'Close', { duration: 3000 });
    } catch (error) {
      console.error('Error following all users:', error);
      this.snackBar.open('Failed to follow users', 'Close', { duration: 3000 });
    } finally {
      this.isFollowingAll.set(false);
    }
  }

  // Unfollow all users in the list
  async unfollowAll(): Promise<void> {
    const pubkeys = this.publicKeys();
    const toUnfollow = pubkeys.filter(pk => this.accountState.isFollowing()(pk));

    if (toUnfollow.length === 0) {
      this.snackBar.open('Not following any users in this list', 'Close', { duration: 3000 });
      return;
    }

    this.isUnfollowingAll.set(true);
    try {
      // Unfollow each user sequentially (unfollow doesn't support arrays)
      for (const pubkey of toUnfollow) {
        await this.accountState.unfollow(pubkey);
      }
      this.snackBar.open(`Unfollowed ${toUnfollow.length} users`, 'Close', { duration: 3000 });
    } catch (error) {
      console.error('Error unfollowing all users:', error);
      this.snackBar.open('Failed to unfollow users', 'Close', { duration: 3000 });
    } finally {
      this.isUnfollowingAll.set(false);
    }
  }

  // Copy the list of pubkeys to clipboard (as JSON array)
  async copyList(): Promise<void> {
    const pubkeys = this.publicKeys();
    try {
      await navigator.clipboard.writeText(JSON.stringify(pubkeys, null, 2));
      this.snackBar.open('List copied to clipboard', 'Close', { duration: 3000 });
    } catch (error) {
      console.error('Error copying list:', error);
      this.snackBar.open('Failed to copy list', 'Close', { duration: 3000 });
    }
  }
}
