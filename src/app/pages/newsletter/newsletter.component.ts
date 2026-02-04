import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { kinds, Event } from 'nostr-tools';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { LoggerService } from '../../services/logger.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { DatabaseService } from '../../services/database.service';
import { ZapService } from '../../services/zap.service';
import { UtilitiesService } from '../../services/utilities.service';
import { MessagingService } from '../../services/messaging.service';
import { LayoutService } from '../../services/layout.service';
import { RouteDataService } from '../../services/route-data.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';

// Engagement types that can be targeted
type EngagementType = 'liked' | 'commented' | 'reposted' | 'zapped';

interface RecipientInfo {
  pubkey: string;
  sent: boolean;
  error?: string;
}

@Component({
  selector: 'app-newsletter',
  imports: [
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatCardModule,
    MatDividerModule,
    MatTooltipModule,
    MatSelectModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatProgressBarModule,
    MatSnackBarModule,
    FormsModule,
    DatePipe,
    UserProfileComponent,
  ],
  templateUrl: './newsletter.component.html',
  styleUrl: './newsletter.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewsletterComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly accountState = inject(AccountStateService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly relayPool = inject(RelayPoolService);
  private readonly database = inject(DatabaseService);
  private readonly logger = inject(LoggerService);
  private readonly zapService = inject(ZapService);
  private readonly utilities = inject(UtilitiesService);
  private readonly messaging = inject(MessagingService);
  private readonly snackBar = inject(MatSnackBar);
  protected readonly app = inject(ApplicationService);
  protected readonly layout = inject(LayoutService);
  protected readonly routeData = inject(RouteDataService);

  // Event being targeted
  targetEvent = signal<Event | null>(null);
  eventEncodedId = signal<string>('');
  isAddressableEvent = signal<boolean>(false);
  eventAddress = signal<string>(''); // kind:pubkey:dTag for addressable events

  // Loading states
  isLoadingEvent = signal(false);
  isLoadingRecipients = signal(false);
  isSending = signal(false);
  loadError = signal<string | null>(null);

  // Engagement selection
  selectedEngagementType = signal<EngagementType>('liked');
  engagementTypes: { value: EngagementType; label: string; icon: string }[] = [
    { value: 'liked', label: 'Liked', icon: 'favorite' },
    { value: 'commented', label: 'Commented', icon: 'chat_bubble' },
    { value: 'reposted', label: 'Reposted', icon: 'repeat' },
    { value: 'zapped', label: 'Zapped', icon: 'bolt' },
  ];

  // Recipients
  recipients = signal<RecipientInfo[]>([]);
  messageText = signal<string>('');

  // Sending progress
  sendProgress = signal(0);
  sendStatus = signal('');
  sentCount = signal(0);
  failedCount = signal(0);

  isPremium = computed(() => {
    const subscription = this.accountState.subscription();
    return subscription?.expires && subscription.expires > Date.now();
  });

  recipientCount = computed(() => this.recipients().length);

  canSend = computed(() => {
    return (
      this.isPremium() &&
      this.recipients().length > 0 &&
      this.messageText().trim().length > 0 &&
      !this.isSending()
    );
  });

  /**
   * Remove a recipient from the list (temporary, not persisted)
   */
  removeRecipient(pubkey: string): void {
    this.recipients.update(list => list.filter(r => r.pubkey !== pubkey));
  }

  async ngOnInit(): Promise<void> {
    const encodedId = this.route.snapshot.paramMap.get('id');
    if (encodedId) {
      this.eventEncodedId.set(encodedId);
      await this.loadTargetEvent(encodedId);
    }
  }

  private async loadTargetEvent(encodedId: string): Promise<void> {
    this.isLoadingEvent.set(true);
    this.loadError.set(null);

    try {
      const decoded = this.utilities.decodeEventFromUrl(encodedId);
      if (!decoded) {
        this.loadError.set('Invalid event ID format. Please use a valid nevent or naddr.');
        this.logger.error('Failed to decode event ID:', encodedId);
        return;
      }

      let event: Event | null = null;

      // Check if this is an addressable event (naddr)
      if (decoded.identifier !== undefined && decoded.kind !== undefined && decoded.author) {
        this.isAddressableEvent.set(true);
        const dTag = decoded.identifier || '';
        this.eventAddress.set(`${decoded.kind}:${decoded.author}:${dTag}`);

        // For addressable events, we need to query by kind, author, and d-tag
        // First try account relay
        const events = await this.accountRelay.getMany({
          kinds: [decoded.kind],
          authors: [decoded.author],
          '#d': [dTag],
          limit: 1,
        });

        if (events.length > 0) {
          event = events[0];
        } else if (decoded.relays && decoded.relays.length > 0) {
          // Try relay hints
          const relayEvents = await this.relayPool.query(decoded.relays, {
            kinds: [decoded.kind],
            authors: [decoded.author],
            '#d': [dTag],
            limit: 1,
          });
          if (relayEvents.length > 0) {
            event = relayEvents[0];
          }
        }
      } else if (decoded.id) {
        // Regular event (nevent)
        this.isAddressableEvent.set(false);

        // 1. First check local database
        event = await this.database.getEventById(decoded.id);

        // 2. If not found, try account relay
        if (!event) {
          event = await this.accountRelay.get({ ids: [decoded.id] });
        }

        // 3. If still not found and we have relay hints, try those
        if (!event && decoded.relays && decoded.relays.length > 0) {
          event = await this.relayPool.getEventById(decoded.relays, decoded.id, 5000);
        }
      } else {
        this.loadError.set('Invalid event data. Missing event ID or address information.');
        return;
      }

      if (event) {
        this.targetEvent.set(event);
        await this.loadRecipients();
      } else {
        this.loadError.set('Event not found. It may have been deleted or is not available on your relays.');
      }
    } catch (error) {
      this.loadError.set('Failed to load event. Please try again.');
      this.logger.error('Failed to load target event:', error);
    } finally {
      this.isLoadingEvent.set(false);
    }
  }

  async onEngagementTypeChange(value: EngagementType): Promise<void> {
    this.selectedEngagementType.set(value);
    await this.loadRecipients();
  }

  private async loadRecipients(): Promise<void> {
    const event = this.targetEvent();
    if (!event) return;

    this.isLoadingRecipients.set(true);
    this.recipients.set([]);

    try {
      const myPubkey = this.accountState.pubkey();
      const engagementType = this.selectedEngagementType();
      let pubkeys: string[] = [];

      switch (engagementType) {
        case 'liked':
          pubkeys = await this.loadLikers(event);
          break;
        case 'commented':
          pubkeys = await this.loadCommenters(event);
          break;
        case 'reposted':
          pubkeys = await this.loadReposters(event);
          break;
        case 'zapped':
          pubkeys = await this.loadZappers(event);
          break;
      }

      // Deduplicate and exclude self
      const uniquePubkeys = [...new Set(pubkeys)].filter(pk => pk !== myPubkey);

      this.recipients.set(
        uniquePubkeys.map(pubkey => ({
          pubkey,
          sent: false,
        }))
      );

      this.logger.info(`Loaded ${uniquePubkeys.length} recipients for ${engagementType}`);
    } catch (error) {
      this.logger.error('Failed to load recipients:', error);
    } finally {
      this.isLoadingRecipients.set(false);
    }
  }

  private async loadLikers(event: Event): Promise<string[]> {
    // Query reactions (kind 7) with #e tag pointing to this event
    // For addressable events, also query with #a tag
    const filters: { kinds: number[]; '#e'?: string[]; '#a'?: string[]; limit: number }[] = [
      {
        kinds: [kinds.Reaction],
        '#e': [event.id],
        limit: 500,
      },
    ];

    // For addressable events, also query by address tag
    if (this.isAddressableEvent()) {
      filters.push({
        kinds: [kinds.Reaction],
        '#a': [this.eventAddress()],
        limit: 500,
      });
    }

    const reactions: Event[] = [];
    for (const filter of filters) {
      const events = await this.accountRelay.getMany(filter);
      this.logger.debug(`Loaded ${events.length} reactions with filter:`, filter);
      reactions.push(...events);
    }

    this.logger.debug(`Total reactions loaded: ${reactions.length}`, reactions.map(r => ({ pubkey: r.pubkey, content: r.content })));

    // Filter out dislikes (content is '-') - all other reactions are considered positive
    // NIP-25: '+' is like, '-' is dislike, any other content (emoji, etc.) is also a reaction
    const likes = reactions.filter(r => r.content !== '-');

    this.logger.debug(`After filtering dislikes: ${likes.length} likes`);

    return likes.map(r => r.pubkey);
  }

  private async loadCommenters(event: Event): Promise<string[]> {
    // Query replies (kind 1) with #e tag pointing to this event
    const filters: { kinds: number[]; '#e'?: string[]; '#a'?: string[]; limit: number }[] = [
      {
        kinds: [kinds.ShortTextNote],
        '#e': [event.id],
        limit: 500,
      },
    ];

    // For addressable events (articles), also query by address tag
    if (this.isAddressableEvent()) {
      filters.push({
        kinds: [kinds.ShortTextNote],
        '#a': [this.eventAddress()],
        limit: 500,
      });
    }

    const replies: Event[] = [];
    for (const filter of filters) {
      const events = await this.accountRelay.getMany(filter);
      replies.push(...events);
    }

    return replies.map(r => r.pubkey);
  }

  private async loadReposters(event: Event): Promise<string[]> {
    // Query reposts (kind 6 for notes, kind 16 for generic)
    const repostKind = event.kind === kinds.ShortTextNote ? kinds.Repost : kinds.GenericRepost;

    const filters: { kinds: number[]; '#e'?: string[]; '#a'?: string[]; limit: number }[] = [
      {
        kinds: [repostKind],
        '#e': [event.id],
        limit: 500,
      },
    ];

    // For addressable events, also query by address tag
    if (this.isAddressableEvent()) {
      filters.push({
        kinds: [repostKind],
        '#a': [this.eventAddress()],
        limit: 500,
      });
    }

    const reposts: Event[] = [];
    for (const filter of filters) {
      const events = await this.accountRelay.getMany(filter);
      reposts.push(...events);
    }

    return reposts.map(r => r.pubkey);
  }

  private async loadZappers(event: Event): Promise<string[]> {
    // Query zap receipts (kind 9735) with #e tag pointing to this event
    const filters: { kinds: number[]; '#e'?: string[]; '#a'?: string[]; limit: number }[] = [
      {
        kinds: [9735], // Zap receipt
        '#e': [event.id],
        limit: 500,
      },
    ];

    // For addressable events, also query by address tag
    if (this.isAddressableEvent()) {
      filters.push({
        kinds: [9735],
        '#a': [this.eventAddress()],
        limit: 500,
      });
    }

    const zapReceipts: Event[] = [];
    for (const filter of filters) {
      const events = await this.accountRelay.getMany(filter);
      zapReceipts.push(...events);
    }

    // Extract sender pubkeys from zap receipts
    // The sender is in the uppercase 'P' tag (from the embedded zap request)
    const senderPubkeys: string[] = [];
    for (const receipt of zapReceipts) {
      const senderTag = receipt.tags.find(t => t[0] === 'P');
      if (senderTag && senderTag[1]) {
        senderPubkeys.push(senderTag[1]);
      }
    }

    return senderPubkeys;
  }

  async sendNewsletter(): Promise<void> {
    if (!this.canSend()) return;

    const recipientsList = this.recipients();
    const message = this.messageText().trim();

    if (recipientsList.length === 0 || !message) return;

    this.isSending.set(true);
    this.sendProgress.set(0);
    this.sentCount.set(0);
    this.failedCount.set(0);
    this.sendStatus.set('Starting...');

    const total = recipientsList.length;
    // Send one message at a time to avoid overwhelming the signing dialog
    // Each DM requires 2 signing operations (seal for recipient + seal for self)
    const DELAY_MS = 300; // Small delay between messages

    try {
      for (let i = 0; i < recipientsList.length; i++) {
        const recipient = recipientsList[i];
        this.sendStatus.set(`Sending to recipient ${i + 1} of ${total}...`);

        let success = false;
        let errorMsg: string | undefined;

        try {
          await this.messaging.sendDirectMessage(message, recipient.pubkey);
          success = true;
          this.sentCount.update(c => c + 1);
        } catch (error) {
          errorMsg = error instanceof Error ? error.message : 'Failed';
          this.failedCount.update(c => c + 1);
          this.logger.warn(`Failed to send to ${recipient.pubkey}:`, error);
        }

        // Update this recipient's status
        const updatedRecipients = [...this.recipients()];
        const idx = updatedRecipients.findIndex(r => r.pubkey === recipient.pubkey);
        if (idx !== -1) {
          updatedRecipients[idx] = {
            ...updatedRecipients[idx],
            sent: success,
            error: errorMsg,
          };
        }
        this.recipients.set(updatedRecipients);

        // Update progress
        this.sendProgress.set(Math.round(((i + 1) / total) * 100));

        // Small delay between messages (except for last one)
        if (i < recipientsList.length - 1) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
      }

      const sent = this.sentCount();
      const failed = this.failedCount();
      this.sendStatus.set(`Complete! ${sent} sent, ${failed} failed.`);

      this.snackBar.open(
        `Newsletter sent to ${sent} recipients${failed > 0 ? ` (${failed} failed)` : ''}`,
        'OK',
        { duration: 5000 }
      );
    } catch (error) {
      this.logger.error('Newsletter sending failed:', error);
      this.sendStatus.set('Error occurred during sending');
      this.snackBar.open('Failed to send newsletter', 'Dismiss', { duration: 3000 });
    } finally {
      this.isSending.set(false);
    }
  }

  getEventPreview(): string {
    const event = this.targetEvent();
    if (!event) return '';

    const content = event.content || '';
    const maxLength = 200;
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + '...';
  }

  getEventKindLabel(): string {
    const event = this.targetEvent();
    if (!event) return '';

    switch (event.kind) {
      case kinds.ShortTextNote:
        return 'Note';
      case kinds.LongFormArticle:
        return 'Article';
      default:
        return `Kind ${event.kind}`;
    }
  }
}
