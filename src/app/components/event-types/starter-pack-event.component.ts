import { ChangeDetectionStrategy, Component, computed, effect, input, inject, signal } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterModule } from '@angular/router';
import { Event, nip19 } from 'nostr-tools';
import { firstValueFrom } from 'rxjs';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { DataService } from '../../services/data.service';
import { UserDataService } from '../../services/user-data.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { UtilitiesService } from '../../services/utilities.service';
import { LoggerService } from '../../services/logger.service';
import { FollowSetsService } from '../../services/follow-sets.service';
import { CreateListDialogComponent, CreateListDialogResult } from '../create-list-dialog/create-list-dialog.component';

const STARTER_PACK_KIND = 39089;

@Component({
  selector: 'app-starter-pack-event',
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    RouterModule,
    UserProfileComponent,
  ],
  templateUrl: './starter-pack-event.component.html',
  styleUrl: './starter-pack-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StarterPackEventComponent {
  private accountState = inject(AccountStateService);
  private layout = inject(LayoutService);
  private readonly data = inject(DataService);
  private readonly userDataService = inject(UserDataService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly utilities = inject(UtilitiesService);
  private readonly logger = inject(LoggerService);
  private readonly followSetsService = inject(FollowSetsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  event = input<Event | undefined>(undefined);
  pubkey = input<string | undefined>(undefined);
  identifierInput = input<string | undefined>(undefined);
  relayHints = input<string[] | undefined>(undefined);
  mode = input<'full' | 'compact'>('full');

  private resolvedEvent = signal<Event | undefined>(undefined);
  isLoading = signal<boolean>(false);
  isFollowingAll = signal(false);
  isAddingToList = signal(false);
  private lastLoadKey = '';

  starterPackEvent = computed<Event | undefined>(() => this.event() || this.resolvedEvent());

  constructor() {
    effect(() => {
      const explicitEvent = this.event();
      if (explicitEvent) {
        this.resolvedEvent.set(undefined);
        return;
      }

      const pubkey = this.pubkey();
      const identifier = this.identifierInput();
      if (!pubkey || !identifier) {
        return;
      }

      const relayHints = this.relayHints() || [];
      const loadKey = `${pubkey}:${identifier}:${relayHints.join(',')}`;
      if (loadKey === this.lastLoadKey) {
        return;
      }

      this.lastLoadKey = loadKey;
      void this.loadStarterPack(pubkey, identifier, relayHints);
    });
  }

  // Extract the title from tags
  title = computed(() => {
    const event = this.starterPackEvent();
    if (!event) {
      return this.identifierInput() || 'Starter Pack';
    }

    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return titleTag?.[1] || 'Starter Pack';
  });

  // Extract the image URL from tags
  image = computed(() => {
    const event = this.starterPackEvent();
    if (!event) return null;

    const imageTag = event.tags.find(tag => tag[0] === 'image');
    return imageTag?.[1] || null;
  });

  // Extract all public keys (p tags) that represent users in the starter pack
  publicKeys = computed(() => {
    const event = this.starterPackEvent();
    if (!event) return [];

    return event.tags.filter(tag => tag[0] === 'p' && tag[1]).map(tag => tag[1]);
  });

  // Extract the d tag (identifier)
  identifier = computed(() => {
    const event = this.starterPackEvent();
    if (!event) {
      return this.identifierInput() || null;
    }

    const dTag = event.tags.find(tag => tag[0] === 'd');
    return dTag?.[1] || null;
  });

  userCount = computed(() => this.publicKeys().length);

  availableFollowSets = computed(() => {
    return [...this.followSetsService.followSets()].sort((a, b) => a.title.localeCompare(b.title));
  });

  private async loadStarterPack(pubkey: string, identifier: string, relayHints: string[]): Promise<void> {
    this.isLoading.set(true);

    try {
      if (relayHints.length > 0) {
        const normalizedHints = this.utilities.normalizeRelayUrls(relayHints);
        const eventFromHints = await this.relayPool.get(
          normalizedHints,
          {
            authors: [pubkey],
            kinds: [STARTER_PACK_KIND],
            '#d': [identifier],
          },
          2500,
        );

        if (eventFromHints) {
          this.resolvedEvent.set(eventFromHints);
          return;
        }
      }

      const isNotCurrentUser = !this.accountState.isCurrentUser(pubkey);
      const record = isNotCurrentUser
        ? await this.userDataService.getEventByPubkeyAndKindAndReplaceableEvent(pubkey, STARTER_PACK_KIND, identifier, {
          save: false,
          cache: false,
        })
        : await this.data.getEventByPubkeyAndKindAndReplaceableEvent(pubkey, STARTER_PACK_KIND, identifier, {
          save: false,
          cache: false,
        });

      this.resolvedEvent.set(record?.event);
    } catch (error) {
      this.logger.debug('[StarterPackEventComponent] Failed to load starter pack mention', {
        pubkey,
        identifier,
        error,
      });
      this.resolvedEvent.set(undefined);
    } finally {
      this.isLoading.set(false);
    }
  }

  openStarterPack(): void {
    const event = this.starterPackEvent();
    const pubkey = event?.pubkey || this.pubkey();
    const identifier = this.identifier();
    if (!pubkey || !identifier) return;

    const naddr = nip19.naddrEncode({
      kind: event?.kind || STARTER_PACK_KIND,
      pubkey,
      identifier,
      relays: this.relayHints(),
    });

    this.layout.openArticle(naddr, event);
  }

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

  async followAll(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    const pubkeys = this.publicKeys();
    const toFollow = pubkeys.filter(pubkey => !this.accountState.isFollowing()(pubkey));

    if (toFollow.length === 0) {
      this.snackBar.open('Already following all users in this starter pack', 'Close', { duration: 3000 });
      return;
    }

    this.isFollowingAll.set(true);
    try {
      await this.accountState.follow(toFollow);
      this.snackBar.open(`Followed ${toFollow.length} users`, 'Close', { duration: 3000 });
    } catch (error) {
      this.logger.error('[StarterPackEventComponent] Failed to follow all users', error);
      this.snackBar.open('Failed to follow all users', 'Close', { duration: 3000 });
    } finally {
      this.isFollowingAll.set(false);
    }
  }

  async addAllToFollowSet(dTag: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();

    const followSet = this.followSetsService.getFollowSetByDTag(dTag);
    if (!followSet) {
      this.snackBar.open('List not found', 'Close', { duration: 3000 });
      return;
    }

    const pubkeys = this.publicKeys();
    const toAdd = pubkeys.filter(pubkey => !followSet.pubkeys.includes(pubkey));

    if (toAdd.length === 0) {
      this.snackBar.open('All users already exist in this list', 'Close', { duration: 3000 });
      return;
    }

    this.isAddingToList.set(true);
    try {
      for (const pubkey of toAdd) {
        await this.followSetsService.addToFollowSet(dTag, pubkey);
      }
      this.snackBar.open(`Added ${toAdd.length} users to "${followSet.title}"`, 'Close', { duration: 3000 });
    } catch (error) {
      this.logger.error('[StarterPackEventComponent] Failed to add users to list', error);
      this.snackBar.open('Failed to add users to list', 'Close', { duration: 3000 });
    } finally {
      this.isAddingToList.set(false);
    }
  }

  async createListAndAddAll(event: MouseEvent): Promise<void> {
    event.stopPropagation();

    const dialogRef = this.dialog.open(CreateListDialogComponent, {
      data: { initialPrivate: false },
      width: '450px',
    });

    const result: CreateListDialogResult | null = await firstValueFrom(dialogRef.afterClosed());
    if (!result || !result.title.trim()) {
      return;
    }

    this.isAddingToList.set(true);
    try {
      const newSet = await this.followSetsService.createFollowSet(
        result.title.trim(),
        this.publicKeys(),
        result.isPrivate,
      );

      if (newSet) {
        this.snackBar.open(`Created "${newSet.title}" and added ${this.publicKeys().length} users`, 'Close', { duration: 3000 });
      } else {
        this.snackBar.open('Failed to create list', 'Close', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('[StarterPackEventComponent] Failed to create list from starter pack', error);
      this.snackBar.open('Failed to create list', 'Close', { duration: 3000 });
    } finally {
      this.isAddingToList.set(false);
    }
  }
}
