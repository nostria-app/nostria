import {
  Component,
  inject,
  computed,
  ChangeDetectionStrategy,
  output,
  signal,
  effect,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSliderModule } from '@angular/material/slider';
import { MediaPlayerService } from '../../../../services/media-player.service';
import { PlatformService } from '../../../../services/platform.service';
import { DataService } from '../../../../services/data.service';
import { formatDuration } from '../../../../utils/format-duration';
import { trigger, transition, style, animate, state } from '@angular/animations';
import { LyricsViewComponent } from '../lyrics-view/lyrics-view.component';
import { SwipeEvent, SwipeGestureDirective, SwipeProgressEvent } from '../../../../directives/swipe-gesture.directive';
import { MediaItem } from '../../../../interfaces';
import { nip19 } from 'nostr-tools';

const MUSIC_KIND = 36787;

@Component({
  selector: 'app-modern-player-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatSliderModule,
    LyricsViewComponent,
    SwipeGestureDirective,
  ],
  templateUrl: './modern-player-view.component.html',
  styleUrl: './modern-player-view.component.scss',
  animations: [
    trigger('fadeContent', [
      state('visible', style({ opacity: 1, transform: 'scale(1)' })),
      state('hidden', style({ opacity: 0, transform: 'scale(0.95)' })),
      transition('visible => hidden', animate('200ms ease-out')),
      transition('hidden => visible', animate('400ms ease-out')),
    ]),
    trigger('fadeBackground', [
      state('visible', style({ opacity: 0.8 })),
      state('hidden', style({ opacity: 0 })),
      transition('visible => hidden', animate('300ms ease-out')),
      transition('hidden => visible', animate('600ms ease-in')),
    ]),
  ],
})
export class ModernPlayerViewComponent {
  readonly media = inject(MediaPlayerService);
  private readonly platform = inject(PlatformService);
  private readonly data = inject(DataService);

  openQueue = output<void>();
  queueDragProgress = output<number>();
  queueDragEnd = output<void>();
  isIosSafeEffects = computed(() => this.platform.isIOS());

  // Track change animation state
  contentState = signal<'visible' | 'hidden'>('visible');
  backgroundState = signal<'visible' | 'hidden'>('visible');
  private lastTrackId = signal<string | null>(null);

  // Displayed track info - only updates after fade-out completes
  displayedArtwork = signal<string | undefined>(undefined);
  displayedTitle = signal<string>('Unknown Track');
  displayedArtist = signal<string>('Unknown Artist');
  displayedIsAi = signal(false);
  private aiLookupRequestId = 0;

  // Lyrics view toggle
  showLyrics = signal(false);
  canShowLyrics = computed(() => {
    const current = this.media.current();
    // Show lyrics button for Music type (can search API) or if lyrics exist
    return current?.type === 'Music' || !!current?.lyrics;
  });

  toggleLyrics(): void {
    this.showLyrics.update(v => !v);
  }

  constructor() {
    // Watch for track changes and trigger animations
    effect(() => {
      const current = this.media.current();
      const currentId = current?.source || current?.title || null;
      const lastId = this.lastTrackId();

      if (lastId !== null && currentId !== lastId) {
        if (this.isIosSafeEffects()) {
          this.lastTrackId.set(currentId);
          this.displayedArtwork.set(current?.artwork);
          this.displayedTitle.set(current?.title || 'Unknown Track');
          this.displayedArtist.set(current?.artist || 'Unknown Artist');
          void this.updateDisplayedAiState(current);
          this.backgroundState.set('visible');
          this.contentState.set('visible');
          return;
        }

        // Track changed - trigger fade animation
        this.contentState.set('hidden');
        this.backgroundState.set('hidden');

        // After fade out, update displayed info and fade back in
        setTimeout(() => {
          this.lastTrackId.set(currentId);
          // Update displayed content after fade-out
          this.displayedArtwork.set(current?.artwork);
          this.displayedTitle.set(current?.title || 'Unknown Track');
          this.displayedArtist.set(current?.artist || 'Unknown Artist');
          void this.updateDisplayedAiState(current);

          this.backgroundState.set('visible');
          // Stagger the content fade-in slightly
          setTimeout(() => {
            this.contentState.set('visible');
          }, 100);
        }, 250);
      } else if (lastId === null && currentId !== null) {
        // First track loaded - set immediately without animation
        this.lastTrackId.set(currentId);
        this.displayedArtwork.set(current?.artwork);
        this.displayedTitle.set(current?.title || 'Unknown Track');
        this.displayedArtist.set(current?.artist || 'Unknown Artist');
        void this.updateDisplayedAiState(current);
      }
    });
  }

  private async updateDisplayedAiState(current: MediaItem | undefined): Promise<void> {
    const requestId = ++this.aiLookupRequestId;
    const isAiGenerated = await this.resolveIsAiGenerated(current);

    if (requestId !== this.aiLookupRequestId) {
      return;
    }

    this.displayedIsAi.set(isAiGenerated);
  }

  private async resolveIsAiGenerated(current: MediaItem | undefined): Promise<boolean> {
    if (!current || current.type !== 'Music') {
      return false;
    }

    if (current.isAiGenerated) {
      return true;
    }

    const eventPubkey = this.normalizePubkey(current.eventPubkey);
    const eventIdentifier = current.eventIdentifier;

    if (!eventPubkey || !eventIdentifier) {
      return false;
    }

    try {
      const record = await this.data.getEventByPubkeyAndKindAndReplaceableEvent(
        eventPubkey,
        MUSIC_KIND,
        eventIdentifier,
        { save: true }
      );

      const trackEvent = record?.event;
      if (!trackEvent) {
        return false;
      }

      const aiTag = trackEvent.tags.find(t => t[0] === 'ai_generated' || t[0] === 'ai');
      const hasAiTopic = trackEvent.tags.some(
        t => t[0] === 't' && t[1]?.toLowerCase() === 'ai_generated'
      );

      return aiTag?.[1] === 'true' || hasAiTopic;
    } catch {
      return false;
    }
  }

  private normalizePubkey(pubkey: string | undefined): string | null {
    if (!pubkey) {
      return null;
    }

    if (pubkey.startsWith('npub1')) {
      try {
        const decoded = nip19.decode(pubkey);
        if (decoded.type === 'npub') {
          return decoded.data;
        }
      } catch {
        return null;
      }
    }

    return pubkey;
  }

  currentTime = computed(() => this.media.currentTimeSig());
  duration = computed(() => this.media.durationSig());
  progress = computed(() => {
    const dur = this.duration();
    if (!dur) return 0;
    return this.currentTime() / dur;
  });

  formatTime = formatDuration;

  onTimeChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);
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

  getRepeatTooltip(): string {
    switch (this.media.repeat()) {
      case 'off': return 'Repeat: Off';
      case 'all': return 'Repeat: All';
      case 'one': return 'Repeat: One';
    }
  }

  onSwipe(event: SwipeEvent): void {
    if (this.showLyrics()) return;

    switch (event.direction) {
      case 'left':
        if (this.media.canNext()) this.media.next();
        break;
      case 'right':
        if (this.media.canPrevious()) this.media.previous();
        break;
      case 'down':
        this.openQueue.emit();
        break;
    }
  }

  onSwipeProgress(event: SwipeProgressEvent): void {
    if (this.showLyrics()) return;

    if (event.direction === 'vertical' && event.deltaY > 0) {
      this.queueDragProgress.emit(event.deltaY);
    }
  }

  onSwipeEnd(): void {
    this.queueDragEnd.emit();
  }
}
