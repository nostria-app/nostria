import { Component, OnInit, inject, PLATFORM_ID, TransferState } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MediaPlayerService } from '../../services/media-player.service';
import { LayoutService } from '../../services/layout.service';
import { UtilitiesService } from '../../services/utilities.service';
import { FeedService } from '../../services/feed.service';
import { MetaService } from '../../services/meta.service';
import { RelaysService } from '../../services/relays/relays';
import { Event } from 'nostr-tools';
import { STREAM_STATE_KEY, StreamData } from '../../stream-resolver';
import { isPlatformServer, isPlatformBrowser } from '@angular/common';

@Component({
  selector: 'app-stream-viewer',
  imports: [],
  template: `
    @if (loading) {
      <div class="loading-container">
        <p i18n="@@stream-viewer.loading">Loading stream...</p>
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
  private metaService = inject(MetaService);
  private transferState = inject(TransferState);
  private platformId = inject(PLATFORM_ID);
  private relaysService = inject(RelaysService);

  loading = false;

  constructor() {
    console.log('[StreamViewer] ===== CONSTRUCTOR CALLED =====');
    console.log('[StreamViewer] Constructor - isPlatformServer:', isPlatformServer(this.platformId));
  }

  async ngOnInit(): Promise<void> {
    console.log('[StreamViewer] ngOnInit called - START');
    console.log('[StreamViewer] isPlatformServer:', isPlatformServer(this.platformId));
    console.log('[StreamViewer] isPlatformBrowser:', isPlatformBrowser(this.platformId));

    const encodedEvent = this.route.snapshot.paramMap.get('encodedEvent');
    console.log('[StreamViewer] Encoded event:', encodedEvent?.substring(0, 50));

    if (!encodedEvent) {
      console.warn('[StreamViewer] No encoded event in URL');
      // Only navigate on browser
      if (isPlatformBrowser(this.platformId)) {
        this.router.navigate(['/streams']);
      }
      return;
    }

    const eventPointer = this.utilities.decodeEventFromUrl(encodedEvent);

    if (!eventPointer) {
      console.error('[StreamViewer] Failed to decode event from URL');
      // Only navigate on browser
      if (isPlatformBrowser(this.platformId)) {
        this.router.navigate(['/streams']);
      }
      return;
    }

    console.log('[StreamViewer] Event pointer decoded:', eventPointer);

    // Fetch the event from relays
    this.loading = true;

    try {
      console.log('[StreamViewer] Calling fetchEventFromRelays...');
      let event: Event | null;

      // Check if it's an naddr (kind + pubkey + identifier) or nevent (id)
      if (eventPointer.kind && eventPointer.identifier !== undefined) {
        // It's an naddr - fetch by kind, pubkey, and d-tag
        event = await this.fetchEventByAddress(
          eventPointer.kind,
          eventPointer.author!,
          eventPointer.identifier,
          eventPointer.relays
        );
      } else if (eventPointer.id) {
        // It's a nevent - fetch by ID
        event = await this.fetchEventFromRelays(eventPointer.id, eventPointer.relays);
      } else {
        console.error('[StreamViewer] Invalid event pointer format');
        if (isPlatformBrowser(this.platformId)) {
          this.router.navigate(['/streams']);
        }
        return;
      }

      if (!event) {
        console.error('[StreamViewer] Event not found');
        // Only navigate on browser
        if (isPlatformBrowser(this.platformId)) {
          this.router.navigate(['/streams']);
        }
        return;
      }

      console.log('[StreamViewer] Event fetched successfully:', event);

      // If on server, set meta tags for SSR
      if (isPlatformServer(this.platformId)) {
        console.log('[StreamViewer SSR] Setting meta tags...');
        this.setMetaTags(event, encodedEvent);
        this.loading = false;
      }

      // Only load stream on browser
      if (isPlatformBrowser(this.platformId)) {
        // Stop loading before navigation to prevent UI staying in loading state
        this.loading = false;
        this.loadStream(event);
      }
    } catch (error) {
      console.error('[StreamViewer] Error fetching stream event:', error);
      this.loading = false;
      // Only navigate on browser
      if (isPlatformBrowser(this.platformId)) {
        this.router.navigate(['/streams']);
      }
    }

    console.log('[StreamViewer] ngOnInit called - END');
  }

  private async fetchEventByAddress(kind: number, pubkey: string, identifier: string, relayHints?: string[]): Promise<Event | null> {
    console.log('[StreamViewer] fetchEventByAddress called:', { kind, pubkey: pubkey.substring(0, 8), identifier });

    // Use relay hints if provided, otherwise use user's relays, or fall back to preferred relays
    let relaysToUse: string[];

    if (relayHints && relayHints.length > 0) {
      relaysToUse = relayHints;
      console.log('[StreamViewer] Using relay hints:', relaysToUse);
    } else {
      const userRelays = this.feed.userRelays().map(r => r.url);
      if (userRelays.length > 0) {
        relaysToUse = userRelays;
        console.log('[StreamViewer] Using user relays:', relaysToUse);
      } else {
        relaysToUse = this.relaysService.getOptimalRelays(this.utilities.preferredRelays);
        console.log('[StreamViewer] Using preferred relays as fallback:', relaysToUse);
      }
    }

    if (relaysToUse.length === 0) {
      console.error('[StreamViewer] No relays available for fetching event');
      return null;
    }

    const { SimplePool } = await import('nostr-tools/pool');
    const pool = new SimplePool();

    try {
      console.log('[StreamViewer] Fetching event from relays...');
      // Fetch by kind, author, and d-tag for replaceable events
      const event = await pool.get(relaysToUse, {
        kinds: [kind],
        authors: [pubkey],
        '#d': [identifier],
      });
      pool.close(relaysToUse);
      console.log('[StreamViewer] Event fetched:', event ? 'success' : 'not found');
      return event;
    } catch (error) {
      console.error('[StreamViewer] Error fetching event by address:', error);
      pool.close(relaysToUse);
      return null;
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
    console.log('[StreamViewer] loadStream called with event:', event.id);

    // Check stream status
    const statusTag = event.tags.find(tag => tag[0] === 'status');
    const status = statusTag?.[1] || 'planned';

    console.log('[StreamViewer] Stream status:', status);

    // If stream has ended, navigate to event details instead
    if (status === 'ended') {
      console.log('[StreamViewer] Stream has ended, redirecting to event details');
      this.router.navigate(['/e', event.id]);
      return;
    }

    // Extract stream information
    const titleTag = event.tags.find(tag => tag[0] === 'title');
    const streamingTag = event.tags.find(tag => tag[0] === 'streaming');
    const imageTag = event.tags.find(tag => tag[0] === 'image');

    const title = titleTag?.[1] || 'Live Stream';
    const streamUrl = streamingTag?.[1];
    const thumbnail = imageTag?.[1];

    console.log('[StreamViewer] Stream URL:', streamUrl);

    if (!streamUrl) {
      console.error('No streaming URL found in event');
      // For planned or ended streams without URL, show event details
      this.router.navigate(['/e', event.id]);
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

      // Ensure the stream starts playing after entering fullscreen
      // This helps with browser autoplay policies when opening stream URLs directly
      setTimeout(() => {
        if (this.media.paused) {
          this.media.resume();
        }
      }, 500);
    }, 100);
  }

  private setMetaTags(event: Event, encodedEvent: string): void {
    const titleTag = event.tags.find((tag: string[]) => tag[0] === 'title');
    const summaryTag = event.tags.find((tag: string[]) => tag[0] === 'summary');
    const imageTag = event.tags.find((tag: string[]) => tag[0] === 'image');

    const title = titleTag?.[1] || 'Live Stream';
    const description = summaryTag?.[1] || 'Watch this live stream on Nostria';
    const image = imageTag?.[1];

    console.log('[StreamViewer SSR] Setting meta tags:');
    console.log('[StreamViewer SSR]   Title:', title);
    console.log('[StreamViewer SSR]   Description:', description);
    console.log('[StreamViewer SSR]   Image:', image);

    this.metaService.updateSocialMetadata({
      title,
      description,
      image: image || '/assets/nostria-social.jpg',
      url: `https://nostria.app/stream/${encodedEvent}`,
    });

    console.log('[StreamViewer SSR] Meta tags updated');
  }
}
