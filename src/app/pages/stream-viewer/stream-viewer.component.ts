import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MediaPlayerService } from '../../services/media-player.service';
import { LayoutService } from '../../services/layout.service';
import { UtilitiesService } from '../../services/utilities.service';
import { FeedService } from '../../services/feed.service';
import { Event } from 'nostr-tools';

@Component({
  selector: 'app-stream-viewer',
  imports: [],
  template: `
    @if (loading) {
      <div class="loading-container">
        <p>Loading stream...</p>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }
    .loading-container {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      font-size: 1.2rem;
      opacity: 0.7;
    }
  `]
})
export class StreamViewerComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private media = inject(MediaPlayerService);
  private layout = inject(LayoutService);
  private utilities = inject(UtilitiesService);
  private feed = inject(FeedService);

  loading = false;

  async ngOnInit(): Promise<void> {
    const encodedEvent = this.route.snapshot.paramMap.get('encodedEvent');

    if (!encodedEvent) {
      // No event data, redirect to streams page
      this.router.navigate(['/streams']);
      return;
    }

    const eventPointer = this.utilities.decodeEventFromUrl(encodedEvent);

    if (!eventPointer) {
      console.error('Failed to decode nevent from URL');
      this.router.navigate(['/streams']);
      return;
    }

    // Fetch the event from relays
    this.loading = true;

    try {
      const event = await this.fetchEventFromRelays(eventPointer.id, eventPointer.relays);

      if (!event) {
        console.error('Failed to fetch event from relays');
        this.router.navigate(['/streams']);
        return;
      }

      this.loadStream(event);
    } catch (error) {
      console.error('Error fetching stream event:', error);
      this.router.navigate(['/streams']);
    } finally {
      this.loading = false;
    }
  }

  private async fetchEventFromRelays(eventId: string, relayHints?: string[]): Promise<Event | null> {
    // Use relay hints if provided, otherwise use user's relays
    const relaysToUse = relayHints && relayHints.length > 0
      ? relayHints
      : this.feed.userRelays().map(r => r.url);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null);
      }, 10000); // 10 second timeout

      // Use FeedService's internal relay subscription mechanism
      // We'll need to access the relay service differently
      // For now, let's use a simpler approach with direct relay connection
      this.fetchEventDirectly(eventId, relaysToUse).then(event => {
        clearTimeout(timeout);
        resolve(event);
      });
    });
  }

  private async fetchEventDirectly(eventId: string, relays: string[]): Promise<Event | null> {
    // Simple pool-based fetch
    const { SimplePool } = await import('nostr-tools/pool');
    const pool = new SimplePool();

    try {
      const event = await pool.get(relays, { ids: [eventId] });
      pool.close(relays);
      return event;
    } catch (error) {
      console.error('Error fetching event:', error);
      pool.close(relays);
      return null;
    }
  }

  private loadStream(event: Event): void {
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

    // Enter fullscreen mode after a short delay to ensure media is loaded
    setTimeout(() => {
      this.layout.fullscreenMediaPlayer.set(true);
    }, 100);
  }
}
