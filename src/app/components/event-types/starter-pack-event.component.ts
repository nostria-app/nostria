import { ChangeDetectionStrategy, Component, computed, effect, input, inject, signal } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';
import { Event, nip19 } from 'nostr-tools';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { DataService } from '../../services/data.service';
import { UserDataService } from '../../services/user-data.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { UtilitiesService } from '../../services/utilities.service';
import { LoggerService } from '../../services/logger.service';

const STARTER_PACK_KIND = 39089;

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
  private readonly data = inject(DataService);
  private readonly userDataService = inject(UserDataService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly utilities = inject(UtilitiesService);
  private readonly logger = inject(LoggerService);

  event = input<Event | undefined>(undefined);
  pubkey = input<string | undefined>(undefined);
  identifierInput = input<string | undefined>(undefined);
  relayHints = input<string[] | undefined>(undefined);
  mode = input<'full' | 'compact'>('full');

  private resolvedEvent = signal<Event | undefined>(undefined);
  isLoading = signal<boolean>(false);
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
}
