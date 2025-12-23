import {
  Component,
  inject,
  computed,
  signal,
  input,
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
import { LocalStorageService } from '../../../services/local-storage.service';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { SwipeGestureDirective, SwipeEvent } from '../../../directives/swipe-gesture.directive';
import { ModernPlayerViewComponent } from './modern-player-view/modern-player-view.component';
import { CardsPlayerViewComponent } from './cards-player-view/cards-player-view.component';
import { WinampPlayerViewComponent } from './winamp-player-view/winamp-player-view.component';
import { PlaylistDrawerComponent } from './playlist-drawer/playlist-drawer.component';
import { nip19 } from 'nostr-tools';

export type PlayerViewType = 'modern' | 'cards' | 'winamp';

const PLAYER_VIEW_STORAGE_KEY = 'nostria-audio-player-view';

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
    SwipeGestureDirective,
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
  private localStorage = inject(LocalStorageService);

  footer = input<boolean>(false);

  // Player view state
  currentView = signal<PlayerViewType>(this.loadSavedView());
  showQueue = signal(false);

  // View options for the menu
  viewOptions: { type: PlayerViewType; icon: string; label: string }[] = [
    { type: 'modern', icon: 'auto_awesome', label: 'Modern' },
    { type: 'cards', icon: 'view_carousel', label: 'Cards' },
    { type: 'winamp', icon: 'graphic_eq', label: 'WinAmp' },
  ];

  private loadSavedView(): PlayerViewType {
    const saved = this.localStorage.getItem(PLAYER_VIEW_STORAGE_KEY);
    if (saved && ['modern', 'cards', 'winamp'].includes(saved)) {
      return saved as PlayerViewType;
    }
    return 'modern';
  }

  setView(view: PlayerViewType): void {
    this.currentView.set(view);
    this.localStorage.setItem(PLAYER_VIEW_STORAGE_KEY, view);
  }

  openQueue(): void {
    this.showQueue.set(true);
  }

  closeQueue(): void {
    this.showQueue.set(false);
  }

  // Computed values for display
  currentTime = computed(() => this.media.currentTimeSig());
  duration = computed(() => this.media.durationSig());
  isPodcast = computed(() => this.media.current()?.type === 'Podcast');

  formatLabel(value: number): string {
    if (!value || isNaN(value)) {
      return '0:00';
    }

    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const seconds = Math.floor(value % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

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
    this.layout.fullscreenMediaPlayer.set(!this.layout.fullscreenMediaPlayer());
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

  // Footer mode swipe handler
  onFooterSwipe(event: SwipeEvent): void {
    if (event.direction === 'up') {
      this.toggleFullscreen();
    } else if (event.direction === 'left' && this.media.canNext()) {
      this.media.next();
    } else if (event.direction === 'right' && this.media.canPrevious()) {
      this.media.previous();
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
}
