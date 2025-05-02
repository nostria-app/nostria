import { Component, effect, inject, input, signal } from '@angular/core';
import { NostrEvent } from '../../../interfaces';
import { MatCardModule } from '@angular/material/card';
import { NostrService } from '../../../services/nostr.service';
import { kinds } from 'nostr-tools';
import { StorageService } from '../../../services/storage.service';
import { DataService } from '../../../services/data.service';
import { BadgeService } from '../../../services/badge.service';

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

@Component({
  selector: 'app-badge',
  imports: [MatCardModule],
  templateUrl: './badge.component.html',
  styleUrl: './badge.component.scss'
})
export class BadgeComponent {
  badge = input<NostrEvent | undefined>(undefined);
  nostr = inject(NostrService);
  storage = inject(StorageService);
  data = inject(DataService);
  badgeService = inject(BadgeService);

  // Parsed badge data as signals
  id = signal<string>('');
  description = signal<string>('');
  name = signal<string>('');
  image = signal<string>('');
  thumb = signal<string>('');
  tags = signal<string[]>([]);

  constructor() {
    effect(() => {
      if (this.badge()) {
        this.parseBadge(this.badge()!);
      }
    });
  }

  parseBadge(event: NostrEvent) {
    if (event.kind === kinds.BadgeDefinition) {
      this.parseBadgeDefinition(event);
    }

    if (event.kind === kinds.BadgeAward) {
      this.parseReward(event);
    }
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

  parseReward(rewardEvent: NostrEvent) {
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

    const badgeDefinition = this.badgeService.getBadgeDefinition(pubkey, slug);

    if (!badgeDefinition) {
      return;
    }

    this.parseBadgeDefinition(badgeDefinition);

    // Update the signals with the parsed values
    // this.id.set(badgeDefinition.id || '');
    // this.description.set(badgeDefinition.description || '');
    // this.name.set(badgeDefinition.name || '');
    // this.image.set(badgeDefinition.image || '');
    // this.thumb.set(badgeDefinition.thumb || '');
    // this.tags.set(badgeDefinition.tags || []);
  }
}