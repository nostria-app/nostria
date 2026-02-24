import {
  Component,
  inject,
  computed,
  signal,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSliderModule } from '@angular/material/slider';
import { MatMenuModule } from '@angular/material/menu';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { MediaPlayerService } from '../../../services/media-player.service';
import { LayoutService } from '../../../services/layout.service';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { ImageCacheService } from '../../../services/image-cache.service';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { ModernPlayerViewComponent } from './modern-player-view/modern-player-view.component';
import { CardsPlayerViewComponent } from './cards-player-view/cards-player-view.component';
import { WinampPlayerViewComponent } from './winamp-player-view/winamp-player-view.component';
import { PlaylistDrawerComponent } from './playlist-drawer/playlist-drawer.component';
import { nip19 } from 'nostr-tools';
import { formatDuration } from '../../../utils/format-duration';
import { MediaItem } from '../../../interfaces';

export type PlayerViewType = 'modern' | 'cards' | 'winamp';
type TrackEntry = { track: MediaItem; index: number };

@Component({
  selector: 'app-audio-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSliderModule,
    MatMenuModule,
    FormsModule,
    RouterModule,
    UserProfileComponent,
    ModernPlayerViewComponent,
    CardsPlayerViewComponent,
    WinampPlayerViewComponent,
    PlaylistDrawerComponent,
  ],
  templateUrl: './audio-player.component.html',
  styleUrl: './audio-player.component.scss',
  host: {
    '[class.footer-mode]': 'footer()',
    '[class.compact-mode]': '!footer()',
    '[class.queue-open]': 'showQueue()',
    '(window:keydown)': 'onKeydown($event)',
    'tabindex': '0',
  },
})
export class AudioPlayerComponent {
  readonly media = inject(MediaPlayerService);
  readonly layout = inject(LayoutService);
  private router = inject(Router);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  private imageCache = inject(ImageCacheService);

  footer = input<boolean>(false);
  miniMediaToggleRequested = output<MouseEvent>();

  // Player view state
  currentView = signal<PlayerViewType>(this.loadSavedView());
  showQueue = signal(false);
  queueDragOffset = signal(0);

  // View options for the menu
  viewOptions: { type: PlayerViewType; icon: string; label: string }[] = [
    { type: 'modern', icon: 'auto_awesome', label: 'Modern' },
    { type: 'cards', icon: 'view_carousel', label: 'Cards' },
    { type: 'winamp', icon: 'graphic_eq', label: 'WinAmp' },
  ];

  private loadSavedView(): PlayerViewType {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return 'modern';

    const saved = this.accountLocalState.getAudioPlayerView(pubkey);
    if (saved && ['modern', 'cards', 'winamp'].includes(saved)) {
      return saved as PlayerViewType;
    }
    return 'modern';
  }

  setView(view: PlayerViewType): void {
    this.currentView.set(view);
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setAudioPlayerView(pubkey, view);
    }
  }

  openQueue(): void {
    this.showQueue.set(true);
    this.queueDragOffset.set(0);
  }

  closeQueue(): void {
    this.showQueue.set(false);
    this.queueDragOffset.set(0);
  }

  onQueueDragProgress(deltaY: number): void {
    // Only allow drag when queue is not already open
    if (!this.showQueue()) {
      this.queueDragOffset.set(deltaY);
    }
  }

  onQueueDragEnd(): void {
    // If dragged far enough, open the queue
    const threshold = 100;
    if (this.queueDragOffset() > threshold) {
      this.showQueue.set(true);
    }
    this.queueDragOffset.set(0);
  }

  // Computed values for display
  currentTime = computed(() => this.media.currentTimeSig());
  duration = computed(() => this.media.durationSig());
  isPodcast = computed(() => this.media.current()?.type === 'Podcast');
  isMusicTrack = computed(() => this.media.current()?.type === 'Music');
  queue = computed(() => this.media.media());
  currentIndex = computed(() => this.media.index);
  playlistExpanded = computed(() => this.footer() && this.isMusicTrack() && this.layout.expandedMediaPlayer());
  currentTrackVideo = computed(() => this.media.current()?.video?.trim() || '');
  showExpandedVideo = computed(() => this.playlistExpanded() && !!this.currentTrackVideo());
  showExpandedQueue = computed(() => this.playlistExpanded() && !this.currentTrackVideo());
  queueTrackEntries = computed<TrackEntry[]>(() => this.queue().map((track, index) => ({ track, index })));
  visibleTrackEntries = computed(() => this.queueTrackEntries());

  // Proxied artwork for footer/minimized mode (smaller size for performance)
  footerArtwork = computed(() => {
    const artwork = this.media.current()?.artwork;
    if (!artwork) return null;
    // Use smaller image for footer mode
    return this.imageCache.getOptimizedImageUrlWithSize(artwork, 64, 64);
  });

  formatLabel = formatDuration;

  constructor() { }

  onTimeChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);

    // Only update if value actually changed to avoid jitter
    if (this.media.audio && Math.abs(this.media.audio.currentTime - value) > 0.5) {
      this.media.audio.currentTime = value;
    }
  }

  onVolumeChange(value: number): void {
    if (this.media.audio) {
      this.media.audio.volume = value / 100;
    }
  }

  get volume(): number {
    return this.media.audio ? Math.round(this.media.audio.volume * 100) : 100;
  }

  toggleFullscreen(): void {
    this.layout.fullscreenMediaPlayer.set(!this.layout.fullscreenMediaPlayer());
  }

  toggleExpanded(): void {
    if (!this.footer() || !this.isMusicTrack()) {
      this.toggleFullscreen();
      return;
    }

    this.layout.expandedMediaPlayer.set(!this.layout.expandedMediaPlayer());
  }

  playTrackFromQueue(index: number): void {
    this.media.index = index;
    void this.media.start();
  }

  removeTrackFromQueue(index: number, event: Event): void {
    event.stopPropagation();

    const queue = this.queue();
    if (index < 0 || index >= queue.length) {
      return;
    }

    this.media.dequeue(queue[index]);
  }

  clearEntireQueue(): void {
    this.media.clearQueue();
  }

  close(): void {
    this.media.exit();
  }

  isNpubArtist(artist: string | undefined): boolean {
    return !!artist && artist.startsWith('npub1');
  }

  getNpubPubkey(artist: string): string {
    try {
      const decoded = nip19.decode(artist);
      if (decoded.type === 'npub') {
        return decoded.data;
      }
    } catch {
      // Ignore decoding errors
    }
    return '';
  }

  // Check if we have a link to the song page
  hasSongLink(): boolean {
    const current = this.media.current();
    return !!(current?.eventPubkey && current?.eventIdentifier);
  }

  // Check if we have a link to the artist page  
  hasArtistLink(): boolean {
    const current = this.media.current();
    return !!current?.eventPubkey;
  }

  // Navigate to song detail page
  goToSong(): void {
    const current = this.media.current();
    if (current?.eventPubkey && current?.eventIdentifier) {
      this.router.navigate(['/music/song', current.eventPubkey, current.eventIdentifier]);
    }
  }

  // Navigate to artist page
  goToArtist(): void {
    const current = this.media.current();
    if (current?.eventPubkey) {
      this.router.navigate(['/music/artist', current.eventPubkey]);
    }
  }

  // Keyboard navigation handler
  onKeydown(event: KeyboardEvent): void {
    // Only handle when fullscreen player is active and not typing in an input
    if (!this.layout.fullscreenMediaPlayer()) return;
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    switch (event.key) {
      case 'ArrowLeft':
        if (this.media.canPrevious()) {
          event.preventDefault();
          this.media.previous();
        }
        break;
      case 'ArrowRight':
        if (this.media.canNext()) {
          event.preventDefault();
          this.media.next();
        }
        break;
      case ' ':
        event.preventDefault();
        if (this.media.paused) {
          this.media.resume();
        } else {
          this.media.pause();
        }
        break;
    }
  }

  onMiniArtworkDoubleClick(event: MouseEvent): void {
    if (!this.footer()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.miniMediaToggleRequested.emit(event);
  }
}
