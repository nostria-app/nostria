import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { MatIconModule } from '@angular/material/icon';
import { Event } from 'nostr-tools';
import { AudioPlayerComponent } from '../audio-player/audio-player.component';
import { CommentsListComponent } from '../comments-list/comments-list.component';

@Component({
  selector: 'app-audio-event',
  imports: [
    MatIconModule,
    AudioPlayerComponent,
    CommentsListComponent
],
  templateUrl: './audio-event.component.html',
  styleUrl: './audio-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioEventComponent {
  event = input.required<Event>();
  hideComments = input<boolean>(false);

  // Extract audio URL from content
  audioUrl = computed(() => {
    const event = this.event();

    // Check imeta tag first
    const imetaTag = event.tags.find(t => t[0] === 'imeta');
    if (imetaTag) {
      const urlPart = imetaTag.find(p => p.startsWith('url '));
      if (urlPart) {
        const url = urlPart.substring(4).trim();
        if (url) {
          return url;
        }
      }
    }

    // Parse content for URL
    const content = event.content;
    const match = content.match(/(https?:\/\/[^\s]+)/);
    return match ? match[0] : content;
  });

  // Extract waveform and duration from imeta tag
  imeta = computed(() => {
    const event = this.event();
    const imetaTag = event.tags.find(t => t[0] === 'imeta');
    if (!imetaTag) return null;

    const data: { waveform: number[], duration: number } = { waveform: [], duration: 0 };

    for (let i = 1; i < imetaTag.length; i++) {
      const part = imetaTag[i];
      if (part.startsWith('waveform ')) {
        data.waveform = part.substring(9).split(' ').map(Number);
      } else if (part.startsWith('duration ')) {
        data.duration = Number(part.substring(9));
      }
    }

    return data;
  });

  waveform = computed(() => this.imeta()?.waveform || []);
  duration = computed(() => this.imeta()?.duration || 0);

  // Check for content warning
  contentWarning = computed(() => {
    const event = this.event();
    const warningTag = event.tags.find(t => t[0] === 'content-warning');
    return warningTag ? warningTag[1] || 'Content Warning' : null;
  });

  hasContentWarning = computed(() => !!this.contentWarning());
}
