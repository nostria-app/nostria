import {
  Component,
  input,
  inject,
  computed,
  signal,
  effect,
  ChangeDetectionStrategy,
  OnDestroy,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { nip19, Event as NostrEvent } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';
import { UtilitiesService } from '../../services/utilities.service';
import { LayoutService } from '../../services/layout.service';
import { ParsingService, ContentToken } from '../../services/parsing.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { EmojiSetService } from '../../services/emoji-set.service';
import { LoggerService } from '../../services/logger.service';
import { CorsProxyService } from '../../services/cors-proxy.service';
import { ReferencedEventService } from '../../services/referenced-event.service';
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
import { SafeResourceUrl } from '@angular/platform-browser';
import { PLATFORM_ID } from '@angular/core';
import { visualContentLength } from '../../utils/visual-content-length';
import { ChannelEmbedComponent } from '../channel-embed/channel-embed.component';

// Music event kinds
const MUSIC_TRACK_KIND = 36787;
const MUSIC_PLAYLIST_KIND = 34139;
const EMOJI_SET_KIND = 30030;
const LIVE_EVENT_KIND = 30311;

interface ContentPart {
  type: 'text' | 'url' | 'image' | 'video' | 'audio' | 'npub' | 'nprofile' | 'note' | 'nevent' | 'naddr' | 'linebreak' | 'emoji' | 'bolt11' | 'tidal' | 'spotify' | 'youtube' | 'encrypted-file';
  content: string;
  pubkey?: string;
  eventId?: string;
  encodedEvent?: string;
  customEmojiUrl?: string;
  waveform?: number[];
  duration?: number;
  processedUrl?: SafeResourceUrl;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  decrypting?: boolean;
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

interface EncryptedFileMetadata {
  content: string;
  fileName?: string;
  fileType: string;
  fileSize?: number;
}

interface DecryptedPreviewState {
  objectUrl: string;
  mediaType: 'image' | 'video';
}

@Component({
  selector: 'app-message-content',
  imports: [
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
    ChannelEmbedComponent,
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
      } @else if (part.type === 'encrypted-file') {
        <button type="button" class="encrypted-file-card" (click)="decryptEncryptedFile(part)">
          <div class="encrypted-file-card-main">
            <mat-icon>lock</mat-icon>
            <div class="encrypted-file-copy">
              <span class="encrypted-file-title">{{ part.fileName || 'Encrypted file' }}</span>
              <span class="encrypted-file-meta">{{ getEncryptedFileMeta(part) }}</span>
            </div>
          </div>
          <div class="encrypted-file-action">
            @if (part.decrypting) {
            <mat-spinner diameter="18"></mat-spinner>
            } @else {
            <mat-icon>download</mat-icon>
            }
          </div>
        </button>
      } @else if (part.type === 'tidal') {
        <div class="tidal-container">
          @if (part.processedUrl) {
          <iframe [src]="part.processedUrl" frameborder="0"
            allow="encrypted-media; clipboard-write" title="Tidal music embed"
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
            loading="lazy"></iframe>
          }
        </div>
      } @else if (part.type === 'spotify') {
        <div class="spotify-container">
          @if (part.processedUrl) {
          <iframe [src]="part.processedUrl" frameborder="0"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy" title="Spotify music embed"></iframe>
          }
        </div>
      } @else if (part.type === 'youtube') {
        <div class="youtube-container">
          @if (part.processedUrl) {
          <iframe [src]="part.processedUrl" frameborder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerpolicy="strict-origin-when-cross-origin" allowfullscreen loading="lazy"
            title="YouTube video embed"></iframe>
          }
        </div>
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
          } @else if (mention!.event!.event.kind === 40 || mention!.event!.event.kind === 41 || mention!.event!.event.kind === 42) {
            <!-- Public chat event (kind 40/41/42, NIP-28) -->
            <div class="embedded-channel-event">
              <app-channel-embed [event]="mention!.event!.event"></app-channel-embed>
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

    .tidal-container {
      display: block;
      width: 100%;
      max-width: 100%;
      border-radius: 8px;
      overflow: hidden;
      background: #000;
      margin: 4px 0;

      iframe {
        display: block;
        width: 100%;
        height: 130px;
        border: 0;
      }

      @media (max-width: 480px) {
        iframe {
          height: 130px;
        }
      }
    }

    .spotify-container {
      display: block;
      width: 100%;
      max-width: 100%;
      border-radius: 8px;
      overflow: hidden;
      background: #121212;
      margin: 4px 0;

      iframe {
        display: block;
        width: 100%;
        height: 152px;
        border: 0;
      }

      @media (max-width: 480px) {
        iframe {
          height: 152px;
        }
      }
    }

    .youtube-container {
      display: block;
      width: 100%;
      max-width: min(100%, 560px);
      margin: 8px 0;
      border-radius: 12px;
      overflow: hidden;
      background: #000;
      aspect-ratio: 16 / 9;

      iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
      }
    }

    .encrypted-file-card {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin: 4px 0;
      padding: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
      color: inherit;
      text-align: left;
      cursor: pointer;

      &:hover {
        background: var(--mat-sys-surface-container);
      }
    }

    .encrypted-file-card-main {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .encrypted-file-copy {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .encrypted-file-title,
    .encrypted-file-meta {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .encrypted-file-title {
      color: var(--mat-sys-on-surface);
    }

    .encrypted-file-meta {
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .encrypted-file-action {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageContentComponent implements OnDestroy {
  private utilities = inject(UtilitiesService);
  private layout = inject(LayoutService);
  private referencedEventService = inject(ReferencedEventService);
  private parsing = inject(ParsingService);
  private readonly logger = inject(LoggerService);
  private readonly dialog = inject(MatDialog);
  private readonly emojiSetService = inject(EmojiSetService);
  private readonly media = inject(MediaPlayerService);
  private readonly corsProxy = inject(CorsProxyService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

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

  // Tidal URL regex
  private readonly tidalUrlRegex = /^https?:\/\/(?:listen\.)?tidal\.com\/(?:browse\/)?(track|album|video|playlist)\/([a-zA-Z0-9-]+)/i;
  // Spotify URL regex
  private readonly spotifyUrlRegex = /^https?:\/\/open\.spotify\.com\/(track|album|playlist|artist|show|episode)\/([a-zA-Z0-9]+)/i;
  // YouTube URL regex
  private readonly youtubeUrlRegex = /^https?:\/\/(?:(?:www|m|music)\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[?&][^\s]*)?$/i;

  // Store event mentions data
  eventMentionsMap = signal<Map<number, EventMention>>(new Map());
  encryptedFileStates = signal<Map<string, boolean>>(new Map());
  decryptedEncryptedFilePreviews = signal<Map<string, DecryptedPreviewState>>(new Map());
  autoDecryptAttempts = signal<Set<string>>(new Set());

  // Resolved custom emoji map (built from tags + author emoji sets)
  private resolvedEmojiMap = signal<Map<string, string>>(new Map());

  // Track last processed content to prevent redundant re-execution
  private lastProcessedContent = '';
  private partIdCounter = 0;

  private normalizedContent = computed(() =>
    this.utilities.normalizeRenderedEventContent(this.content() || '')
  );

  constructor() {
    // Effect to load event previews when content changes
    effect(() => {
      const content = this.normalizedContent();
      if (content !== this.lastProcessedContent) {
        this.lastProcessedContent = content;
        this.loadEventPreviews();
      }
    });

    // Effect to resolve custom emoji URLs from tags and author emoji sets
    effect(() => {
      const tags = this.tags();
      const content = this.normalizedContent();
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

    effect(() => {
      if (!this.isBrowser) {
        return;
      }

      const content = this.normalizedContent();
      const metadata = this.getEncryptedFileMetadata(content);
      if (!metadata || !this.isPreviewableEncryptedFileType(metadata.fileType)) {
        return;
      }

      const previewState = this.decryptedEncryptedFilePreviews().get(metadata.content);
      const decrypting = this.encryptedFileStates().get(metadata.content);
      const attempted = this.autoDecryptAttempts().has(metadata.content);
      if (previewState || decrypting || attempted) {
        return;
      }

      this.autoDecryptAttempts.update(current => {
        const next = new Set(current);
        next.add(metadata.content);
        return next;
      });

      void this.decryptEncryptedFilePreview(metadata);
    });
  }

  ngOnDestroy(): void {
    for (const preview of this.decryptedEncryptedFilePreviews().values()) {
      URL.revokeObjectURL(preview.objectUrl);
    }
  }

  parsedContent = computed<ContentPart[]>(() => {
    const text = this.normalizedContent();
    if (!text) return [];

    const encryptedFilePart = this.buildEncryptedFilePart(text);
    if (encryptedFilePart) {
      return [encryptedFilePart];
    }

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
          ...this.getMusicEmbedData(cleanUrl),
          ...this.getYouTubeEmbedData(cleanUrl),
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

    await Promise.all(parts.map(async (part) => {
      if ((part.type !== 'note' && part.type !== 'nevent') || !part.eventId) {
        return;
      }

      try {
        let relayHints: string[] | undefined;
        let authorPubkey: string | undefined;

        if (part.type === 'nevent' && part.encodedEvent) {
          try {
            const decoded = nip19.decode(part.encodedEvent);
            if (decoded.type === 'nevent') {
              const eventPointer = decoded.data as nip19.EventPointer;
              relayHints = eventPointer.relays;
              authorPubkey = eventPointer.author;
            }
          } catch {
            // Ignore decode errors and continue with regular lookup.
          }
        }

        const eventData = await this.referencedEventService.getReferencedEvent(part.eventId, {
          relayHints,
          authorPubkey,
        });

        if (eventData) {
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

      this.eventMentionsMap.set(new Map(eventMentionsMap));
    }));
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

  async decryptEncryptedFile(part: ContentPart): Promise<void> {
    if (part.type !== 'encrypted-file' || part.decrypting) {
      return;
    }

    try {
      const metadata = this.getEncryptedFileMetadata(part.content);
      if (!metadata) {
        throw new Error('Missing decryption metadata');
      }

      if (this.isPreviewableEncryptedFileType(metadata.fileType)) {
        await this.decryptEncryptedFilePreview(metadata);
        return;
      }

      const blob = await this.decryptEncryptedFileBlob(metadata);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = metadata.fileName || 'encrypted-file';
      anchor.rel = 'noopener';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) {
      this.logger.error('Failed to decrypt encrypted file', error);
      this.layout.toast(error instanceof Error ? error.message : 'Failed to decrypt encrypted file', 4000, 'error-snackbar');
    } finally {
      this.setEncryptedFileDecrypting(part.content, false);
    }
  }

  /**
   * Determine if a URL points to an image, video, or is a regular link.
   */
  private getUrlMediaType(url: string): 'image' | 'video' | 'audio' | 'url' | 'tidal' | 'spotify' | 'youtube' {
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
    // Check for Tidal URLs
    if (this.tidalUrlRegex.test(url)) {
      this.tidalUrlRegex.lastIndex = 0;
      return 'tidal';
    }
    if (this.spotifyUrlRegex.test(url)) {
      this.spotifyUrlRegex.lastIndex = 0;
      return 'spotify';
    }
    if (this.youtubeUrlRegex.test(url)) {
      this.youtubeUrlRegex.lastIndex = 0;
      return 'youtube';
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

  /** Build music embed data for supported providers */
  private getMusicEmbedData(url: string): { processedUrl?: SafeResourceUrl } {
    this.tidalUrlRegex.lastIndex = 0;
    const match = this.tidalUrlRegex.exec(url);
    if (match) {
      const resourceType = match[1];
      const resourceId = match[2];
      const embedPath = `${resourceType}s`;
      return {
        processedUrl: this.media.getTidalEmbedUrl()(`https://embed.tidal.com/${embedPath}/${resourceId}`),
      };
    }

    this.spotifyUrlRegex.lastIndex = 0;
    const spotifyMatch = this.spotifyUrlRegex.exec(url);
    if (spotifyMatch) {
      const resourceType = spotifyMatch[1];
      const resourceId = spotifyMatch[2];
      return {
        processedUrl: this.media.getSpotifyEmbedUrl()(`https://open.spotify.com/embed/${resourceType}/${resourceId}`),
      };
    }

    return {};
  }

  private getYouTubeEmbedData(url: string): { processedUrl?: SafeResourceUrl } {
    this.youtubeUrlRegex.lastIndex = 0;
    if (!this.youtubeUrlRegex.test(url)) {
      return {};
    }

    return {
      processedUrl: this.media.getYouTubeEmbedUrl()(url),
    };
  }

  private buildEncryptedFilePart(content: string): ContentPart | null {
    const metadata = this.getEncryptedFileMetadata(content);
    if (!metadata) {
      return null;
    }

    const previewState = this.decryptedEncryptedFilePreviews().get(content);
    if (previewState) {
      return {
        type: previewState.mediaType,
        content: previewState.objectUrl,
        fileName: metadata.fileName,
        fileType: metadata.fileType,
        fileSize: metadata.fileSize,
        id: this.partIdCounter++,
      };
    }

    return {
      type: 'encrypted-file',
      content: metadata.content,
      fileName: metadata.fileName,
      fileType: metadata.fileType,
      fileSize: metadata.fileSize,
      decrypting: this.encryptedFileStates().get(content) || false,
      id: this.partIdCounter++,
    };
  }

  private getEncryptedFileMetadata(content: string): EncryptedFileMetadata | null {
    const tags = this.tags();
    const algorithm = tags.find(tag => tag[0] === 'encryption-algorithm')?.[1];
    const fileType = tags.find(tag => tag[0] === 'file-type')?.[1];
    const decryptionKey = tags.find(tag => tag[0] === 'decryption-key')?.[1];
    const decryptionNonce = tags.find(tag => tag[0] === 'decryption-nonce')?.[1];

    if (algorithm !== 'aes-gcm' || !fileType || !decryptionKey || !decryptionNonce) {
      return null;
    }

    return {
      content,
      fileName: tags.find(tag => tag[0] === 'alt')?.[1],
      fileType,
      fileSize: Number(tags.find(tag => tag[0] === 'size')?.[1] || 0) || undefined,
    };
  }

  private isPreviewableEncryptedFileType(fileType: string): boolean {
    return fileType.startsWith('image/') || fileType.startsWith('video/');
  }

  private getEncryptedFileCacheKey(content: string): string {
    return `https://nostria.local/cache/file/${encodeURIComponent(content)}`;
  }

  private async decryptEncryptedFilePreview(metadata: EncryptedFileMetadata): Promise<void> {
    const cacheKey = this.getEncryptedFileCacheKey(metadata.content);
    const cachedBlob = await this.getCachedEncryptedFilePreviewBlob(cacheKey);
    const blob = cachedBlob ?? await this.decryptEncryptedFileBlob(metadata);

    if (!cachedBlob) {
      await this.storeEncryptedFilePreviewBlob(cacheKey, blob);
    }

    const mediaType: 'image' | 'video' = metadata.fileType.startsWith('image/') ? 'image' : 'video';
    const objectUrl = URL.createObjectURL(blob);

    this.decryptedEncryptedFilePreviews.update(current => {
      const next = new Map(current);
      const existing = next.get(metadata.content);
      if (existing) {
        URL.revokeObjectURL(existing.objectUrl);
      }
      next.set(metadata.content, { objectUrl, mediaType });
      return next;
    });
  }

  private async getCachedEncryptedFilePreviewBlob(cacheKey: string): Promise<Blob | null> {
    if (!this.isBrowser || !('caches' in window)) {
      return null;
    }

    try {
      const cache = await caches.open('nostria-files');
      const response = await cache.match(cacheKey);
      if (!response?.ok) {
        return null;
      }
      return await response.blob();
    } catch (error) {
      this.logger.warn('Failed to read encrypted preview cache', error);
      return null;
    }
  }

  private async storeEncryptedFilePreviewBlob(cacheKey: string, blob: Blob): Promise<void> {
    if (!this.isBrowser || !('caches' in window)) {
      return;
    }

    try {
      const cache = await caches.open('nostria-files');
      await cache.put(cacheKey, new Response(blob, {
        headers: new Headers({
          'content-type': blob.type || 'application/octet-stream',
        }),
      }));
    } catch (error) {
      this.logger.warn('Failed to write encrypted preview cache', error);
    }
  }

  private async decryptEncryptedFileBlob(metadata: EncryptedFileMetadata): Promise<Blob> {
    this.setEncryptedFileDecrypting(metadata.content, true);

    try {
      const response = await this.corsProxy.fetch(metadata.content);
      if (!response.ok) {
        throw new Error(`Failed to download encrypted file (${response.status})`);
      }

      const encryptedBuffer = await response.arrayBuffer();
      const keyTag = this.tags().find(tag => tag[0] === 'decryption-key')?.[1];
      const nonceTag = this.tags().find(tag => tag[0] === 'decryption-nonce')?.[1];
      if (!keyTag || !nonceTag) {
        throw new Error('Missing decryption metadata');
      }

      const keyBytes = this.parseKeyBytes(keyTag);
      const nonceBytes = this.parseKeyBytes(nonceTag);
      const keyBuffer = new ArrayBuffer(keyBytes.byteLength);
      new Uint8Array(keyBuffer).set(keyBytes);
      const nonceBuffer = new ArrayBuffer(nonceBytes.byteLength);
      new Uint8Array(nonceBuffer).set(nonceBytes);
      const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: nonceBuffer },
        cryptoKey,
        encryptedBuffer,
      );

      return new Blob([decryptedBuffer], { type: metadata.fileType || 'application/octet-stream' });
    } finally {
      this.setEncryptedFileDecrypting(metadata.content, false);
    }
  }

  private setEncryptedFileDecrypting(url: string, decrypting: boolean): void {
    this.encryptedFileStates.update(current => {
      const next = new Map(current);
      next.set(url, decrypting);
      return next;
    });
  }

  getEncryptedFileMeta(part: ContentPart): string {
    const bits = [part.fileType || 'application/octet-stream'];
    if (part.fileSize) {
      bits.push(this.formatFileSize(part.fileSize));
    }
    return bits.join(' - ');
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }

    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
  }

  private parseKeyBytes(value: string): Uint8Array {
    const trimmedValue = value.trim();
    if (/^[0-9a-fA-F]+$/.test(trimmedValue) && trimmedValue.length % 2 === 0) {
      return hexToBytes(trimmedValue);
    }

    return this.base64ToUint8Array(trimmedValue);
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }
}
