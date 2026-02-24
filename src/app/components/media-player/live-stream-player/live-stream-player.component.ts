import {
  Component,
  inject,
  signal,
  computed,
  ViewChild,
  ElementRef,
  afterNextRender,
  OnDestroy,
  input,
  effect,
  DestroyRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, NavigationStart } from '@angular/router';
import { Location } from '@angular/common';
import { OverlayContainer } from '@angular/cdk/overlay';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatSliderModule } from '@angular/material/slider';
import { LiveChatComponent } from '../../live-chat/live-chat.component';
import { StreamInfoBarComponent } from '../../stream-info-bar/stream-info-bar.component';
import { VideoControlsComponent } from '../../video-controls/video-controls.component';
import { VolumeGestureDirective } from '../../../directives/volume-gesture.directive';
import { MediaPlayerService } from '../../../services/media-player.service';
import { LayoutService } from '../../../services/layout.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { CastService } from '../../../services/cast.service';
import {
  toggleFullscreen as fullscreenToggle,
  isInFullscreen,
  addFullscreenChangeListener,
} from '../../../utils/fullscreen';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { UserRelaysService } from '../../../services/relays/user-relays';
import { Filter, Event } from 'nostr-tools';

// Extend Window to include Hls
declare global {
  interface Window {
    Hls?: typeof import('hls.js').default;
  }
}

@Component({
  selector: 'app-live-stream-player',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatMenuModule,
    MatSliderModule,
    LiveChatComponent,
    StreamInfoBarComponent,
    VideoControlsComponent,
    VolumeGestureDirective,
  ],
  templateUrl: './live-stream-player.component.html',
  styleUrl: './live-stream-player.component.scss',
  host: {
    '[class.fullscreen-mode]': 'layout.fullscreenMediaPlayer()',
    '[class.footer-mode]': 'footer()',
    '[class.footer-expanded-mode]': 'footer() && layout.expandedMediaPlayer()',
  },
})
export class LiveStreamPlayerComponent implements OnDestroy {
  readonly media = inject(MediaPlayerService);
  readonly layout = inject(LayoutService);
  private readonly utilities = inject(UtilitiesService);
  private readonly castService = inject(CastService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly relayPool = inject(RelayPoolService);
  private readonly relaysService = inject(RelaysService);
  private readonly userRelaysService = inject(UserRelaysService);
  private readonly overlayContainer = inject(OverlayContainer);
  private readonly elementRef = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  footer = input<boolean>(false);
  chatVisible = signal(true);
  streamInfoVisible = signal(true);
  isNativeFullscreen = signal(false);
  cursorHidden = signal(false);

  @ViewChild('videoElement', { static: false })
  videoElement?: ElementRef<HTMLVideoElement>;

  @ViewChild(VideoControlsComponent)
  videoControlsRef?: VideoControlsComponent;

  private fullscreenCleanup: (() => void) | null = null;

  private eventSubscription: { close: () => void } | null = null;
  private currentStreamId: string | null = null;

  // Live stream metadata
  streamTitle = computed(() => this.media.current()?.title || 'Live Stream');
  streamStatus = computed(() => {
    const event = this.media.current()?.liveEventData;
    if (!event) return 'live';
    const statusTag = event.tags.find((tag: string[]) => tag[0] === 'status');
    return statusTag?.[1] || 'live';
  });

  liveEvent = computed(() => this.media.current()?.liveEventData);

  // Viewer count from live event
  viewerCount = computed(() => {
    const event = this.liveEvent();
    if (!event) return 0;
    const participantsTag = event.tags.find((tag: string[]) => tag[0] === 'current_participants');
    return participantsTag?.[1] ? parseInt(participantsTag[1], 10) : 0;
  });

  isLiveKit = computed(() => this.media.current()?.type === 'LiveKit');
  isExternal = computed(() => this.media.current()?.type === 'External');

  // HLS Quality levels - linked to media player service
  qualityLevels = computed(() =>
    this.media.hlsQualityLevels().map(level => ({
      index: level.index,
      label: level.label,
      height: level.height,
      bitrate: level.bitrate,
    }))
  );
  currentQualityLevel = computed(() => this.media.hlsCurrentQuality());

  // Extract URL from alt tag or service tag
  joinUrl = computed(() => {
    const event = this.media.current()?.liveEventData;
    if (!event) return null;

    const serviceTag = event.tags.find((tag: string[]) => tag[0] === 'service');
    if (serviceTag?.[1]) return serviceTag[1];

    const altTag = event.tags.find((tag: string[]) => tag[0] === 'alt');
    if (altTag?.[1]) {
      const urlMatch = altTag[1].match(/https?:\/\/[^\s]+/);
      return urlMatch?.[0] || null;
    }

    return null;
  });

  openJoinUrl(): void {
    const url = this.joinUrl();
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  openExternalUrl(): void {
    const url = this.media.current()?.source;
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  constructor() {
    this.router.events.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(event => {
      if (event instanceof NavigationStart) {
        if (this.layout.fullscreenMediaPlayer()) {
          this.layout.fullscreenMediaPlayer.set(false);
        }
      }
    });

    if (!this.utilities.isBrowser()) {
      return;
    }

    afterNextRender(() => {
      this.registerVideoElement();
      this.setupFullscreenListener();
    });

    // Subscribe to event updates
    effect(() => {
      const event = this.media.current()?.liveEventData;
      const dTag = event?.tags.find((tag: string[]) => tag[0] === 'd')?.[1];
      const pubkey = event?.pubkey;

      if (!dTag || !pubkey) {
        if (this.eventSubscription) {
          this.eventSubscription.close();
          this.eventSubscription = null;
        }
        this.currentStreamId = null;
        return;
      }

      const uniqueId = `${pubkey}:${dTag}`;

      if (this.currentStreamId === uniqueId) return;
      this.currentStreamId = uniqueId;

      this.subscribeToEventUpdates(event!);
    });
  }

  private onFullscreenChange = (isFullscreen: boolean) => {
    console.log('[LiveStream] fullscreenChangeHandler, isFullscreen:', isFullscreen);
    this.isNativeFullscreen.set(isFullscreen);

    // Move CDK overlay container into/out of fullscreen element for menus to work
    const overlayContainerEl = this.overlayContainer.getContainerElement();
    if (isFullscreen) {
      const container = this.elementRef.nativeElement.querySelector('.live-stream-container');
      if (container && overlayContainerEl) {
        container.appendChild(overlayContainerEl);
      }
      // Start auto-hide timer when entering fullscreen - video controls will emit visibility changes
      this.videoControlsRef?.forceShowControlsAndStartTimer();
    } else {
      // Move it back to body
      if (overlayContainerEl && overlayContainerEl.parentElement !== document.body) {
        document.body.appendChild(overlayContainerEl);
      }
      // Show controls when exiting fullscreen
      this.videoControlsRef?.showControls();
    }
  };

  ngOnDestroy(): void {
    this.media.setVideoElement(undefined);
    if (this.eventSubscription) {
      this.eventSubscription.close();
    }
    if (this.fullscreenCleanup) {
      this.fullscreenCleanup();
      this.fullscreenCleanup = null;
    }
  }

  private setupFullscreenListener(): void {
    this.fullscreenCleanup = addFullscreenChangeListener(
      this.videoElement?.nativeElement,
      this.onFullscreenChange
    );
  }

  private subscribeToEventUpdates(event: Event): void {
    if (this.eventSubscription) {
      this.eventSubscription.close();
    }

    const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1];
    if (!dTag) return;

    // Get relays from event tags
    let targetRelays: string[] = [];
    const relaysTag = event.tags.find((tag: string[]) => tag[0] === 'relays');

    if (relaysTag && relaysTag.length > 1) {
      targetRelays = relaysTag.slice(1);
    } else {
      // Fallback to default relays if none specified
      targetRelays = this.utilities.preferredRelays;
    }

    const relayUrls = this.relaysService.getOptimalRelays(targetRelays);

    const filter: Filter = {
      kinds: [event.kind],
      authors: [event.pubkey],
      '#d': [dTag],
      limit: 1,
    };

    this.eventSubscription = this.relayPool.subscribe(
      relayUrls,
      filter,
      (newEvent: Event) => {
        // Update the event data in media player service if newer
        const currentEvent = this.media.current()?.liveEventData;
        if (currentEvent && newEvent.created_at > currentEvent.created_at) {
          this.media.current.update(current => {
            if (current) {
              return { ...current, liveEventData: newEvent };
            }
            return current;
          });
        }
      }
    );
  }

  registerVideoElement(): void {
    if (this.videoElement?.nativeElement) {
      this.media.setVideoElement(this.videoElement.nativeElement);
    }
  }

  onVideoError(event: ErrorEvent): void {
    const video = event.target as HTMLVideoElement;
    console.error('Live stream video error:', video.error);
  }

  toggleFullscreen(): void {
    const isExpanding = !this.layout.fullscreenMediaPlayer();
    this.layout.fullscreenMediaPlayer.set(isExpanding);

    if (isExpanding && this.liveEvent()) {
      // Expanding to fullscreen - silently update URL without navigation
      const liveEvent = this.liveEvent()!;
      const authorRelays = this.userRelaysService.getRelaysForPubkey(liveEvent.pubkey);
      const relayHint = authorRelays[0];
      const relayHints = this.utilities.normalizeRelayUrls(relayHint ? [relayHint] : []);
      const encoded = this.utilities.encodeEventForUrl(liveEvent, relayHints.length > 0 ? relayHints : undefined);
      this.location.replaceState(`/stream/${encoded}`);
    } else if (!isExpanding) {
      // Minimizing - exit native fullscreen if active
      if (isInFullscreen(this.videoElement?.nativeElement)) {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        }
      }
      // Navigate to streams page to show content
      this.router.navigate(['/streams'], { replaceUrl: true });
    }
  }

  toggleChatVisibility(): void {
    this.chatVisible.update(v => !v);
  }

  toggleStreamInfoVisibility(): void {
    this.streamInfoVisible.update(v => !v);
  }

  async pictureInPicture(): Promise<void> {
    await this.media.pictureInPicture();
  }

  copyEventData(): void {
    if (this.liveEvent()) {
      navigator.clipboard.writeText(JSON.stringify(this.liveEvent(), null, 2));
    }
  }

  copyEventUrl(): void {
    if (this.liveEvent()) {
      const liveEvent = this.liveEvent()!;
      const authorRelays = this.userRelaysService.getRelaysForPubkey(liveEvent.pubkey);
      const relayHint = authorRelays[0];
      const relayHints = this.utilities.normalizeRelayUrls(relayHint ? [relayHint] : []);
      const encoded = this.utilities.encodeEventForUrl(liveEvent, relayHints.length > 0 ? relayHints : undefined);
      navigator.clipboard.writeText(`https://nostria.app/stream/${encoded}`);
    }
  }

  exitStream(): void {
    // The media.exit() method now handles navigation based on fullscreen state
    this.media.exit();
  }

  onVolumeChange(value: number): void {
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.volume = value / 100;
    }
  }

  get volume(): number {
    return this.videoElement?.nativeElement ? Math.round(this.videoElement.nativeElement.volume * 100) : 100;
  }

  // Video controls integration
  onPlayPause(): void {
    if (this.media.paused) {
      this.media.resume();
    } else {
      this.media.pause();
    }
  }

  onVideoVolumeChange(volume: number): void {
    if (this.videoElement?.nativeElement) {
      this.videoElement.nativeElement.volume = volume;
      if (this.videoElement.nativeElement.muted && volume > 0) {
        this.videoElement.nativeElement.muted = false;
      }
    }
  }

  onMuteToggle(): void {
    this.media.mute();
  }

  onQualityChange(levelIndex: number): void {
    this.media.setHlsQuality(levelIndex);
  }

  async onNativeFullscreenToggle(): Promise<void> {
    const container = document.querySelector('.live-stream-container');
    const video = this.videoElement?.nativeElement;

    await fullscreenToggle(container, video);
  }

  async castToDevice(): Promise<void> {
    const video = this.videoElement?.nativeElement;
    if (!video) {
      console.log('Cast: No video element available');
      return;
    }

    const currentMedia = this.media.current();
    await this.castService.castVideoElement(
      video,
      currentMedia?.title,
      currentMedia?.artwork
    );
  }

  // Sync top overlay visibility with video controls
  onControlsVisibilityChange(visible: boolean): void {
    // In expanded or fullscreen mode, sync the top overlay with video controls
    if (!this.footer()) {
      this.cursorHidden.set(!visible);
    }
  }

  // Methods to trigger controls visibility from parent container hover
  onVideoContainerMouseEnter(): void {
    this.videoControlsRef?.showControlsAndStartTimer();
  }

  onVideoContainerMouseLeave(): void {
    // Let video controls handle auto-hide timing
    // The visibility change event will sync top overlay
    if (!this.footer() && !this.media.paused) {
      this.videoControlsRef?.hideControls();
    }
  }

  onVideoContainerMouseMove(): void {
    // Let video controls handle visibility and timing
    // The visibility change event will sync top overlay
    this.videoControlsRef?.showControlsAndStartTimer();
  }
}
