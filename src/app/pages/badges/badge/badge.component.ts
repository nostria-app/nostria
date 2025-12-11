import {
  Component,
  effect,
  inject,
  input,
  signal,
  Output,
  EventEmitter,
  untracked,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { NostrService } from '../../../services/nostr.service';
import { kinds, NostrEvent } from 'nostr-tools';
import { DatabaseService } from '../../../services/database.service';
import { DataService } from '../../../services/data.service';
import { BadgeService, ParsedBadge } from '../../../services/badge.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CommonModule } from '@angular/common';
import { UtilitiesService } from '../../../services/utilities.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { TimestampPipe } from '../../../pipes/timestamp.pipe';

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
    TimestampPipe,
  ],
  templateUrl: './badge.component.html',
  styleUrl: './badge.component.scss',
})
export class BadgeComponent {
  badge = input<NostrEvent | any | undefined>(undefined);
  definition = signal<NostrEvent | undefined | null>(undefined);
  parsed = signal<ParsedBadge | undefined>(undefined);
  // definition = input<NostrEvent | any | undefined>(undefined);

  // image = computed(() => {
  // });

  layout = input<BadgeLayout>('vertical');
  showActions = input<boolean>(false);
  isAccepted = input<boolean>(false);
  isUpdating = input<boolean>(false);
  issuerName = input<string | null>(null);
  recipientName = input<string | null>(null);
  utilities = inject(UtilitiesService);

  @Output() acceptClicked = new EventEmitter<void>();
  @Output() viewClicked = new EventEmitter<void>();
  @Output() removeClicked = new EventEmitter<void>();

  nostr = inject(NostrService);
  database = inject(DatabaseService);
  data = inject(DataService);
  badgeService = inject(BadgeService);
  relay = inject(AccountRelayService);

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
        untracked(async () => {
          await this.parseBadge(this.badge()!);
        });
        // if (this.badge().created_at) {
        //   this.awardDate.set(this.badge().created_at);
        // }
      }
    });
  }

  async parseBadge(event: NostrEvent | any) {
    if (event.slug) {
      // Check if definition is already loaded
      const definition = this.badgeService.getBadgeDefinition(event.pubkey, event.slug);

      if (definition) {
        // Definition already in memory, use it immediately
        this.definition.set(definition);
      } else {
        // Set definition to null to show loading state
        this.definition.set(null);

        // Load definition in background (non-blocking)
        this.loadBadgeDefinition(event.pubkey, event.slug).then(def => {
          this.definition.set(def || undefined);
        }).catch(err => {
          console.error('Error loading badge definition:', err);
          this.error.set('Failed to load badge');
          this.definition.set(undefined);
        });
      }
    } else if (event.kind === kinds.BadgeDefinition) {
      this.definition.set(event);

      // const parsedBadge = this.badgeService.parseBadgeDefinition(event);

      // if (!parsedBadge) {
      //   this.error.set('Failed to parse badge data');
      //   return;
      // }

      // // Update the signals with the parsed values
      // this.id.set(parsedBadge.slug || '');
      // this.description.set(parsedBadge.description || '');
      // this.name.set(parsedBadge.name || '');
      // this.image.set(parsedBadge.image || '');
      // this.thumb.set(parsedBadge.thumb || '');
      // this.tags.set(parsedBadge.tags || []);
    } else if (event.kind === kinds.BadgeAward) {
      const aTag = this.utilities.getATagValueFromEvent(event);
      const values = aTag?.split(':');

      if (!values) {
        return;
      }

      const slug = values[2];

      const definition = await this.loadBadgeDefinition(event.pubkey, slug);
      this.definition.set(definition);
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

    if (this.definition()) {
      const parsedBadge = this.badgeService.parseDefinition(this.definition()!);
      console.log('Parsed Badge:', parsedBadge);
      this.parsed.set(parsedBadge);
    } else if (this.definition() === null) {
      // null means loading, set a loading placeholder
      this.parsed.set({
        slug: '',
        name: 'Loading...',
        description: 'Loading badge definition...',
        image: '',
        thumb: '',
        tags: [],
      });
    } else {
      // undefined means failed to load
      this.error.set('Failed to parse badge data');
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

  onRemove(event: Event): void {
    debugger;
    event.stopPropagation();
    this.removeClicked.emit();
  }

  async loadBadgeDefinition(pubkey: string, slug: string) {
    let definition: NostrEvent | null | undefined = this.badgeService.getBadgeDefinition(
      pubkey,
      slug
    );

    if (!definition) {
      definition = await this.badgeService.loadBadgeDefinition(pubkey, slug);
    }

    return definition;
  }
}
