import { Component, effect, inject, input, signal, Output, EventEmitter } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { NostrService } from '../../../services/nostr.service';
import { kinds, NostrEvent } from 'nostr-tools';
import { StorageService } from '../../../services/storage.service';
import { DataService } from '../../../services/data.service';
import { BadgeService } from '../../../services/badge.service';
import { RelayService } from '../../../services/relay.service';
import { UserRelayFactoryService } from '../../../services/user-relay-factory.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CommonModule, DatePipe } from '@angular/common';
import { UtilitiesService } from '../../../services/utilities.service';

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
  utilities = inject(UtilitiesService);

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
      const parsedBadge = this.badgeService.parseBadgeDefinition(event);

      if (!parsedBadge) {
        this.error.set('Failed to parse badge data');
        return;
      }

      // Update the signals with the parsed values
      this.id.set(parsedBadge.id || '');
      this.description.set(parsedBadge.description || '');
      this.name.set(parsedBadge.name || '');
      this.image.set(parsedBadge.image || '');
      this.thumb.set(parsedBadge.thumb || '');
      this.tags.set(parsedBadge.tags || []);
    }
    else if (event.kind === kinds.BadgeAward) {
      const parsedBadge = await this.badgeService.parseReward(event);

      if (!parsedBadge) {
        this.error.set('Failed to parse badge data');
        return;
      }

      // Update the signals with the parsed values
      this.id.set(parsedBadge.id || '');
      this.description.set(parsedBadge.description || '');
      this.name.set(parsedBadge.name || '');
      this.image.set(parsedBadge.image || '');
      this.thumb.set(parsedBadge.thumb || '');
      this.tags.set(parsedBadge.tags || []);
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
    return definition;
  }

}