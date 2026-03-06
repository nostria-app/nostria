import { ArticleEventComponent } from './article-event.component';
import { AudioEventComponent } from './audio-event.component';
import { EmojiSetEventComponent } from './emoji-set-event.component';
import { LiveEventComponent } from './live-event.component';
import { MusicEventComponent } from './music-event.component';
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
