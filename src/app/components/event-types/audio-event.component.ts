import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Event } from 'nostr-tools';
import { AudioPlayerComponent } from '../audio-player/audio-player.component';
import { CommentsListComponent } from '../comments-list/comments-list.component';
import { ContentComponent } from '../content/content.component';
import { ParsingService } from '../../services/parsing.service';

@Component({
  selector: 'app-audio-event',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    AudioPlayerComponent,
    CommentsListComponent,
    ContentComponent
  ],
  templateUrl: './audio-event.component.html',
  styleUrl: './audio-event.component.scss',
})
export class AudioEventComponent {
  event = input.required<Event>();
  hideComments = input<boolean>(false);

  private parsingService = inject(ParsingService);

  // Extract audio URL from content
  audioUrl = computed(() => {
    const event = this.event();

    // Check imeta tag first
    const imetaTag = event.tags.find(t => t[0] === 'imeta');
    if (imetaTag) {
      const urlPart = imetaTag.find(p => p.startsWith('url '));
      if (urlPart) {
        return urlPart.substring(4);
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

  // Description might be in 'alt' tag or maybe we don't have one for audio clips usually?
  // NIP-A0 doesn't specify a description field other than content being the URL.
  // But maybe there is an 'alt' tag.
  description = computed(() => {
    const event = this.event();
    const altTag = event.tags.find(t => t[0] === 'alt');
    return altTag ? altTag[1] : null;
  });
}
