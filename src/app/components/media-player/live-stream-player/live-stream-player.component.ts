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
} from '@angular/core';
import { Router, NavigationStart } from '@angular/router';
import { Location } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatSliderModule } from '@angular/material/slider';
import { LiveChatComponent } from '../../live-chat/live-chat.component';
import { StreamInfoBarComponent } from '../../stream-info-bar/stream-info-bar.component';
import { VideoControlsComponent } from '../../video-controls/video-controls.component';
import { MediaPlayerService } from '../../../services/media-player.service';
import { LayoutService } from '../../../services/layout.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { RelayPoolService } from '../../../services/relays/relay-pool';
import { RelaysService } from '../../../services/relays/relays';
import { Filter, Event } from 'nostr-tools';

// Extend Window to include Hls
declare global {
  interface Window {
    Hls?: typeof import('hls.js').default;
  }
}

@Component({
  selector: 'app-live-stream-player',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatMenuModule,
    MatSliderModule,
    LiveChatComponent,
    StreamInfoBarComponent,
    VideoControlsComponent,
  ],
  templateUrl: './live-stream-player.component.html',
  styleUrl: './live-stream-player.component.scss',
  host: {
    '[class.fullscreen-mode]': 'layout.fullscreenMediaPlayer()',
    '[class.footer-mode]': 'footer()',
  },
})
export class LiveStreamPlayerComponent implements OnDestroy {
  readonly media = inject(MediaPlayerService);
  readonly layout = inject(LayoutService);
  private readonly utilities = inject(UtilitiesService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly relayPool = inject(RelayPoolService);
  private readonly relaysService = inject(RelaysService);

  footer = input<boolean>(false);
  chatVisible = signal(true);

  @ViewChild('videoElement', { static: false })
  videoElement?: ElementRef<HTMLVideoElement>;

  @ViewChild(VideoControlsComponent)
  videoControlsRef?: VideoControlsComponent;

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
    this.router.events.subscribe(event => {
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

  ngOnDestroy(): void {
    this.media.setVideoElement(undefined);
    if (this.eventSubscription) {
      this.eventSubscription.close();
    }
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
      const encoded = this.utilities.encodeEventForUrl(this.liveEvent()!);
      this.location.replaceState(`/stream/${encoded}`);
    } else if (!isExpanding) {
      // Minimizing - navigate to streams page to show content
      this.router.navigate(['/streams'], { replaceUrl: true });
    }
  }

  toggleChatVisibility(): void {
    this.chatVisible.update(v => !v);
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
      const encoded = this.utilities.encodeEventForUrl(this.liveEvent()!);
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

  async castToDevice(): Promise<void> {
    const video = this.videoElement?.nativeElement;
    if (!video) {
      console.log('Cast: No video element available');
      return;
    }

    // Use the Remote Playback API if available
    if ('remote' in video && video.remote) {
      const remote = video.remote as RemotePlayback;
      console.log('Cast: Remote playback state:', remote.state);
      
      try {
        await remote.prompt();
        console.log('Cast: Prompt successful, new state:', remote.state);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorName = error instanceof Error ? error.name : 'Unknown';
        console.log('Cast: Prompt failed -', errorName, ':', errorMessage);
      }
    } else {
      console.log('Cast: Remote Playback API not supported in this browser');
    }
  }

  // Methods to trigger controls visibility from parent container hover
  onVideoContainerMouseEnter(): void {
    this.videoControlsRef?.showControls();
  }

  onVideoContainerMouseLeave(): void {
    // Let the controls auto-hide logic handle this
  }

  onVideoContainerMouseMove(): void {
    this.videoControlsRef?.showControls();
  }
}
