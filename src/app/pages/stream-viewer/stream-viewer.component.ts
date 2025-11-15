import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Event } from 'nostr-tools';
import { MediaPlayerService } from '../../services/media-player.service';
import { LayoutService } from '../../services/layout.service';
import { MediaPlayerComponent } from '../../components/media-player/media-player.component';

@Component({
  selector: 'app-stream-viewer',
  imports: [MediaPlayerComponent],
  template: `
    @if (streamLoaded) {
      <app-media-player [footer]="true" />
    }
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }
  `]
})
export class StreamViewerComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private media = inject(MediaPlayerService);
  private layout = inject(LayoutService);

  streamLoaded = false;

  ngOnInit(): void {
    const encodedEvent = this.route.snapshot.paramMap.get('encodedEvent');

    if (!encodedEvent) {
      // No event data, redirect to streams page
      this.router.navigate(['/streams']);
      return;
    }

    try {
      // Decode the event data
      const eventJson = atob(encodedEvent);
      const event: Event = JSON.parse(eventJson);

      // Extract stream information
      const titleTag = event.tags.find(tag => tag[0] === 'title');
      const streamingTag = event.tags.find(tag => tag[0] === 'streaming');
      const imageTag = event.tags.find(tag => tag[0] === 'image');

      const title = titleTag?.[1] || 'Live Stream';
      const streamUrl = streamingTag?.[1];
      const thumbnail = imageTag?.[1];

      if (!streamUrl) {
        console.error('No streaming URL found in event');
        this.router.navigate(['/streams']);
        return;
      }

      // Load the stream into media player
      this.media.play({
        title,
        artist: 'Live Stream',
        artwork: thumbnail || '',
        type: 'HLS',
        source: streamUrl,
        isLiveStream: true,
        liveEventData: event,
      });

      this.streamLoaded = true;

      // Enter fullscreen mode after a short delay to ensure media is loaded
      setTimeout(() => {
        this.layout.fullscreenMediaPlayer.set(true);
      }, 100);

    } catch (error) {
      console.error('Error decoding stream data:', error);
      this.router.navigate(['/streams']);
    }
  }
}
