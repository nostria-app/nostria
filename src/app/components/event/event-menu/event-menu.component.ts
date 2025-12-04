import { Component, computed, effect, inject, input, signal } from '@angular/core';
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
import { ProfileStateService } from '../../../services/profile-state.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { AiService } from '../../../services/ai.service';
import { SettingsService } from '../../../services/settings.service';
import { TranslateDialogComponent, TranslateDialogData } from '../translate-dialog/translate-dialog.component';
import { AiInfoDialogComponent } from '../../ai-info-dialog/ai-info-dialog.component';
import { ModelLoadDialogComponent } from '../../model-load-dialog/model-load-dialog.component';

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
  profileState = inject(ProfileStateService);
  dialog = inject(MatDialog);
  data = inject(DataService);
  nostrService = inject(NostrService);
  snackBar = inject(MatSnackBar);
  bookmark = inject(BookmarkService);
  pinned = inject(PinnedService);
  ai = inject(AiService);
  settings = inject(SettingsService);
  mediaPlayer = inject(MediaPlayerService);
  utilities = inject(UtilitiesService);

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

  // Check if we're on our own profile page
  isOnOwnProfile = computed<boolean>(() => {
    const profilePubkey = this.profileState.pubkey();
    return profilePubkey === this.accountState.pubkey();
  });

  // Check if this is a kind:1 event (text note)
  isTextNote = computed<boolean>(() => {
    const event = this.event();
    return event?.kind === kinds.ShortTextNote;
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
    const disclaimerSeen = localStorage.getItem('aiDisclaimerSeen');
    if (!disclaimerSeen) {
      const dialogRef = this.dialog.open(AiInfoDialogComponent);
      const result = await firstValueFrom(dialogRef.afterClosed());
      if (!result) {
        return false; // User cancelled or declined
      }
      localStorage.setItem('aiDisclaimerSeen', 'true');
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

  onBookmarkClick(event: MouseEvent) {
    event.stopPropagation();
    const targetItem = this.record();
    if (targetItem) {
      this.bookmark.toggleBookmark(targetItem.event.id);
    }
  }

  eventLink = computed<string>(() => {
    const event = this.event();
    if (!event) {
      return '';
    }

    // Use encodeEventForUrl which handles addressable events (naddr) vs regular events (nevent)
    const encoded = this.utilities.encodeEventForUrl(event);

    const url = new URL('https://nostria.app/');
    url.search = '';
    url.pathname = `/e/${encoded}`;
    return url.toString();
  });

  // Returns encoded event ID (naddr for addressable events, nevent for regular events)
  eventEncodedId = computed<string>(() => {
    const event = this.event();
    if (!event) {
      return '';
    }
    return this.utilities.encodeEventForUrl(event);
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
        this.snackBar.open('Note deletion was requested', 'Dismiss', {
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

    this.dialog.open(EventDetailsDialogComponent, {
      data: {
        event: event,
      } as EventDetailsDialogData,
      width: '80vw',
      maxWidth: '800px',
      maxHeight: '90vh',
    });
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
}
