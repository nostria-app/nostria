import { ArticleEventComponent } from './article-event.component';
import { AudioEventComponent } from './audio-event.component';
import { EmojiSetEventComponent } from './emoji-set-event.component';
import { LiveEventComponent } from './live-event.component';
import { MusicEventComponent } from './music-event.component';
import { PodcastEventComponent } from './podcast-event.component';
import { PodcastShowEventComponent } from './podcast-show-event.component';
import { PodcastEpisodeMenuComponent } from '../podcast-episode-menu/podcast-episode-menu.component';
import { PodcastShowMenuComponent } from '../podcast-show-menu/podcast-show-menu.component';
import { PeopleSetEventComponent } from './people-set-event.component';
import { PhotoEventComponent } from './photo-event.component';
import { PlaylistEventComponent } from './playlist-event.component';
import { PollEventComponent } from './poll-event.component';
import { ProfileUpdateEventComponent } from './profile-update-event.component';
import { StarterPackEventComponent } from './starter-pack-event.component';
import { VideoEventComponent } from './video-event.component';

describe('Event type components OnPush change detection', () => {
  const components: { name: string; component: unknown }[] = [
    { name: 'ArticleEventComponent', component: ArticleEventComponent },
    { name: 'AudioEventComponent', component: AudioEventComponent },
    { name: 'EmojiSetEventComponent', component: EmojiSetEventComponent },
    { name: 'LiveEventComponent', component: LiveEventComponent },
    { name: 'MusicEventComponent', component: MusicEventComponent },
    { name: 'PodcastEventComponent', component: PodcastEventComponent },
    { name: 'PodcastShowEventComponent', component: PodcastShowEventComponent },
    { name: 'PodcastEpisodeMenuComponent', component: PodcastEpisodeMenuComponent },
    { name: 'PodcastShowMenuComponent', component: PodcastShowMenuComponent },
    { name: 'PeopleSetEventComponent', component: PeopleSetEventComponent },
    { name: 'PhotoEventComponent', component: PhotoEventComponent },
    { name: 'PlaylistEventComponent', component: PlaylistEventComponent },
    { name: 'PollEventComponent', component: PollEventComponent },
    { name: 'ProfileUpdateEventComponent', component: ProfileUpdateEventComponent },
    { name: 'StarterPackEventComponent', component: StarterPackEventComponent },
    { name: 'VideoEventComponent', component: VideoEventComponent },
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
