import {
  Component,
  input,
  inject,
  computed,
  signal,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { nip19, Event as NostrEvent } from 'nostr-tools';
import { UtilitiesService } from '../../services/utilities.service';
import { LayoutService } from '../../services/layout.service';
import { DataService } from '../../services/data.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { UserRelayService } from '../../services/relays/user-relay';
import { ParsingService, ContentToken } from '../../services/parsing.service';
import { EmojiSetService } from '../../services/emoji-set.service';
import { LoggerService } from '../../services/logger.service';
import { ProfileDisplayNameComponent } from '../user-profile/display-name/profile-display-name.component';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { MusicEmbedComponent } from '../music-embed/music-embed.component';
import { ArticleComponent } from '../article/article.component';
import { EmojiSetMentionComponent } from '../emoji-set-mention/emoji-set-mention.component';
import { LiveEventEmbedComponent } from '../live-event-embed/live-event-embed.component';
import { NoteContentComponent } from '../content/note-content/note-content.component';
import { PhotoEventComponent } from '../event-types/photo-event.component';
import { EventHeaderComponent } from '../event/header/header.component';
import { InlineVideoPlayerComponent } from '../inline-video-player/inline-video-player.component';
import { AudioPlayerComponent } from '../audio-player/audio-player.component';
import { VideoControlsConfig } from '../video-controls/video-controls.component';
import { Bolt11InvoiceComponent } from '../bolt11-invoice/bolt11-invoice.component';
import { AgoPipe } from '../../pipes/ago.pipe';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { NostrRecord } from '../../interfaces';
import { visualContentLength } from '../../utils/visual-content-length';

// Music event kinds
const MUSIC_TRACK_KIND = 36787;
const MUSIC_PLAYLIST_KIND = 34139;
const EMOJI_SET_KIND = 30030;
const LIVE_EVENT_KIND = 30311;

interface ContentPart {
  type: 'text' | 'url' | 'image' | 'video' | 'audio' | 'npub' | 'nprofile' | 'note' | 'nevent' | 'naddr' | 'linebreak' | 'emoji' | 'bolt11';
  content: string;
  pubkey?: string;
  eventId?: string;
  encodedEvent?: string;
  customEmojiUrl?: string;
  waveform?: number[];
  duration?: number;
  naddrData?: {
    pubkey: string;
    identifier: string;
    kind: number;
    relays?: string[];
  };
  id: number;
}

interface EventMention {
  event: NostrRecord | null;
  contentTokens: ContentToken[];
  loading: boolean;
  eventId: string;
  expanded: boolean;
}

@Component({
  selector: 'app-message-content',
  imports: [
    RouterLink,
    MatIconModule,
    MatCardModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    ProfileDisplayNameComponent,
    UserProfileComponent,
    MusicEmbedComponent,
    ArticleComponent,
    EmojiSetMentionComponent,
    LiveEventEmbedComponent,
    NoteContentComponent,
    PhotoEventComponent,
    EventHeaderComponent,
    InlineVideoPlayerComponent,
    AudioPlayerComponent,
    Bolt11InvoiceComponent,
    AgoPipe,
    TimestampPipe,
  ],
  template: `
    @for (part of parsedContent(); track part.id) {
      @if (part.type === 'text') {
        <span class="text-content">{{ part.content }}</span>
      } @else if (part.type === 'emoji') {
        <img class="custom-emoji" [src]="part.customEmojiUrl" [alt]="part.content" [title]="part.content" loading="lazy" />
      } @else if (part.type === 'linebreak') {
        <br />
      } @else if (part.type === 'image') {
        <img class="message-image" [src]="part.content" alt="Image" loading="lazy" (click)="onImageClick($event, part.content)" />
      } @else if (part.type === 'video') {
        <div class="message-video-container">
          <app-inline-video-player [src]="part.content" [controlsConfig]="messageVideoControlsConfig" />
        </div>
      } @else if (part.type === 'audio') {
        <div class="message-audio-container">
          <app-audio-player [src]="part.content" [waveform]="part.waveform || []" [duration]="part.duration || 0"></app-audio-player>
        </div>
      } @else if (part.type === 'url') {
        <a class="message-link" [href]="part.content" target="_blank" rel="noopener noreferrer">{{ getDisplayUrl(part.content) }}</a>
      } @else if (part.type === 'bolt11') {
        <div class="bolt11-container">
          <app-bolt11-invoice [invoice]="part.content"></app-bolt11-invoice>
        </div>
      } @else if (part.type === 'npub' || part.type === 'nprofile') {
        <a class="nostr-mention" (click)="onProfileClick($event, part.pubkey!)">&#64;<app-profile-display-name [pubkey]="part.pubkey!" /></a>
      } @else if (part.type === 'note' || part.type === 'nevent') {
        <!-- Inline event mention (nevent/note) -->
        @let mention = getEventMention(part.id);
        @if (mention?.loading) {
          <!-- Loading placeholder for event mention -->
          <mat-card appearance="outlined" class="event-mention-card loading-card">
            <mat-card-header class="loading-header">
              <div class="skeleton-avatar"></div>
              <div class="skeleton-text-container">
                <div class="skeleton-text skeleton-name"></div>
                <div class="skeleton-text skeleton-date"></div>
              </div>
            </mat-card-header>
            <mat-card-content>
              <div class="skeleton-content">
                <div class="skeleton-text skeleton-line"></div>
                <div class="skeleton-text skeleton-line short"></div>
              </div>
            </mat-card-content>
          </mat-card>
        } @else if (mention?.event) {
          @if (mention!.event!.event.kind === 20) {
            <!-- Photo Event (kind 20, NIP-68) -->
            <div class="embedded-photo-event" (click)="onEventMentionClick($event, mention!.event!.event)">
              <app-event-header [event]="mention!.event!.event" [compact]="true"></app-event-header>
              <app-photo-event [event]="mention!.event!.event" [hideComments]="true"></app-photo-event>
            </div>
          } @else {
            <!-- Regular event mention -->
            <mat-card appearance="outlined" class="event-mention-card" tabindex="0" role="button"
              (click)="onEventMentionClick($event, mention!.event!.event)"
              (keydown.enter)="onEventMentionClick($event, mention!.event!.event)"
              (keydown.space)="onEventMentionClick($event, mention!.event!.event)">
              <mat-card-header>
                <app-user-profile [pubkey]="mention!.event!.event.pubkey" view="compact">
                  <span class="date-link" [matTooltip]="mention!.event!.event.created_at | timestamp: 'medium'"
                    matTooltipPosition="below">
                    {{ mention!.event!.event.created_at | ago }}
                  </span>
                </app-user-profile>
              </mat-card-header>
              <mat-card-content [class.collapsed]="isMentionContentLong(part.id) && !mention!.expanded">
                <div class="content-container">
                  <app-note-content [contentTokens]="mention!.contentTokens" [authorPubkey]="mention!.event!.event.pubkey"></app-note-content>
                </div>
              </mat-card-content>
              @if (isMentionContentLong(part.id)) {
                @if (!mention!.expanded) {
                  <button mat-button class="show-more-btn" (click)="toggleMentionExpand(part.id, $event)">
                    <mat-icon>expand_more</mat-icon>
                    Show more
                  </button>
                } @else {
                  <button mat-button class="show-less-btn" (click)="toggleMentionExpand(part.id, $event)">
                    <mat-icon>expand_less</mat-icon>
                    Show less
                  </button>
                }
              }
            </mat-card>
          }
        } @else {
          <!-- Event not found placeholder -->
          <mat-card appearance="outlined" class="event-mention-card not-found-card">
            <mat-card-content>
              <div class="event-not-found-placeholder">
                <mat-icon>link_off</mat-icon>
                <span class="not-found-text">Referenced event not found</span>
              </div>
            </mat-card-content>
          </mat-card>
        }
      } @else if (part.type === 'naddr' && part.naddrData) {
        @if (isMusicMention(part)) {
          <!-- Music embed (track or playlist) -->
          <app-music-embed [identifier]="part.naddrData!.identifier" [pubkey]="part.naddrData!.pubkey" 
            [kind]="part.naddrData!.kind" [relayHints]="part.naddrData!.relays"></app-music-embed>
        } @else if (isEmojiSetMention(part)) {
          <!-- Emoji set -->
          <app-emoji-set-mention [identifier]="part.naddrData!.identifier" [pubkey]="part.naddrData!.pubkey"></app-emoji-set-mention>
        } @else if (isLiveEventMention(part)) {
          <!-- Live event -->
          <app-live-event-embed [identifier]="part.naddrData!.identifier" [pubkey]="part.naddrData!.pubkey"
            [kind]="part.naddrData!.kind" [relayHints]="part.naddrData!.relays" [clickable]="true"></app-live-event-embed>
        } @else {
          <!-- Article -->
          <app-article [slug]="part.naddrData!.identifier" [pubkey]="part.naddrData!.pubkey" [kind]="part.naddrData!.kind"
            [relayHints]="part.naddrData!.relays" mode="compact" [showAuthor]="true" [showMetadata]="true"
            [clickable]="true"></app-article>
        }
      }
    }
  `,
  styles: [`
    :host {
      display: block;
      word-break: break-word;
      overflow-wrap: break-word;
    }
    
    .text-content {
      white-space: pre-wrap;
    }

    .custom-emoji {
      display: inline;
      height: 1.5em;
      vertical-align: middle;
      margin: 0 1px;
    }
    
    .message-link {
      color: var(--mat-sys-primary);
      text-decoration: none;
      word-break: break-all;
      
      &:hover {
        text-decoration: underline;
      }
    }

    .message-image {
      display: block;
      max-width: 100%;
      max-height: 300px;
      border-radius: 8px;
      margin: 4px 0;
      cursor: pointer;
      object-fit: contain;

      &:hover {
        opacity: 0.9;
      }
    }

    .message-video-container {
      display: block;
      max-width: 100%;
      border-radius: 8px;
      margin: 4px 0;
      overflow: hidden;
      --inline-video-max-height: 400px;

      app-inline-video-player {
        display: block;
      }
    }

    .bolt11-container {
      display: block;
      margin: 4px 0;
      max-width: 100%;
    }
    
    .nostr-mention {
      color: var(--mat-sys-primary);
      text-decoration: none;
      cursor: pointer;
      font-weight: 500;
      
      &:hover {
        text-decoration: underline;
      }
      
      app-profile-display-name {
        display: inline;
      }
    }
    
    .event-mention-card {
      cursor: pointer;
      transition: all 0.2s ease-in-out;
      margin: 0.5rem 0;
      
      &:hover {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }
      
      &:focus {
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: 2px;
      }
      
      // Loading state
      &.loading-card {
        cursor: default;
        
        &:hover {
          box-shadow: none;
        }
        
        .loading-header {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px 0;
        }
      }
      
      // Not found state
      &.not-found-card {
        cursor: default;
        
        &:hover {
          box-shadow: none;
        }
      }
      
      // Collapsed state for long content
      mat-card-content.collapsed {
        max-height: 200px;
        overflow: hidden;
        position: relative;
        
        &::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 3em;
          background: linear-gradient(to bottom, transparent, var(--mat-sys-surface-container));
          pointer-events: none;
        }
      }
      
      // Show more/less buttons - use on-surface color for readability in both modes
      .show-more-btn,
      .show-less-btn {
        width: 100%;
        margin-top: 4px;
        color: var(--mat-sys-on-surface);
        justify-content: center;
        
        mat-icon {
          margin-right: 4px;
          color: var(--mat-sys-on-surface);
        }
        
        &:hover {
          background-color: var(--mat-sys-surface-container-highest);
        }
      }
    }
    
    .date-link {
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
      margin-left: 8px;
    }
    
    // Embedded photo event styling
    .embedded-photo-event {
      margin: 0.5rem 0;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 10px;
      overflow: hidden;
      background: var(--mat-sys-surface-container-low);
      cursor: pointer;
      
      &:hover {
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }
      
      app-event-header {
        display: block;
        padding: 10px 12px 0;
      }
      
      app-photo-event {
        display: block;
        
        ::ng-deep .photo-carousel-container {
          margin: 0.5rem 0 0 0;
          max-width: 100%;
        }
        
        ::ng-deep .media-title {
          display: none;
        }
      }
    }
    
    // Skeleton loading styles
    @keyframes skeletonShimmer {
      0% {
        background-position: -200% 0;
      }
      100% {
        background-position: 200% 0;
      }
    }
    
    .skeleton-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: linear-gradient(90deg,
        var(--mat-sys-surface-container-high) 0%,
        var(--mat-sys-surface-container-highest) 50%,
        var(--mat-sys-surface-container-high) 100%);
      background-size: 200% 100%;
      animation: skeletonShimmer 1.5s ease-in-out infinite;
    }
    
    .skeleton-text-container {
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex: 1;
    }
    
    .skeleton-text {
      height: 12px;
      border-radius: 6px;
      background: linear-gradient(90deg,
        var(--mat-sys-surface-container-high) 0%,
        var(--mat-sys-surface-container-highest) 50%,
        var(--mat-sys-surface-container-high) 100%);
      background-size: 200% 100%;
      animation: skeletonShimmer 1.5s ease-in-out infinite;
      
      &.skeleton-name {
        width: 120px;
        height: 14px;
      }
      
      &.skeleton-date {
        width: 80px;
        height: 10px;
      }
      
      &.skeleton-line {
        width: 100%;
        height: 14px;
        
        &.short {
          width: 60%;
        }
      }
    }
    
    .skeleton-content {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 0;
    }
    
    .event-not-found-placeholder {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 0;
      color: var(--mat-sys-on-surface-variant);
      
      mat-icon {
        color: var(--mat-sys-outline);
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
      
      .not-found-text {
        font-size: 0.875rem;
      }
    }
    
    .content-container {
      padding-top: 8px;
    }
    
    // Music embed needs some margin adjustments in message context
    app-music-embed {
      display: block;
      margin: 0.5rem 0;
    }
    
    app-article {
      display: block;
      margin: 0.5rem 0;
    }
    
    app-emoji-set-mention {
      display: block;
      margin: 0.5rem 0;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageContentComponent {
  private utilities = inject(UtilitiesService);
  private layout = inject(LayoutService);
  private data = inject(DataService);
  private relayPool = inject(RelayPoolService);
  private userRelayService = inject(UserRelayService);
  private parsing = inject(ParsingService);
  private readonly logger = inject(LoggerService);
  private readonly dialog = inject(MatDialog);
  private readonly emojiSetService = inject(EmojiSetService);

  content = input.required<string>();
  tags = input<string[][]>([]);
  authorPubkey = input<string>();

  readonly messageVideoControlsConfig: VideoControlsConfig = {
    showVolumeControl: true,
    showVolumeSlider: false,
    showTimeDisplay: false,
    showPlaybackRate: false,
    showQuality: false,
    showPiP: false,
    showCast: false,
  };

  // Content length threshold for showing "Show more" button
  private readonly CONTENT_LENGTH_THRESHOLD = 300;

  // Regex to match nostr URIs and bare NIP-19 identifiers
  private readonly nostrUriRegex = /((?:nostr:)?(?:npub|nprofile|note|nevent|naddr)1(?:(?!(?:npub|nprofile|note|nevent|naddr)1)[a-zA-Z0-9])+)/g;
  // Regex to match URLs
  private readonly urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g;

  // Image extensions for URL detection
  private readonly imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|avif)(\?.*)?$/i;
  // Video extensions for URL detection
  private readonly videoExtensions = /\.(mp4|webm|mov)(\?.*)?$/i;
  // Audio extensions for URL detection
  private readonly audioExtensions = /\.(mp3|mpga|mp2|wav|ogg|oga|opus|m4a|aac|flac|weba)(\?.*)?$/i;
  // Known image hosting patterns (e.g., giphy)
  private readonly imageHostPatterns = [
    /\.giphy\.com\/.+/i,
    /image\.nostr\.build\/.+/i,
    /nostr\.build\/i\/.+/i,
    /void\.cat\/.+\.(jpg|jpeg|png|gif|webp|avif)/i,
    /imgproxy\..+/i,
  ];

  // NIP-30 emoji shortcode regex
  private readonly emojiRegex = /(:[a-zA-Z0-9_]+:)/g;

  // Store event mentions data
  eventMentionsMap = signal<Map<number, EventMention>>(new Map());

  // Resolved custom emoji map (built from tags + author emoji sets)
  private resolvedEmojiMap = signal<Map<string, string>>(new Map());

  // Track last processed content to prevent redundant re-execution
  private lastProcessedContent = '';
  private partIdCounter = 0;

  constructor() {
    // Effect to load event previews when content changes
    effect(() => {
      const content = this.content();
      if (content !== this.lastProcessedContent) {
        this.lastProcessedContent = content;
        this.loadEventPreviews();
      }
    });

    // Effect to resolve custom emoji URLs from tags and author emoji sets
    effect(() => {
      const tags = this.tags();
      const content = this.content();
      const authorPubkey = this.authorPubkey();

      // Build emoji map from event tags (NIP-30)
      const emojiMap = new Map<string, string>();
      for (const tag of tags) {
        if (tag[0] === 'emoji' && tag[1] && tag[2]) {
          emojiMap.set(`:${tag[1]}:`, tag[2]);
        }
      }

      // Check for unresolved shortcodes that need author emoji sets
      const unresolvedRegex = /(:[a-zA-Z0-9_]+:)/g;
      let hasUnresolved = false;
      let m: RegExpExecArray | null;
      while ((m = unresolvedRegex.exec(content)) !== null) {
        if (!emojiMap.has(m[0])) {
          hasUnresolved = true;
          break;
        }
      }

      if (hasUnresolved && authorPubkey) {
        this.emojiSetService.getUserEmojiSets(authorPubkey).then(authorEmojis => {
          for (const [shortcode, url] of authorEmojis) {
            const key = `:${shortcode}:`;
            if (!emojiMap.has(key)) {
              emojiMap.set(key, url);
            }
          }
          this.resolvedEmojiMap.set(emojiMap);
        }).catch(() => {
          this.resolvedEmojiMap.set(emojiMap);
        });
      } else {
        this.resolvedEmojiMap.set(emojiMap);
      }
    });
  }

  parsedContent = computed<ContentPart[]>(() => {
    const text = this.content();
    if (!text) return [];

    // Reset part ID counter for each parse
    this.partIdCounter = 0;

    const parts: ContentPart[] = [];

    // Split by nostr URIs, URLs, and BOLT-11 invoices
    const combinedRegex = /((?:nostr:)?(?:npub|nprofile|note|nevent|naddr)1(?:(?!(?:npub|nprofile|note|nevent|naddr)1)[a-zA-Z0-9])+)|(https?:\/\/[^\s<>"{}|\\^`\[\]]+)|((?:lnbc|lntb|lnbcrt)[a-z0-9]+)/gi;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = combinedRegex.exec(text)) !== null) {
      // Add text before this match (may contain linebreaks)
      if (match.index > lastIndex) {
        const textBefore = text.substring(lastIndex, match.index);
        this.addTextWithLinebreaks(parts, textBefore);
      }

      const fullMatch = match[0];

      if (match[1]) {
        // It's a nostr URI
        const parsed = this.parseNostrUri(fullMatch);
        if (parsed) {
          parts.push(parsed);
        } else {
          // If parsing failed, treat as text
          parts.push({
            type: 'text',
            content: fullMatch,
            id: this.partIdCounter++,
          });
        }
      } else if (match[2]) {
        // It's a URL
        // Clean up any trailing punctuation
        let cleanUrl = fullMatch;
        const trailingPunctuation = /[.,;:!?)]+$/;
        const trailing = cleanUrl.match(trailingPunctuation);
        if (trailing) {
          cleanUrl = cleanUrl.slice(0, -trailing[0].length);
          // We need to adjust lastIndex to not include the trailing punctuation
          // so it becomes part of the next text segment
        }

        parts.push({
          type: this.getUrlMediaType(cleanUrl),
          content: cleanUrl,
          ...this.getImetaData(cleanUrl),
          id: this.partIdCounter++,
        });

        // If there was trailing punctuation, add it back (will be handled by next iteration or final text)
        if (trailing) {
          // Adjust the match to exclude trailing punctuation
          lastIndex = match.index + cleanUrl.length;
          continue;
        }
      } else if (match[3]) {
        // It's a BOLT-11 invoice
        parts.push({
          type: 'bolt11',
          content: fullMatch.toLowerCase(),
          id: this.partIdCounter++,
        });
      }

      lastIndex = match.index + fullMatch.length;
    }

    // Add remaining text (may contain linebreaks)
    if (lastIndex < text.length) {
      const remainingText = text.substring(lastIndex);
      this.addTextWithLinebreaks(parts, remainingText);
    }

    return parts;
  });

  private addTextWithLinebreaks(parts: ContentPart[], text: string): void {
    // Split by linebreaks and add parts
    const segments = text.split(/\r?\n/);
    for (let i = 0; i < segments.length; i++) {
      if (segments[i]) {
        this.addTextWithEmojis(parts, segments[i]);
      }
      // Add linebreak between segments (but not after the last one)
      if (i < segments.length - 1) {
        parts.push({
          type: 'linebreak',
          content: '\n',
          id: this.partIdCounter++,
        });
      }
    }
  }

  private addTextWithEmojis(parts: ContentPart[], text: string): void {
    const emojiMap = this.resolvedEmojiMap();
    if (emojiMap.size === 0) {
      parts.push({ type: 'text', content: text, id: this.partIdCounter++ });
      return;
    }

    const emojiRegex = /(:[a-zA-Z0-9_]+:)/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;

    while ((m = emojiRegex.exec(text)) !== null) {
      const url = emojiMap.get(m[0]);
      if (!url) continue;

      if (m.index > lastIdx) {
        parts.push({ type: 'text', content: text.substring(lastIdx, m.index), id: this.partIdCounter++ });
      }
      parts.push({ type: 'emoji', content: m[0], customEmojiUrl: url, id: this.partIdCounter++ });
      lastIdx = m.index + m[0].length;
    }

    if (lastIdx < text.length) {
      parts.push({ type: 'text', content: text.substring(lastIdx), id: this.partIdCounter++ });
    }
  }

  private parseNostrUri(uri: string): ContentPart | null {
    try {
      const decoded = nip19.decode(uri.replace('nostr:', ''));

      switch (decoded.type) {
        case 'npub':
          return {
            type: 'npub',
            content: uri,
            pubkey: decoded.data as string,
            id: this.partIdCounter++,
          };
        case 'nprofile':
          return {
            type: 'nprofile',
            content: uri,
            pubkey: (decoded.data as nip19.ProfilePointer).pubkey,
            id: this.partIdCounter++,
          };
        case 'note':
          return {
            type: 'note',
            content: uri,
            eventId: decoded.data as string,
            id: this.partIdCounter++,
          };
        case 'nevent':
          return {
            type: 'nevent',
            content: uri,
            eventId: (decoded.data as nip19.EventPointer).id,
            encodedEvent: uri.replace('nostr:', ''),
            id: this.partIdCounter++,
          };
        case 'naddr': {
          const addrData = decoded.data as nip19.AddressPointer;
          return {
            type: 'naddr',
            content: uri,
            encodedEvent: uri.replace('nostr:', ''),
            naddrData: {
              pubkey: addrData.pubkey,
              identifier: addrData.identifier,
              kind: addrData.kind,
              relays: addrData.relays,
            },
            id: this.partIdCounter++,
          };
        }
        default:
          return null;
      }
    } catch (error) {
      this.logger.warn('Failed to parse nostr URI:', uri, error);
      return null;
    }
  }

  private async loadEventPreviews(): Promise<void> {
    const parts = this.parsedContent();
    const eventMentionsMap = new Map<number, EventMention>();

    // First, mark all event mentions as loading
    for (const part of parts) {
      if (part.type === 'note' || part.type === 'nevent') {
        eventMentionsMap.set(part.id, {
          event: null,
          contentTokens: [],
          loading: true,
          eventId: part.eventId!,
          expanded: false,
        });
      }
    }

    // Update state with loading indicators
    this.eventMentionsMap.set(new Map(eventMentionsMap));

    // Now fetch the events
    for (const part of parts) {
      if ((part.type === 'note' || part.type === 'nevent') && part.eventId) {
        try {
          let eventData: NostrRecord | null = null;

          // Try to get event by ID
          eventData = await this.data.getEventById(part.eventId, { save: true });

          // If not found and we have relay hints from nevent, try those
          if (!eventData && part.encodedEvent) {
            try {
              const decoded = nip19.decode(part.encodedEvent);
              if (decoded.type === 'nevent') {
                const eventPointer = decoded.data as nip19.EventPointer;
                if (eventPointer.relays && eventPointer.relays.length > 0) {
                  const relayEvent = await this.relayPool.getEventById(
                    eventPointer.relays,
                    part.eventId,
                    10000
                  );
                  if (relayEvent) {
                    eventData = this.data.toRecord(relayEvent);
                  }
                }

                // Try author's relays as fallback
                if (!eventData && eventPointer.author) {
                  try {
                    const authorEvent = await this.userRelayService.getEventById(
                      eventPointer.author,
                      part.eventId
                    );
                    if (authorEvent) {
                      eventData = this.data.toRecord(authorEvent);
                    }
                  } catch {
                    // Ignore errors from author relay fetch
                  }
                }
              }
            } catch {
              // Ignore decode errors
            }
          }

          if (eventData) {
            // Parse content tokens for the nested event
            const parseResult = await this.parsing.parseContent(
              eventData.data,
              eventData.event.tags,
              eventData.event.pubkey
            );

            eventMentionsMap.set(part.id, {
              event: eventData,
              contentTokens: parseResult.tokens,
              loading: false,
              eventId: part.eventId,
              expanded: false,
            });
          } else {
            eventMentionsMap.set(part.id, {
              event: null,
              contentTokens: [],
              loading: false,
              eventId: part.eventId,
              expanded: false,
            });
          }
        } catch (error) {
          this.logger.error('Error loading event:', error);
          eventMentionsMap.set(part.id, {
            event: null,
            contentTokens: [],
            loading: false,
            eventId: part.eventId!,
            expanded: false,
          });
        }

        // Update state after each event
        this.eventMentionsMap.set(new Map(eventMentionsMap));
      }
    }
  }

  getEventMention(partId: number): EventMention | undefined {
    return this.eventMentionsMap().get(partId);
  }

  isMentionContentLong(partId: number): boolean {
    const mention = this.eventMentionsMap().get(partId);
    if (!mention?.event) return false;
    // Only apply to text notes (kind 1)
    if (mention.event.event.kind !== 1) return false;
    const content = mention.event.event.content || '';
    // Use visual length to account for nostr: references rendering as short display names
    return visualContentLength(content) > this.CONTENT_LENGTH_THRESHOLD;
  }

  toggleMentionExpand(partId: number, event: Event): void {
    event.stopPropagation();
    this.eventMentionsMap.update(map => {
      const newMap = new Map(map);
      const mention = newMap.get(partId);
      if (mention) {
        newMap.set(partId, { ...mention, expanded: !mention.expanded });
      }
      return newMap;
    });
  }

  isMusicMention(part: ContentPart): boolean {
    if (!part.naddrData) return false;
    return part.naddrData.kind === MUSIC_TRACK_KIND || part.naddrData.kind === MUSIC_PLAYLIST_KIND;
  }

  isEmojiSetMention(part: ContentPart): boolean {
    if (!part.naddrData) return false;
    return part.naddrData.kind === EMOJI_SET_KIND;
  }

  isLiveEventMention(part: ContentPart): boolean {
    if (!part.naddrData) return false;
    return part.naddrData.kind === LIVE_EVENT_KIND;
  }

  getDisplayUrl(url: string, maxLength = 50): string {
    if (url.length <= maxLength) return url;

    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      const path = urlObj.pathname + urlObj.search;

      if (domain.length + 10 >= maxLength) {
        return domain.slice(0, maxLength - 3) + '...';
      }

      const availablePathLength = maxLength - domain.length - 3;
      if (path.length > availablePathLength) {
        return domain + path.slice(0, availablePathLength) + '...';
      }

      return domain + path;
    } catch {
      return url.slice(0, maxLength - 3) + '...';
    }
  }

  onProfileClick(event: MouseEvent, pubkey: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.layout.openProfile(pubkey);
  }

  onEventMentionClick(event: Event, nostrEvent: NostrEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.layout.openEvent(nostrEvent.id, nostrEvent);
  }

  onImageClick(event: MouseEvent, url: string): void {
    event.preventDefault();
    event.stopPropagation();
    import('../media-preview-dialog/media-preview.component').then(({ MediaPreviewDialogComponent }) => {
      this.dialog.open(MediaPreviewDialogComponent, {
        data: {
          mediaUrl: url,
          mediaType: 'image',
        },
        maxWidth: '100vw',
        maxHeight: '100vh',
        width: '100vw',
        height: '100vh',
        panelClass: 'image-dialog-panel',
      });
    });
  }

  /**
   * Determine if a URL points to an image, video, or is a regular link.
   */
  private getUrlMediaType(url: string): 'image' | 'video' | 'audio' | 'url' {
    if (this.imageExtensions.test(url)) {
      return 'image';
    }
    if (this.audioExtensions.test(url)) {
      return 'audio';
    }
    if (this.videoExtensions.test(url)) {
      return 'video';
    }
    // Check known image hosting patterns
    for (const pattern of this.imageHostPatterns) {
      if (pattern.test(url)) {
        return 'image';
      }
    }
    return 'url';
  }

  /** Look up imeta tag for a URL to extract waveform/duration metadata */
  private getImetaData(url: string): { waveform?: number[]; duration?: number } {
    const tags = this.tags();
    if (!tags?.length) return {};
    const imeta = tags.find(t => t[0] === 'imeta' && t.some(v => v === `url ${url}`));
    if (!imeta) return {};
    const result: { waveform?: number[]; duration?: number } = {};
    const waveformTag = imeta.find(v => v.startsWith('waveform '));
    if (waveformTag) {
      result.waveform = waveformTag.substring(9).split(' ').map(Number);
    }
    const durationTag = imeta.find(v => v.startsWith('duration '));
    if (durationTag) {
      result.duration = Number(durationTag.substring(9));
    }
    return result;
  }
}
