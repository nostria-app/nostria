import { ChangeDetectionStrategy, Component, inject, input, signal, effect, computed, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { nip19, Event as NostrEvent } from 'nostr-tools';
import { DataService } from '../../services/data.service';
import { NostrRecord } from '../../interfaces';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { LoggerService } from '../../services/logger.service';
import { ChannelMetadata, CHANNEL_CREATE_KIND, CHANNEL_METADATA_KIND, CHANNEL_MESSAGE_KIND } from '../../services/chat-channels.service';
import { AgoPipe } from '../../pipes/ago.pipe';
import { UtilitiesService } from '../../services/utilities.service';

/**
 * Embeds a preview of a NIP-28 public chat channel or channel message.
 *
 * Handles:
 * - Kind 40 (channel creation): Shows channel name, description, picture, and creator
 * - Kind 41 (channel metadata): Shows the latest shared channel metadata and links to the channel
 * - Kind 42 (channel message): Shows the message content with author, in context of the channel
 *
 * The channel event content is JSON: { name, about, picture, relays }
 * The channel message content is plain text (same as kind 1).
 */
@Component({
  selector: 'app-channel-embed',
  imports: [
    MatIconModule,
    MatButtonModule,
    UserProfileComponent,
    AgoPipe,
  ],
  templateUrl: './channel-embed.component.html',
  styleUrl: './channel-embed.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChannelEmbedComponent {
  /** The event to embed - kind 40, 41, or 42 */
  event = input.required<NostrEvent>();

  // Services
  private router = inject(Router);
  private data = inject(DataService);
  private relayPool = inject(RelayPoolService);
  private logger = inject(LoggerService);
  private utilities = inject(UtilitiesService);

  // State for kind 42 messages - we need to fetch the channel metadata
  channelMetadata = signal<ChannelMetadata | null>(null);
  channelLoading = signal(false);

  constructor() {
    effect(() => {
      const ev = this.event();
      if (ev) {
        untracked(() => {
          if (ev.kind === CHANNEL_MESSAGE_KIND) {
            this.loadChannelForMessage(ev);
          }
        });
      }
    });
  }

  /** Whether this is a channel creation event (kind 40) */
  isChannelCreate = computed(() => this.event().kind === CHANNEL_CREATE_KIND);

  /** Whether this is a channel metadata update event (kind 41) */
  isChannelMetadata = computed(() => this.event().kind === CHANNEL_METADATA_KIND);

  /** Whether this is a channel info event (kind 40 or 41) */
  isChannelInfo = computed(() => this.event().kind === CHANNEL_CREATE_KIND || this.event().kind === CHANNEL_METADATA_KIND);

  /** Whether this is a channel message event (kind 42) */
  isChannelMessage = computed(() => this.event().kind === CHANNEL_MESSAGE_KIND);

  /** Parsed channel metadata from a kind 40/41 event's JSON content */
  parsedMetadata = computed<ChannelMetadata | null>(() => {
    const ev = this.event();
    if (ev.kind !== CHANNEL_CREATE_KIND && ev.kind !== CHANNEL_METADATA_KIND) return null;

    try {
      const parsed = JSON.parse(ev.content) as Partial<ChannelMetadata>;
      return {
        name: parsed.name || 'Unnamed Channel',
        about: parsed.about || '',
        picture: parsed.picture || '',
        relays: parsed.relays || [],
      };
    } catch {
      return {
        name: 'Unnamed Channel',
        about: '',
        picture: '',
        relays: [],
      };
    }
  });

  /** The channel name to display */
  channelName = computed(() => {
    if (this.isChannelInfo()) {
      return this.parsedMetadata()?.name || 'Unnamed Channel';
    }
    return this.channelMetadata()?.name || 'Chat Channel';
  });

  /** The channel description */
  channelAbout = computed(() => {
    if (this.isChannelInfo()) {
      return this.parsedMetadata()?.about || '';
    }
    return this.channelMetadata()?.about || '';
  });

  /** The channel picture URL */
  channelPicture = computed(() => {
    if (this.isChannelInfo()) {
      return this.parsedMetadata()?.picture || '';
    }
    return this.channelMetadata()?.picture || '';
  });

  /** The pubkey of the event author */
  authorPubkey = computed(() => this.event().pubkey);

  messageContent = computed(() => this.utilities.normalizeRenderedEventContent(this.event().content || ''));

  /** The channel ID for navigation */
  channelId = computed(() => {
    const ev = this.event();
    if (ev.kind === CHANNEL_CREATE_KIND) {
      return ev.id;
    }

    // For kind 41 metadata updates and kind 42 messages, extract channel ID from the root e tag.
    const rootTag = ev.tags.find(
      (t: string[]) => t[0] === 'e' && (t[3] === 'root' || (!t[3] && t === ev.tags.find((tag: string[]) => tag[0] === 'e')))
    );
    return rootTag?.[1] || ev.id;
  });

  /**
   * For kind 42 messages, load the channel metadata from the kind 40 event
   */
  private async loadChannelForMessage(messageEvent: NostrEvent): Promise<void> {
    const rootTag = messageEvent.tags.find(
      (t: string[]) => t[0] === 'e' && (t[3] === 'root' || (!t[3] && t === messageEvent.tags.find((tag: string[]) => tag[0] === 'e')))
    );

    if (!rootTag?.[1]) return;

    const channelEventId = rootTag[1];
    const relayHint = rootTag[2] || undefined;

    this.channelLoading.set(true);

    try {
      let channelRecord: NostrRecord | null = null;

      // Try relay hint first
      if (relayHint) {
        try {
          const relayEvent = await this.relayPool.getEventById([relayHint], channelEventId, 8000);
          if (relayEvent) {
            channelRecord = this.data.toRecord(relayEvent);
          }
        } catch {
          // Relay hint failed, continue
        }
      }

      // Fall back to regular fetch
      if (!channelRecord) {
        channelRecord = await this.data.getEventById(channelEventId, { save: true });
      }

      if (channelRecord && channelRecord.event.kind === CHANNEL_CREATE_KIND) {
        try {
          const metadata = JSON.parse(channelRecord.event.content) as Partial<ChannelMetadata>;
          this.channelMetadata.set({
            name: metadata.name || 'Unnamed Channel',
            about: metadata.about || '',
            picture: metadata.picture || '',
            relays: metadata.relays || [],
          });
        } catch {
          this.logger.warn('[ChannelEmbed] Failed to parse channel metadata');
        }
      }
    } catch (error) {
      this.logger.error('[ChannelEmbed] Failed to load channel for message:', error);
    } finally {
      this.channelLoading.set(false);
    }
  }

  /** Navigate to the chat channel */
  openChannel(clickEvent?: Event): void {
    clickEvent?.stopPropagation();

    const nevent = nip19.neventEncode({
      id: this.channelId(),
      author: this.event().pubkey,
      kind: CHANNEL_CREATE_KIND,
    });

    this.router.navigate(['/chats', nevent]);
  }

  /** Handle channel picture load error */
  onPictureError = signal(false);

  onPictureLoadError(): void {
    this.onPictureError.set(true);
  }
}
