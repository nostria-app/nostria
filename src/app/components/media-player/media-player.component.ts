import {
  Component,
  inject,
  computed,
  input,
} from '@angular/core';
import { LiveStreamPlayerComponent } from './live-stream-player/live-stream-player.component';
import { AudioPlayerComponent } from './audio-player/audio-player.component';
import { VideoPlayerComponent } from './video-player/video-player.component';
import { YouTubePlayerComponent } from './youtube-player/youtube-player.component';
import { LayoutService } from '../../services/layout.service';
import { MediaPlayerService } from '../../services/media-player.service';

@Component({
  selector: 'app-media-player',
  imports: [
    LiveStreamPlayerComponent,
    AudioPlayerComponent,
    VideoPlayerComponent,
    YouTubePlayerComponent,
  ],
  templateUrl: './media-player.component.html',
  styleUrl: './media-player.component.scss',
  host: {
    '[class.footer-mode]': 'footer()',
    '[class.fullscreen-host]': 'layout.fullscreenMediaPlayer()',
  },
})
export class MediaPlayerComponent {
  readonly layout = inject(LayoutService);
  readonly media = inject(MediaPlayerService);
  footer = input<boolean>(false);

  // Computed signals to determine which player to show
  isLiveStream = computed(() => this.media.current()?.type === 'HLS' && this.media.current()?.isLiveStream);
  isYouTube = computed(() => this.media.current()?.type === 'YouTube');
  isVideo = computed(() => this.media.current()?.type === 'Video' || (this.media.current()?.type === 'HLS' && !this.media.current()?.isLiveStream));
  isAudio = computed(() => this.media.current()?.type === 'Music' || this.media.current()?.type === 'Podcast');
}
