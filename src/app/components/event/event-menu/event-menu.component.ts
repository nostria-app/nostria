import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, ApplicationRef, createComponent, EnvironmentInjector, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { type Event, nip19, kinds } from 'nostr-tools';
import { MediaPlayerService } from '../../../services/media-player.service';
import { firstValueFrom } from 'rxjs';
import type { NostrRecord } from '../../../interfaces';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { DataService } from '../../../services/data.service';
import { NostrService } from '../../../services/nostr.service';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../../confirm-dialog/confirm-dialog.component';
import {
  EventDetailsDialogComponent,
  type EventDetailsDialogData,
} from '../../event-details-dialog/event-details-dialog.component';
import { LayoutService } from '../../../services/layout.service';
import { ReportingService, type ReportTarget } from '../../../services/reporting.service';

import { BookmarkService } from '../../../services/bookmark.service';
import { PinnedService } from '../../../services/pinned.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { AiModelLoadOptions, AiService } from '../../../services/ai.service';
import { SettingsService } from '../../../services/settings.service';
import { PlaylistService } from '../../../services/playlist.service';
import { FavoritesService } from '../../../services/favorites.service';
import { FollowSetsService } from '../../../services/follow-sets.service';
import { TranslateDialogComponent, TranslateDialogData } from '../translate-dialog/translate-dialog.component';
import { AiInfoDialogComponent, type AiInfoDialogResult } from '../../ai-info-dialog/ai-info-dialog.component';
import { ModelLoadDialogComponent } from '../../model-load-dialog/model-load-dialog.component';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { EventService } from '../../../services/event';
import { BookmarkListSelectorComponent } from '../../bookmark-list-selector/bookmark-list-selector.component';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../../share-article-dialog/share-article-dialog.component';
import { EventImageService } from '../../../services/event-image.service';
import { NoteEditorDialogData } from '../../../interfaces/note-editor';
import { UserRelaysService } from '../../../services/relays/user-relays';
import { LoggerService } from '../../../services/logger.service';
import { CreateListDialogComponent, type CreateListDialogResult } from '../../create-list-dialog/create-list-dialog.component';
import { isImageUrl } from '../../../services/format/utils';
import { SaveToGifsDialogComponent, SaveToGifsDialogData } from '../../save-to-gifs-dialog/save-to-gifs-dialog.component';
import { ImageCacheService } from '../../../services/image-cache.service';
import { EventRelaySourcesService } from '../../../services/event-relay-sources.service';
import { DeleteEventService } from '../../../services/delete-event.service';
import { EventTtsPlaybackService } from '../../../services/event-tts-playback.service';
import { extractTextForTts } from '../../../utils/tts-text';
import { TtsSequencePlayerService } from '../../../services/tts-sequence-player.service';

interface LocalTtsMenuOption {
  id: string;
  label: string;
  description: string;
  loadOptions?: AiModelLoadOptions;
}

@Component({
  selector: 'app-event-menu',
  imports: [
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatDividerModule,
    MatMenuModule
  ],
  templateUrl: './event-menu.component.html',
  styleUrl: './event-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventMenuComponent {
  layout = inject(LayoutService);
  accountState = inject(AccountStateService);
  accountLocalState = inject(AccountLocalStateService);
  dialog = inject(MatDialog);
  customDialog = inject(CustomDialogService);
  data = inject(DataService);
  nostrService = inject(NostrService);
  snackBar = inject(MatSnackBar);
  bookmark = inject(BookmarkService);
  pinned = inject(PinnedService);
  ai = inject(AiService);
  settings = inject(SettingsService);
  eventRelaySources = inject(EventRelaySourcesService);
  mediaPlayer = inject(MediaPlayerService);
  utilities = inject(UtilitiesService);
  playlistService = inject(PlaylistService);
  favoritesService = inject(FavoritesService);
  followSetsService = inject(FollowSetsService);
  eventService = inject(EventService);
  private reportingService = inject(ReportingService);
  private router = inject(Router);
  private userRelaysService = inject(UserRelaysService);
  private eventImageService = inject(EventImageService);
  private appRef = inject(ApplicationRef);
  private environmentInjector = inject(EnvironmentInjector);
  private platformId = inject(PLATFORM_ID);
  private logger = inject(LoggerService);
  private imageCacheService = inject(ImageCacheService);
  private deleteEventService = inject(DeleteEventService);
  private eventTtsPlayback = inject(EventTtsPlaybackService);
  private ttsSequence = inject(TtsSequencePlayerService);

  event = input.required<Event>();
  view = input<'icon' | 'full'>('icon');

  record = signal<NostrRecord | null>(null);
  readonly isReadingAloud = signal(false);
  private readonly webGpuAvailable = isPlatformBrowser(this.platformId)
    && typeof navigator !== 'undefined'
    && 'gpu' in navigator;
  readonly localTtsMenuOptions: LocalTtsMenuOption[] = [
    {
      id: this.ai.kokoroSpeechModelId,
      label: 'Kokoro 82M',
      description: this.webGpuAvailable ? 'WebGPU' : 'WASM',
      loadOptions: this.webGpuAvailable ? { dtype: 'fp32', device: 'webgpu' } : { dtype: 'q8', device: 'wasm' },
    },
    {
      id: this.ai.supertonicSpeechModelId,
      label: 'Supertonic 2',
      description: this.webGpuAvailable ? 'WebGPU' : 'WASM',
      loadOptions: this.webGpuAvailable ? { dtype: 'fp32', device: 'webgpu' } : { dtype: 'fp32', device: 'wasm' },
    },
    {
      id: this.ai.piperSpeechModelId,
      label: 'Piper LibriTTS',
      description: 'WASM',
    },
  ];

  isOurEvent = computed<boolean>(() => {
    const event = this.event();
    if (!event) {
      return false;
    }

    return event.pubkey === this.accountState.pubkey();
  });

  // Check if user has premium subscription
  isPremium = computed<boolean>(() => {
    const subscription = this.accountState.subscription();
    return !!subscription?.expires && subscription.expires > Date.now();
  });

  // Check if we're on our own profile page
  isOnOwnProfile = computed<boolean>(() => {
    const accountPubkey = this.accountState.pubkey();
    if (!accountPubkey) {
      return false;
    }

    const event = this.event();
    return event?.pubkey === accountPubkey;
  });

  // Check if this is a kind:1 event (text note)
  isTextNote = computed<boolean>(() => {
    const event = this.event();
    return event?.kind === kinds.ShortTextNote;
  });

  // Check if this is an article (kind 30023)
  isArticle = computed<boolean>(() => {
    const event = this.event();
    return event?.kind === kinds.LongFormArticle;
  });

  // Generate article ID in format: kind:pubkey:d-tag
  articleId = computed<string>(() => {
    const event = this.event();
    if (!event || event.kind !== kinds.LongFormArticle) {
      return '';
    }
    const dTag = event.tags.find(t => t[0] === 'd')?.[1] || '';
    return `${event.kind}:${event.pubkey}:${dTag}`;
  });

  // Check if pin/unpin options should be shown
  showPinOptions = computed<boolean>(() => {
    return this.isOnOwnProfile() && this.isTextNote() && this.isOurEvent();
  });

  // Check if article pin/unpin options should be shown
  showArticlePinOptions = computed<boolean>(() => {
    return this.isOnOwnProfile() && this.isArticle() && this.isOurEvent();
  });

  // Check if AI options should be shown
  showAiOptions = computed<boolean>(() => {
    return !!this.settings.settings().aiEnabled && this.isTextNote();
  });

  showReadAloudOptions = computed<boolean>(() => {
    return !!this.settings.settings().aiEnabled && !!this.settings.settings().aiSpeechEnabled && this.isTextNote();
  });

  canShowProfileMenu = computed<boolean>(() => {
    const event = this.event();
    const accountPubkey = this.accountState.pubkey();
    return !!event?.pubkey && !!accountPubkey && event.pubkey !== accountPubkey;
  });

  isAuthorFollowed = computed<boolean>(() => {
    const event = this.event();
    if (!event?.pubkey) {
      return false;
    }
    return this.accountState.isFollowing()(event.pubkey);
  });

  isAuthorFavorite = computed<boolean>(() => {
    const event = this.event();
    if (!event?.pubkey) {
      return false;
    }
    return this.favoritesService.isFavorite(event.pubkey);
  });

  availableFollowSets = computed(() => {
    return [...this.followSetsService.followSets()].sort((a, b) => a.title.localeCompare(b.title));
  });

  // Regex patterns for detecting media URLs
  // Lookahead also matches uppercase letter (start of new word without space)
  // This handles cases like "...file.mp4Curious about..." where text follows without whitespace
  private audioRegex = /(https?:\/\/[^\s##]+\.(mp3|wav|ogg|m4a)(\?[^\s##]*)?(?=\s|##|$|[A-Z]))/gi;
  private videoRegex = /(https?:\/\/[^\s##]+\.(mp4|webm|mov|avi|wmv|flv|mkv)(\?[^\s##]*)?(?=\s|##|$|[A-Z]))/gi;
  // YouTube URL patterns: youtube.com/watch?v=, youtu.be/, youtube.com/embed/, youtube.com/shorts/, youtube.com/live/
  // Supports YouTube subdomains (e.g., music.youtube.com)
  private youtubeRegex = /(?:https?:\/\/)?(?:[a-zA-Z0-9-]+\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[^\s]*)?/gi;
  // Extract media URLs from event content
  mediaUrls = computed<{ url: string; type: 'audio' | 'video'; isYouTube?: boolean; youtubeId?: string }[]>(() => {
    const event = this.event();
    if (!event || !event.content) {
      return [];
    }

    const urls: { url: string; type: 'audio' | 'video'; isYouTube?: boolean; youtubeId?: string }[] = [];
    const content = event.content;

    // Find audio URLs
    this.audioRegex.lastIndex = 0;
    let match;
    while ((match = this.audioRegex.exec(content)) !== null) {
      urls.push({ url: match[0], type: 'audio' });
    }

    // Find video URLs
    this.videoRegex.lastIndex = 0;
    while ((match = this.videoRegex.exec(content)) !== null) {
      urls.push({ url: match[0], type: 'video' });
    }

    // Find YouTube URLs
    this.youtubeRegex.lastIndex = 0;
    while ((match = this.youtubeRegex.exec(content)) !== null) {
      urls.push({
        url: match[0],
        type: 'video',
        isYouTube: true,
        youtubeId: match[1]
      });
    }

    return urls;
  });

  // Check if event has media
  hasMedia = computed<boolean>(() => this.mediaUrls().length > 0);

  // Extract image URLs from event content
  private imageRegex = /(https?:\/\/[^\s##]+\.(jpe?g|png|gif|webp|avif)(\?[^\s##]*)?(?=\s|##|$|[A-Z]))/gi;

  imageUrls = computed<string[]>(() => {
    const event = this.event();
    if (!event?.content) return [];

    const urls: string[] = [];
    const content = event.content;

    this.imageRegex.lastIndex = 0;
    let match;
    while ((match = this.imageRegex.exec(content)) !== null) {
      urls.push(match[0]);
    }

    // Also check imeta tags for image URLs
    if (event.tags) {
      for (const tag of event.tags) {
        if (tag[0] === 'imeta') {
          for (let i = 1; i < tag.length; i++) {
            if (tag[i].startsWith('url ')) {
              const url = tag[i].substring(4);
              if (isImageUrl(url) && !urls.includes(url)) {
                urls.push(url);
              }
            }
          }
        }
      }
    }

    return [...new Set(urls)];
  });

  hasImages = computed<boolean>(() => this.imageUrls().length > 0);

  async ensureModelLoaded(task: string, model: string, options?: AiModelLoadOptions): Promise<boolean> {
    // 1. Check if model is already loaded
    if (this.ai.isModelLoaded(model)) {
      return true;
    }

    // 2. Check if disclaimer seen
    const pubkey = this.accountState.pubkey();
    const disclaimerSeen = pubkey ? this.accountLocalState.getAiDisclaimerSeen(pubkey) : false;
    if (!disclaimerSeen) {
      const dialogRef = this.customDialog.open<AiInfoDialogComponent, AiInfoDialogResult>(AiInfoDialogComponent, {
        width: 'min(680px, calc(100vw - 24px))',
        maxWidth: 'calc(100vw - 24px)',
      });
      const result = (await firstValueFrom(dialogRef.afterClosed$)).result;
      if (!result) {
        return false; // User cancelled or declined
      }
      if (pubkey) {
        this.accountLocalState.setAiDisclaimerSeen(pubkey, true);
      }
    }

    // 3. Show loading dialog
    const dialogRef = this.dialog.open(ModelLoadDialogComponent, {
      data: { task, model },
      disableClose: true
    });

    try {
      // 4. Load model
      await this.ai.loadModel(task, model, (data) => {
        dialogRef.componentInstance.updateProgress(data as { status: string, progress?: number, file?: string });
      }, options);
      dialogRef.close(true);
      return true;
    } catch (error) {
      this.logger.error('Failed to load model', error);
      dialogRef.close(false);
      this.snackBar.open(`Failed to load model: ${error}`, 'Dismiss', { duration: 3000 });
      return false;
    }
  }

  async translate() {
    const event = this.event();
    if (!event) return;

    this.dialog.open(TranslateDialogComponent, {
      data: {
        content: event.content
      } as TranslateDialogData,
      width: '500px'
    });
  }

  async readAloud(model: LocalTtsMenuOption) {
    const event = this.event();
    if (!event || this.isReadingAloud()) return;

    this.ttsSequence.close();
    const playbackRequestId = this.eventTtsPlayback.start(event.id, model.label);
    const speechText = extractTextForTts(event.content);
    if (!speechText) {
      this.eventTtsPlayback.close(playbackRequestId);
      this.snackBar.open('No readable text found for speech.', 'Dismiss', { duration: 3000 });
      return;
    }

    try {
      this.isReadingAloud.set(true);

      if (!(await this.ensureModelLoaded('text-to-speech', model.id, model.loadOptions))) {
        this.eventTtsPlayback.close(playbackRequestId);
        return;
      }

      if (!this.eventTtsPlayback.isCurrent(playbackRequestId)) {
        return;
      }

      this.snackBar.open(`Generating speech with ${model.label}...`, 'Dismiss', { duration: 2000 });
      const [audio] = await this.ai.generateVoice(speechText, 'local', model.id);
      if (!audio) {
        throw new Error('No audio was generated.');
      }

      if (!this.eventTtsPlayback.isCurrent(playbackRequestId)) {
        URL.revokeObjectURL(audio.src);
        return;
      }

      await this.eventTtsPlayback.play(playbackRequestId, audio.src);
    } catch (error) {
      this.eventTtsPlayback.close(playbackRequestId);
      this.snackBar.open(`Speech generation failed: ${error}`, 'Dismiss', { duration: 3000 });
    } finally {
      this.isReadingAloud.set(false);
    }
  }

  async shareEventDialog(): Promise<void> {
    const ev = this.event();
    if (!ev) {
      return;
    }

    const authorRelays = await this.userRelaysService.getUserRelaysForPublishing(ev.pubkey);
    const relayHints = this.utilities.getShareRelayHints(authorRelays);
    const encodedId = this.utilities.encodeEventForUrl(ev, relayHints.length > 0 ? relayHints : undefined);

    const dialogData: ShareArticleDialogData = {
      title: ev.kind === kinds.LongFormArticle ? 'Article' : this.getEventPreviewTitle(ev.content),
      summary: ev.content || undefined,
      url: window.location.href,
      eventId: ev.id,
      pubkey: ev.pubkey,
      identifier: ev.tags.find(tag => tag[0] === 'd')?.[1],
      kind: ev.kind,
      encodedId,
      event: ev,
    };

    this.customDialog.open(ShareArticleDialogComponent, {
      title: 'Share',
      showCloseButton: true,
      data: dialogData,
      width: '560px',
      maxWidth: 'min(560px, calc(100vw - 24px))',
    });
  }

  private getEventPreviewTitle(content: string): string {
    const cleaned = content.replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      return 'Event';
    }
    const maxLength = 72;
    if (cleaned.length <= maxLength) {
      return cleaned;
    }
    return `${cleaned.slice(0, maxLength).trim()}…`;
  }

  async onBookmarkClick(event: MouseEvent) {
    event.stopPropagation();
    const targetItem = this.record();
    if (targetItem) {
      // Use article ID for articles, event ID for regular events
      const itemId = this.isArticle() ? this.articleId() : targetItem.event.id;
      const itemType = this.isArticle() ? 'a' : 'e';
      const authorPubkey = targetItem.event.pubkey;

      // Get relay hint for the author
      await this.userRelaysService.ensureRelaysForPubkey(authorPubkey);
      const authorRelays = this.userRelaysService.getRelaysForPubkey(authorPubkey);
      const relayHint = authorRelays[0] || undefined;

      // Open bookmark list selector dialog
      this.dialog.open(BookmarkListSelectorComponent, {
        data: {
          itemId: itemId,
          type: itemType,
          eventKind: targetItem.event.kind,
          pubkey: authorPubkey,
          relay: relayHint
        },
        width: '400px',
        panelClass: 'responsive-dialog'
      });
    }
  }

  eventLink = computed<string>(() => {
    const event = this.event();
    if (!event) {
      return '';
    }

    // Use encodeEventForUrl which handles addressable events (naddr) vs regular events (nevent)
    const authorRelays = this.userRelaysService.getRelaysForPubkey(event.pubkey);
    const relayHints = this.utilities.getShareRelayHints(authorRelays);
    const encoded = this.utilities.encodeEventForUrl(event, relayHints.length > 0 ? relayHints : undefined);

    const url = new URL('https://nostria.app/');
    url.search = '';

    // Use /a/ prefix for articles (kind 30023), /e/ for everything else
    if (event.kind === kinds.LongFormArticle) {
      url.pathname = `/a/${encoded}`;
    } else {
      url.pathname = `/e/${encoded}`;
    }
    return url.toString();
  });

  // Returns encoded event ID (naddr for addressable events, nevent for regular events)
  eventEncodedId = computed<string>(() => {
    const event = this.event();
    if (!event) {
      return '';
    }
    const authorRelays = this.userRelaysService.getRelaysForPubkey(event.pubkey);
    const relayHints = this.utilities.getShareRelayHints(authorRelays);
    return this.utilities.encodeEventForUrl(event, relayHints.length > 0 ? relayHints : undefined);
  });

  constructor() {
    effect(() => {
      const event = this.event();

      if (!event) {
        return;
      }

      const record = this.data.toRecord(event);
      this.record.set(record);

      // Ensure author relays are loaded so computed signals can use them
      this.userRelaysService.ensureRelaysForPubkey(event.pubkey);
    });
  }

  async deleteEvent() {
    const event = this.event();
    if (!event) {
      return;
    }

    const confirmedDelete = await this.deleteEventService.confirmDeletion({
      event,
      title: 'Delete event',
      entityLabel: 'event',
      confirmText: 'Delete event',
    });
    if (confirmedDelete) {
      const deleteEvent = this.nostrService.createRetractionEventWithMode(event, confirmedDelete.referenceMode);

      const result = await this.nostrService.signAndPublish(deleteEvent);
      if (result.success) {
        // Delete from local database after successful deletion request
        // This ensures the user doesn't see the event cached locally
        await this.eventService.deleteEventFromLocalStorage(event.id);

        this.snackBar.open('Note deleted successfully', 'Dismiss', {
          duration: 3000,
        });
      }
    }
  }

  reportContent() {
    const event = this.event();
    if (!event) {
      return;
    }

    const reportTarget: ReportTarget = {
      type: 'content',
      pubkey: event.pubkey,
      eventId: event.id,
    };

    this.layout.showReportDialog(reportTarget);
  }

  isAuthorBlocked = computed<boolean>(() => {
    const event = this.event();
    if (!event?.pubkey) return false;
    return this.reportingService.isUserBlocked(event.pubkey);
  });

  async blockUser(): Promise<void> {
    const event = this.event();
    if (!event?.pubkey) return;

    if (!(await this.ensureRealAccount())) return;

    if (this.isAuthorBlocked()) {
      const success = await this.reportingService.unblockUser(event.pubkey);
      this.layout.toast(success ? 'User unblocked' : 'Failed to unblock user');
    } else {
      if (this.isAuthorFollowed()) {
        const confirmed = await firstValueFrom(
          this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
            data: {
              title: 'Block User',
              message: 'You are currently following this user. Do you want to unfollow and block them?',
              confirmText: 'Unfollow and Block',
              cancelText: 'Cancel',
            },
          }).afterClosed()
        );
        if (!confirmed) return;
        await this.accountState.unfollow(event.pubkey);
      }
      const success = await this.reportingService.muteUser(event.pubkey);
      this.layout.toast(success ? 'User blocked' : 'Failed to block user');
    }
  }


  async onPinClick(event: MouseEvent) {
    event.stopPropagation();
    const targetEvent = this.event();
    if (!targetEvent) {
      return;
    }

    if (this.pinned.isPinned(targetEvent.id)) {
      await this.pinned.unpinNote(targetEvent.id);
      this.snackBar.open('Note unpinned', 'Close', { duration: 3000 });
    } else {
      await this.pinned.pinNote(targetEvent.id);
      this.snackBar.open('Note pinned to profile', 'Close', { duration: 3000 });
    }
  }

  async onArticlePinClick(event: MouseEvent) {
    event.stopPropagation();
    const targetEvent = this.event();
    if (!targetEvent) {
      return;
    }

    const coordinate = this.articleId();
    if (!coordinate) {
      return;
    }

    if (this.pinned.isArticlePinned(coordinate)) {
      await this.pinned.unpinArticle(coordinate);
      this.snackBar.open('Article unpinned', 'Close', { duration: 3000 });
    } else {
      await this.pinned.pinArticle(coordinate);
      this.snackBar.open('Article pinned to profile', 'Close', { duration: 3000 });
    }
  }

  private async ensureRealAccount(): Promise<boolean> {
    const account = this.accountState.account();
    if (!account || account.source === 'preview') {
      await this.layout.showLoginDialog();
      return false;
    }
    return true;
  }

  async toggleAuthorFollow(): Promise<void> {
    const event = this.event();
    if (!event?.pubkey) {
      return;
    }

    if (!(await this.ensureRealAccount())) {
      return;
    }

    try {
      if (this.isAuthorFollowed()) {
        await this.accountState.unfollow(event.pubkey);
        this.layout.toast('Unfollowed');
      } else {
        await this.accountState.follow(event.pubkey);
        this.layout.toast('Following');
      }
    } catch {
      this.layout.toast('Failed to update follow status');
    }
  }

  async toggleAuthorFavorite(): Promise<void> {
    const event = this.event();
    if (!event?.pubkey) {
      return;
    }

    if (!(await this.ensureRealAccount())) {
      return;
    }

    const wasFavorite = this.favoritesService.isFavorite(event.pubkey);
    const success = this.favoritesService.toggleFavorite(event.pubkey);

    if (!success) {
      this.layout.toast('Failed to update favorites');
      return;
    }

    this.layout.toast(wasFavorite ? 'Removed from favorites' : 'Added to favorites');
  }

  isAuthorInFollowSet(dTag: string): boolean {
    const event = this.event();
    if (!event?.pubkey) {
      return false;
    }

    const set = this.followSetsService.getFollowSetByDTag(dTag);
    return set ? set.pubkeys.includes(event.pubkey) : false;
  }

  async addAuthorToFollowSet(dTag: string): Promise<void> {
    const event = this.event();
    if (!event?.pubkey) {
      return;
    }

    if (!(await this.ensureRealAccount())) {
      return;
    }

    const isCurrentlyInSet = this.isAuthorInFollowSet(dTag);

    try {
      if (isCurrentlyInSet) {
        await this.followSetsService.removeFromFollowSet(dTag, event.pubkey);
        this.layout.toast('Removed from list');
      } else {
        await this.followSetsService.addToFollowSet(dTag, event.pubkey);
        this.layout.toast('Added to list');
      }
    } catch {
      this.layout.toast('Failed to update list');
    }
  }

  async createNewFollowSetForAuthor(): Promise<void> {
    const event = this.event();
    if (!event?.pubkey) {
      return;
    }

    if (!(await this.ensureRealAccount())) {
      return;
    }

    const dialogRef = this.dialog.open(CreateListDialogComponent, {
      data: {
        initialPrivate: false,
      },
      width: '450px',
    });

    const result: CreateListDialogResult | null = await firstValueFrom(dialogRef.afterClosed());

    if (!result || !result.title.trim()) {
      return;
    }

    try {
      const newSet = await this.followSetsService.createFollowSet(
        result.title.trim(),
        [event.pubkey],
        result.isPrivate,
      );

      if (newSet) {
        const privacyLabel = result.isPrivate ? 'private list' : 'list';
        this.layout.toast(`Created ${privacyLabel} "${result.title}" and added author`);
      } else {
        this.layout.toast('Failed to create list');
      }
    } catch {
      this.layout.toast('Failed to create list');
    }
  }

  openSaveToGifsDialog(): void {
    const urls = this.imageUrls();
    if (urls.length === 0) return;

    this.dialog.open(SaveToGifsDialogComponent, {
      data: { imageUrls: urls } as SaveToGifsDialogData,
      width: '450px',
      panelClass: 'responsive-dialog',
    });
  }

  openEventDetails() {
    const event = this.event();
    if (!event) {
      return;
    }

    const dialogRef = this.customDialog.open(EventDetailsDialogComponent, {
      title: 'Event Details',
      width: '800px',
      maxWidth: '95vw',
      data: { event, relayUrls: this.eventRelaySources.getRelayUrls(event.id) } as EventDetailsDialogData,
    });

    dialogRef.componentInstance.dialogRef = dialogRef;
    dialogRef.componentInstance.dialogData = { event, relayUrls: this.eventRelaySources.getRelayUrls(event.id) };
  }

  /**
   * Add media files from the event to the media queue
   */
  addMediaToQueue() {
    const urls = this.mediaUrls();
    if (urls.length === 0) {
      return;
    }

    const event = this.event();
    const author = event?.pubkey ? nip19.npubEncode(event.pubkey) : '';

    for (const media of urls) {
      if (media.isYouTube && media.youtubeId) {
        this.mediaPlayer.enque({
          source: `https://www.youtube.com/watch?v=${media.youtubeId}`,
          title: `YouTube Video`,
          artist: author,
          artwork: `https://img.youtube.com/vi/${media.youtubeId}/hqdefault.jpg`,
          type: 'YouTube',
        });
      } else {
        this.mediaPlayer.enque({
          source: media.url,
          title: this.extractFilename(media.url),
          artist: author,
          artwork: '',
          type: media.type === 'video' ? 'Video' : 'Music',
        });
      }
    }

    this.snackBar.open(
      urls.length === 1 ? 'Added to queue' : `Added ${urls.length} items to queue`,
      'Dismiss',
      { duration: 3000 }
    );
  }

  /**
   * Add media files to queue and start playing
   */
  playMediaInPlayer() {
    const urls = this.mediaUrls();
    if (urls.length === 0) {
      return;
    }

    const event = this.event();
    const author = event?.pubkey ? nip19.npubEncode(event.pubkey) : '';
    const startIndex = this.mediaPlayer.media().length;

    for (const media of urls) {
      if (media.isYouTube && media.youtubeId) {
        this.mediaPlayer.enque({
          source: `https://www.youtube.com/watch?v=${media.youtubeId}`,
          title: `YouTube Video`,
          artist: author,
          artwork: `https://img.youtube.com/vi/${media.youtubeId}/hqdefault.jpg`,
          type: 'YouTube',
        });
      } else {
        this.mediaPlayer.enque({
          source: media.url,
          title: this.extractFilename(media.url),
          artist: author,
          artwork: '',
          type: media.type === 'video' ? 'Video' : 'Music',
        });
      }
    }

    // Start playing from the first added item
    this.mediaPlayer.index = startIndex;
    this.mediaPlayer.start();
  }

  /**
   * Extract filename from URL for display
   */
  private extractFilename(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split('/').pop() || url;
      // Decode URI and remove extension for cleaner display
      return decodeURIComponent(filename);
    } catch {
      return url;
    }
  }

  /**
   * Add media from the event to a specific playlist
   */
  addMediaToPlaylist(playlistId: string) {
    const urls = this.mediaUrls();
    if (urls.length === 0) {
      return;
    }

    const event = this.event();
    const author = event?.pubkey ? nip19.npubEncode(event.pubkey) : '';

    for (const media of urls) {
      let track;
      if (media.isYouTube && media.youtubeId) {
        track = this.playlistService.urlToPlaylistTrack(
          `https://www.youtube.com/watch?v=${media.youtubeId}`,
          'YouTube Video',
          author
        );
      } else {
        track = this.playlistService.urlToPlaylistTrack(
          media.url,
          this.extractFilename(media.url),
          author
        );
      }
      this.playlistService.addTrackToPlaylist(playlistId, track);
    }

    const playlist = this.playlistService.getPlaylist(playlistId);
    const playlistName = playlist?.title || playlistId;

    this.snackBar.open(
      urls.length === 1
        ? `Added to "${playlistName}"`
        : `Added ${urls.length} items to "${playlistName}"`,
      'Dismiss',
      { duration: 3000 }
    );
  }

  /**
   * Copy the event as an image/screenshot to the clipboard
   */
  async copyAsImage(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const ev = this.event();
    if (!ev) {
      return;
    }

    try {
      this.snackBar.open('Generating screenshot...', undefined, { duration: 2000 });

      // Create a container for rendering the screenshot component
      // Position it mostly off-screen but with 1px in viewport so IntersectionObserver triggers
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-499px'; // 500px wide, so 1px is visible at left edge
      container.style.top = '0';
      container.style.width = '500px';
      container.style.background = 'var(--mat-sys-surface)';
      // Ensure the container inherits theme styles
      container.className = document.body.className;
      document.body.appendChild(container);

      // Dynamically import EventImageComponent to avoid circular dependency
      const { EventImageComponent } = await import('../../event-image/event-image.component');

      // Dynamically create the EventImageComponent
      const componentRef = createComponent(EventImageComponent, {
        environmentInjector: this.environmentInjector,
        hostElement: container
      });

      // Set the event input
      componentRef.setInput('event', ev);
      componentRef.setInput('width', 500);

      // Attach to Angular's change detection
      this.appRef.attachView(componentRef.hostView);

      // Trigger change detection to render the component
      componentRef.changeDetectorRef.detectChanges();

      // Wait for the component to signal it's ready (content parsed, mentions resolved)
      // Use a promise that resolves when the ready output emits, with a timeout fallback
      await new Promise<void>(resolve => {
        const subscription = componentRef.instance.ready.subscribe(() => {
          subscription.unsubscribe();
          resolve();
        });
        // Timeout fallback in case ready never fires (e.g., no mentions to resolve)
        setTimeout(() => {
          subscription.unsubscribe();
          resolve();
        }, 2000);
      });

      // Run change detection again to ensure profile and mentions are rendered
      componentRef.changeDetectorRef.detectChanges();

      // Wait for any images to load
      await this.waitForImages(container);

      // Capture the element as an image
      const element = container.querySelector('.event-image-container') as HTMLElement;
      if (!element) {
        throw new Error('Could not find event image container');
      }

      // Get the computed background color for the screenshot
      const computedStyle = getComputedStyle(element);
      const backgroundColor = computedStyle.backgroundColor || '#ffffff';

      const success = await this.eventImageService.captureAndCopy(element, {
        backgroundColor,
        pixelRatio: 2
      });

      // Cleanup
      this.appRef.detachView(componentRef.hostView);
      componentRef.destroy();
      document.body.removeChild(container);

      if (!success) {
        this.snackBar.open('Failed to copy screenshot', 'Dismiss', { duration: 3000 });
      }
    } catch (error) {
      this.logger.error('Failed to copy event as image:', error);
      this.snackBar.open('Failed to generate screenshot', 'Dismiss', { duration: 3000 });
    }
  }

  /**
   * Wait for all images in a container to load
   */
  private waitForImages(container: HTMLElement): Promise<void> {
    const images = container.querySelectorAll('img');
    const promises: Promise<void>[] = [];

    images.forEach(img => {
      if (!img.complete) {
        promises.push(new Promise((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve(); // Resolve even on error to not block
          // Timeout fallback
          setTimeout(resolve, 3000);
        }));
      }
    });

    return Promise.all(promises).then(() => undefined);
  }

  /**
   * Navigate to the Newsletter page for this event
   */
  goToNewsletter(): void {
    const encodedId = this.eventEncodedId();
    if (encodedId) {
      this.router.navigate(['/newsletter', encodedId]);
    }
  }

  /**
   * Navigate to the Event Analytics page for this event
   */
  goToEventAnalytics(): void {
    const encodedId = this.eventEncodedId();
    if (encodedId) {
      this.router.navigate(['/analytics/event', encodedId]);
    }
  }

  /**
   * NIP-41: Edit a kind:1 short note
   * Opens the note editor with the original content for editing
   * Only available for the user's own text notes
   */
  async editEvent(): Promise<void> {
    const ev = this.event();
    if (!ev || ev.kind !== kinds.ShortTextNote) {
      return;
    }

    // Dynamically import NoteEditorDialogComponent to avoid circular dependency
    const { NoteEditorDialogComponent } = await import('../../note-editor-dialog/note-editor-dialog.component');

    const editData: NoteEditorDialogData = {
      editEvent: ev,
      content: ev.content,
    };

    const profilePicture = this.accountState.profile()?.data?.picture;
    const headerIcon = profilePicture ? this.imageCacheService.getOptimizedImageUrl(profilePicture) : '';

    this.dialog.open(NoteEditorDialogComponent, {
      data: {
        ...editData,
        dialogTitle: 'Edit Note',
        dialogHeaderIcon: headerIcon,
      },
      panelClass: ['material-custom-dialog-panel', 'note-editor-dialog-panel'],
      maxWidth: '95vw',
      disableClose: true,
      autoFocus: false,
      restoreFocus: false,
    });
  }
}
