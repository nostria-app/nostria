import { MediaPlayerComponent } from './media-player.component';
import { LiveStreamPlayerComponent } from './live-stream-player/live-stream-player.component';
import { VideoPlayerComponent } from './video-player/video-player.component';
import { YouTubePlayerComponent } from './youtube-player/youtube-player.component';
import { AudioPlayerComponent } from './audio-player/audio-player.component';
import { PlaylistDrawerComponent } from './audio-player/playlist-drawer/playlist-drawer.component';
import { WinampPlayerViewComponent } from './audio-player/winamp-player-view/winamp-player-view.component';
import { CardsPlayerViewComponent } from './audio-player/cards-player-view/cards-player-view.component';
import { ModernPlayerViewComponent } from './audio-player/modern-player-view/modern-player-view.component';
import { LyricsViewComponent } from './audio-player/lyrics-view/lyrics-view.component';
import { CircularProgressComponent } from './audio-player/circular-progress/circular-progress.component';

describe('Media player components OnPush change detection', () => {
  const components: { name: string; component: unknown }[] = [
    { name: 'MediaPlayerComponent', component: MediaPlayerComponent },
    { name: 'LiveStreamPlayerComponent', component: LiveStreamPlayerComponent },
    { name: 'VideoPlayerComponent', component: VideoPlayerComponent },
    { name: 'YouTubePlayerComponent', component: YouTubePlayerComponent },
    { name: 'AudioPlayerComponent', component: AudioPlayerComponent },
    { name: 'PlaylistDrawerComponent', component: PlaylistDrawerComponent },
    { name: 'WinampPlayerViewComponent', component: WinampPlayerViewComponent },
    { name: 'CardsPlayerViewComponent', component: CardsPlayerViewComponent },
    { name: 'ModernPlayerViewComponent', component: ModernPlayerViewComponent },
    { name: 'LyricsViewComponent', component: LyricsViewComponent },
    { name: 'CircularProgressComponent', component: CircularProgressComponent },
  ];

  for (const { name, component } of components) {
    it(`${name} should use ChangeDetectionStrategy.OnPush`, () => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const cmp = (component as any).ɵcmp;
      expect(cmp).toBeTruthy();
      expect(cmp.onPush).toBe(true);
      /* eslint-enable @typescript-eslint/no-explicit-any */
    });
  }
});
