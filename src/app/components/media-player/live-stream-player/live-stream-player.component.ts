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
} from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { LiveChatComponent } from '../../live-chat/live-chat.component';
import { StreamInfoBarComponent } from '../../stream-info-bar/stream-info-bar.component';
import { MediaPlayerService } from '../../../services/media-player.service';
import { LayoutService } from '../../../services/layout.service';
import { UtilitiesService } from '../../../services/utilities.service';

@Component({
  selector: 'app-live-stream-player',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatMenuModule,
    LiveChatComponent,
    StreamInfoBarComponent,
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

  footer = input<boolean>(false);
  chatVisible = signal(true);

  @ViewChild('videoElement', { static: false })
  videoElement?: ElementRef<HTMLVideoElement>;

  // Live stream metadata
  streamTitle = computed(() => this.media.current()?.title || 'Live Stream');
  streamStatus = computed(() => {
    const event = this.media.current()?.liveEventData;
    if (!event) return 'live';
    const statusTag = event.tags.find((tag: any) => tag[0] === 'status');
    return statusTag?.[1] || 'live';
  });

  liveEvent = computed(() => this.media.current()?.liveEventData);

  // Viewer count from live event
  viewerCount = computed(() => {
    const event = this.liveEvent();
    if (!event) return 0;
    const participantsTag = event.tags.find((tag: any) => tag[0] === 'current_participants');
    return participantsTag?.[1] ? parseInt(participantsTag[1], 10) : 0;
  });

  constructor() {
    if (!this.utilities.isBrowser()) {
      return;
    }

    afterNextRender(() => {
      this.registerVideoElement();
    });
  }

  ngOnDestroy(): void {
    this.media.setVideoElement(undefined);
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
      // Expanding to fullscreen - add stream to URL
      const encoded = this.utilities.encodeEventForUrl(this.liveEvent()!);
      this.router.navigate(['/stream', encoded], { replaceUrl: true });
    } else if (!isExpanding) {
      // Minimizing - navigate back to home or previous route
      this.router.navigate(['/'], { replaceUrl: true });
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
    this.media.exit();
    // Navigate back to home
    this.router.navigate(['/'], { replaceUrl: true });
  }
}
