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
import { kinds, NostrEvent } from 'nostr-tools';
import { BadgeService, ParsedBadge } from '../../../services/badge.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CommonModule } from '@angular/common';
import { UtilitiesService } from '../../../services/utilities.service';
import { TimestampPipe } from '../../../pipes/timestamp.pipe';
import { LoggerService } from '../../../services/logger.service';

export type BadgeLayout = 'vertical' | 'horizontal';

@Component({
  selector: 'app-badge',
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
  badge = input<NostrEvent | { pubkey: string; slug: string } | undefined>(undefined);
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

  badgeService = inject(BadgeService);
  private readonly logger = inject(LoggerService);

  // Parsed badge data as signals
  id = signal<string>('');
  description = signal<string>('');
  name = signal<string>('');
  image = signal<string>('');
  thumb = signal<string>('');
  tags = signal<string[]>([]);
  error = signal<string | null>(null);
  awardDate = signal<number | null>(null);

  private isAcceptedBadgeRef(
    value: NostrEvent | { pubkey: string; slug: string }
  ): value is { pubkey: string; slug: string } {
    return (
      typeof (value as { pubkey?: unknown }).pubkey === 'string' &&
      typeof (value as { slug?: unknown }).slug === 'string' &&
      typeof (value as { kind?: unknown }).kind !== 'number'
    );
  }

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

  async parseBadge(event: NostrEvent | { pubkey: string; slug: string }): Promise<void> {
    this.error.set(null);
    this.awardDate.set(null);

    if (this.isAcceptedBadgeRef(event)) {
      const cached = this.badgeService.getBadgeDefinition(event.pubkey, event.slug);
      if (cached) {
        this.definition.set(cached);
        this.parsed.set(this.badgeService.parseDefinition(cached));
        return;
      }

      this.definition.set(null);
      this.parsed.set({
        slug: '',
        name: 'Loading...',
        description: 'Loading badge definition...',
        image: '',
        thumb: '',
        tags: [],
      });

      this.loadBadgeDefinition(event.pubkey, event.slug)
        .then(definition => {
          this.definition.set(definition || undefined);
          if (definition) {
            this.parsed.set(this.badgeService.parseDefinition(definition));
          } else {
            this.error.set('Failed to load badge');
          }
        })
        .catch(err => {
          this.logger.error('Error loading badge definition:', err);
          this.error.set('Failed to load badge');
          this.definition.set(undefined);
        });
      return;
    }

    if (event.kind === kinds.BadgeDefinition) {
      this.definition.set(event);
      this.parsed.set(this.badgeService.parseDefinition(event));
      return;
    }

    if (event.kind === kinds.BadgeAward) {
      this.awardDate.set(event.created_at);

      // BadgeAward references its definition via the a-tag: 30009:<pubkey>:<slug>
      const aTag = this.utilities.getATagValueFromEvent(event);
      const values = aTag?.split(':');

      if (!values || values.length < 3) {
        this.definition.set(undefined);
        this.parsed.set({
          slug: '',
          name: 'Unknown Badge',
          description: 'Badge reference missing',
          image: '',
          thumb: '',
          tags: [],
        });
        return;
      }

      const definitionPubkey = values[1] || event.pubkey;
      const slug = values[2];

      this.definition.set(null);
      this.parsed.set({
        slug: '',
        name: 'Loading...',
        description: 'Loading badge definition...',
        image: '',
        thumb: '',
        tags: [],
      });

      this.loadBadgeDefinition(definitionPubkey, slug)
        .then(definition => {
          this.definition.set(definition || undefined);
          if (definition) {
            this.parsed.set(this.badgeService.parseDefinition(definition));
          } else {
            this.error.set('Failed to load badge');
          }
        })
        .catch(err => {
          this.logger.error('Error loading badge definition:', err);
          this.error.set('Failed to load badge');
          this.definition.set(undefined);
        });
      return;
    }

    this.definition.set(undefined);
    this.error.set('Failed to parse badge data');
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
