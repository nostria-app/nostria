import { Component, effect, inject, input, signal, Output, EventEmitter } from '@angular/core';
import { NostrEvent } from '../../../interfaces';
import { MatCardModule } from '@angular/material/card';
import { NostrService } from '../../../services/nostr.service';
import { kinds } from 'nostr-tools';
import { StorageService } from '../../../services/storage.service';
import { DataService } from '../../../services/data.service';
import { BadgeService } from '../../../services/badge.service';
import { RelayService } from '../../../services/relay.service';
import { UserRelayFactoryService } from '../../../services/user-relay-factory.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CommonModule, DatePipe } from '@angular/common';

interface ParsedBadge {
  id: string;
  description: string;
  name: string;
  image: string;
  thumb: string;
  tags: string[];
}

interface ParsedReward {
  badgeId: string;
  slug: string;
  pubkey: string;
  id: string;
  description: string;
  name: string;
  image: string;
  thumb: string;
  tags: string[];
}

export type BadgeLayout = 'vertical' | 'horizontal';

@Component({
  selector: 'app-badge',
  standalone: true,
  imports: [
    MatCardModule, 
    MatButtonModule, 
    MatIconModule, 
    MatProgressSpinnerModule,
    CommonModule,
    DatePipe
  ],
  templateUrl: './badge.component.html',
  styleUrl: './badge.component.scss'
})
export class BadgeComponent {
  badge = input<NostrEvent | any | undefined>(undefined);
  layout = input<BadgeLayout>('vertical');
  showActions = input<boolean>(false);
  isAccepted = input<boolean>(false);
  isUpdating = input<boolean>(false);
  issuerName = input<string | null>(null);
  
  @Output() acceptClicked = new EventEmitter<void>();
  @Output() viewClicked = new EventEmitter<void>();
  
  nostr = inject(NostrService);
  storage = inject(StorageService);
  data = inject(DataService);
  badgeService = inject(BadgeService);
  relay = inject(RelayService);
  userRelayFactory = inject(UserRelayFactoryService);

  // Parsed badge data as signals
  id = signal<string>('');
  description = signal<string>('');
  name = signal<string>('');
  image = signal<string>('');
  thumb = signal<string>('');
  tags = signal<string[]>([]);
  error = signal<string | null>(null);
  awardDate = signal<number | null>(null);

  constructor() {
    effect(async () => {
      if (this.badge()) {
        await this.parseBadge(this.badge()!);
        // if (this.badge().created_at) {
        //   this.awardDate.set(this.badge().created_at);
        // }
      }
    });
  }

  async parseBadge(event: NostrEvent | any) {
    if (event.slug) {
      await this.loadBadgeDefinition(event.pubkey, event.slug);
    }
    else if (event.kind === kinds.BadgeDefinition) {
      this.parseBadgeDefinition(event);
    }
    else if (event.kind === kinds.BadgeAward) {
      this.parseReward(event);
    }
  }

  onAccept(event: Event): void {
    event.stopPropagation();
    this.acceptClicked.emit();
  }

  onView(event: Event): void {
    event.stopPropagation();
    this.viewClicked.emit();
  }

  async loadBadgeDefinition(pubkey: string, slug: string) {
    let definition: NostrEvent | null | undefined = this.badgeService.getBadgeDefinition(pubkey, slug);

    if (!definition) {
      definition = await this.relay.getEventByPubkeyAndKindAndTag(pubkey, kinds.BadgeDefinition, { key: 'd', value: slug });
      console.log('Badge definition not found in local storage, fetched from relay:', definition);
      // const userRelay = this.userRelayFactory.createUserRelayService();

      // If the definition is not found on the user's relays, try to fetch from author and then re-publish to user's relays.
      if (!definition) {
        try {
          const userRelay = await this.userRelayFactory.create(pubkey);
          definition = await userRelay.getEventByPubkeyAndKindAndTag(pubkey, kinds.BadgeDefinition, { key: 'd', value: slug });
          console.log('Badge definition not found on user relays, fetched from author relays:', definition);

          if (!definition) {
            this.error.set('Badge definition not found on author relays.');
          }

        } catch (err: any) {
          console.error(err);
          this.error.set(err.message);
        }
      }
    }

    if (definition) {
      this.badgeService.putBadgeDefinition(definition);
      await this.storage.saveEvent(definition);
      this.parseBadgeDefinition(definition);
    }

    return definition;
  }

  parseBadgeDefinition(badgeEvent: NostrEvent) {
    if (!badgeEvent || !badgeEvent.tags) {
      return;
    }

    const parsedBadge: Partial<ParsedBadge> = {
      tags: []
    };

    // Parse each tag based on its identifier
    for (const tag of badgeEvent.tags) {
      if (tag.length >= 2) {
        const [key, value] = tag;

        switch (key) {
          case 'd':
            parsedBadge.id = value;
            break;
          case 'description':
            parsedBadge.description = value;
            break;
          case 'name':
            parsedBadge.name = value;
            break;
          case 'image':
            parsedBadge.image = value;
            break;
          case 'thumb':
            parsedBadge.thumb = value;
            break;
          case 't':
            // Accumulate types in an array
            if (parsedBadge.tags) {
              parsedBadge.tags.push(value);
            }
            break;
        }
      }
    }

    // Update the signals with the parsed values
    this.id.set(parsedBadge.id || '');
    this.description.set(parsedBadge.description || '');
    this.name.set(parsedBadge.name || '');
    this.image.set(parsedBadge.image || '');
    this.thumb.set(parsedBadge.thumb || '');
    this.tags.set(parsedBadge.tags || []);
  }

  async parseReward(rewardEvent: NostrEvent) {
    if (!rewardEvent || !rewardEvent.tags) {
      return;
    }

    const parsedReward: Partial<ParsedReward> = {
      tags: []
    };

    const badgeTag = this.nostr.getTags(rewardEvent, 'a');

    if (badgeTag.length !== 1) {
      return;
    }

    const receivers = this.nostr.getTags(rewardEvent, 'p');
    const badgeTagArray = badgeTag[0].split(':');

    // Just validate if the badge type is a badge definition
    if (Number(badgeTagArray[0]) !== kinds.BadgeDefinition) {
      return;
    }

    // Validate that the pubkey is the same as the one in the badge tag
    if (badgeTagArray[1] !== rewardEvent.pubkey) {
      return;
    }

    const pubkey = rewardEvent.pubkey;
    const slug = badgeTagArray[2];

    await this.loadBadgeDefinition(pubkey, slug);
  }
}