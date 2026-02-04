import { Component, computed, effect, inject, input, signal, ApplicationRef, createComponent, EnvironmentInjector, PLATFORM_ID } from '@angular/core';
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
import type { ReportTarget } from '../../../services/reporting.service';

import { BookmarkService } from '../../../services/bookmark.service';
import { PinnedService } from '../../../services/pinned.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { AiService } from '../../../services/ai.service';
import { SettingsService } from '../../../services/settings.service';
import { PlaylistService } from '../../../services/playlist.service';
import { TranslateDialogComponent, TranslateDialogData } from '../translate-dialog/translate-dialog.component';
import { AiInfoDialogComponent } from '../../ai-info-dialog/ai-info-dialog.component';
import { ModelLoadDialogComponent } from '../../model-load-dialog/model-load-dialog.component';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { EventService } from '../../../services/event';
import { BookmarkListSelectorComponent } from '../../bookmark-list-selector/bookmark-list-selector.component';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { ShareArticleDialogComponent, ShareArticleDialogData } from '../../share-article-dialog/share-article-dialog.component';
import { EventImageService } from '../../../services/event-image.service';

@Component({
  selector: 'app-event-menu',
  standalone: true,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatDividerModule,
    MatMenuModule
  ],
  templateUrl: './event-menu.component.html',
  styleUrl: './event-menu.component.scss',
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
  mediaPlayer = inject(MediaPlayerService);
  utilities = inject(UtilitiesService);
  playlistService = inject(PlaylistService);
  eventService = inject(EventService);
  private router = inject(Router);
  private accountRelay = inject(AccountRelayService);
  private eventImageService = inject(EventImageService);
  private appRef = inject(ApplicationRef);
  private environmentInjector = inject(EnvironmentInjector);
  private platformId = inject(PLATFORM_ID);

  event = input.required<Event>();
  view = input<'icon' | 'full'>('icon');

  record = signal<NostrRecord | null>(null);

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

  // Check if AI options should be shown
  showAiOptions = computed<boolean>(() => {
    return !!this.settings.settings().aiEnabled && this.isTextNote();
  });

  // Regex patterns for detecting media URLs
  private audioRegex = /(https?:\/\/[^\s##]+\.(mp3|wav|ogg|m4a)(\?[^\s##]*)?)/gi;
  private videoRegex = /(https?:\/\/[^\s##]+\.(mp4|webm|mov|avi|wmv|flv|mkv)(\?[^\s##]*)?)/gi;
  // YouTube URL patterns: youtube.com/watch?v=, youtu.be/, youtube.com/embed/, youtube.com/shorts/
  private youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:[^\s]*)?/gi;

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

  async ensureModelLoaded(task: string, model: string): Promise<boolean> {
    // 1. Check if model is already loaded
    if (this.ai.isModelLoaded(model)) {
      return true;
    }

    // 2. Check if disclaimer seen
    const pubkey = this.accountState.pubkey();
    const disclaimerSeen = pubkey ? this.accountLocalState.getAiDisclaimerSeen(pubkey) : false;
    if (!disclaimerSeen) {
      const dialogRef = this.dialog.open(AiInfoDialogComponent);
      const result = await firstValueFrom(dialogRef.afterClosed());
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
      });
      dialogRef.close(true);
      return true;
    } catch (error) {
      console.error('Failed to load model', error);
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

  async readAloud() {
    const event = this.event();
    if (!event) return;

    try {
      if (!(await this.ensureModelLoaded('text-to-speech', this.ai.speechModelId))) {
        return;
      }

      this.snackBar.open('Generating speech...', 'Dismiss', { duration: 2000 });
      const result = await this.ai.synthesizeSpeech(event.content) as { blob: Blob, sampling_rate: number };

      const url = URL.createObjectURL(result.blob);
      const audio = new Audio(url);
      audio.play();
      audio.onended = () => URL.revokeObjectURL(url);
    } catch (error) {
      this.snackBar.open(`Speech generation failed: ${error}`, 'Dismiss', { duration: 3000 });
    }
  }

  shareEventDialog(): void {
    const ev = this.event();
    if (!ev) {
      return;
    }

    const relayHint = this.accountRelay.relays()[0]?.url;
    const relayHints = this.utilities.normalizeRelayUrls(relayHint ? [relayHint] : []);
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
    };

    this.dialog.open(ShareArticleDialogComponent, {
      data: dialogData,
      width: '450px',
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

  onBookmarkClick(event: MouseEvent) {
    event.stopPropagation();
    const targetItem = this.record();
    if (targetItem) {
      // Use article ID for articles, event ID for regular events
      const itemId = this.isArticle() ? this.articleId() : targetItem.event.id;
      const itemType = this.isArticle() ? 'a' : 'e';

      // Open bookmark list selector dialog
      this.dialog.open(BookmarkListSelectorComponent, {
        data: {
          itemId: itemId,
          type: itemType
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
    const relayHint = this.accountRelay.relays()[0]?.url;
    const relayHints = this.utilities.normalizeRelayUrls(relayHint ? [relayHint] : []);
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
    const relayHint = this.accountRelay.relays()[0]?.url;
    const relayHints = this.utilities.normalizeRelayUrls(relayHint ? [relayHint] : []);
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
    });
  }

  async deleteEvent() {
    const event = this.event();
    if (!event) {
      return;
    }

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete event',
        message: 'Are you sure?',
        confirmText: 'Delete event',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      } as ConfirmDialogData,
    });

    const confirmedDelete = await firstValueFrom(dialogRef.afterClosed());
    if (confirmedDelete) {
      const deleteEvent = this.nostrService.createRetractionEvent(event);

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

  openEventDetails() {
    const event = this.event();
    if (!event) {
      return;
    }

    const dialogRef = this.customDialog.open(EventDetailsDialogComponent, {
      title: 'Event Details',
      width: '800px',
      maxWidth: '95vw',
      data: { event } as EventDetailsDialogData,
    });

    dialogRef.componentInstance.dialogRef = dialogRef;
    dialogRef.componentInstance.dialogData = { event };
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

      // Wait for the component to render and profile data to load
      // This includes time for nostr mentions to be parsed and resolved
      await new Promise(resolve => setTimeout(resolve, 500));

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
      console.error('Failed to copy event as image:', error);
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
}
