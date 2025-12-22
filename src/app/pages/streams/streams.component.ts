import { Component, inject, signal, computed, OnDestroy } from '@angular/core';

import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { Event, Filter } from 'nostr-tools';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { UtilitiesService } from '../../services/utilities.service';
import { ReportingService } from '../../services/reporting.service';
import { LiveEventComponent } from '../../components/event-types/live-event.component';
import { StreamingAppsDialogComponent } from './streaming-apps-dialog/streaming-apps-dialog.component';

@Component({
  selector: 'app-streams',
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatTabsModule,
    MatCardModule,
    LiveEventComponent
  ],
  templateUrl: './streams.component.html',
  styleUrl: './streams.component.scss',
})
export class StreamsComponent implements OnDestroy {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private reporting = inject(ReportingService);
  private dialog = inject(MatDialog);

  liveStreams = signal<Event[]>([]);
  plannedStreams = signal<Event[]>([]);
  endedStreams = signal<Event[]>([]);
  loading = signal(true);
  selectedTabIndex = signal(0);

  private subscription: { close: () => void } | null = null;
  private eventMap = new Map<string, Event>();

  // Computed signals for filtering
  currentStreams = computed(() => {
    const index = this.selectedTabIndex();
    if (index === 0) return this.liveStreams();
    if (index === 1) return this.plannedStreams();
    return this.endedStreams();
  });

  hasStreams = computed(() => {
    return (
      this.liveStreams().length > 0 ||
      this.plannedStreams().length > 0 ||
      this.endedStreams().length > 0
    );
  });

  constructor() {
    this.startLiveSubscription();
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.close();
    }
  }

  openStreamingAppsDialog(): void {
    this.dialog.open(StreamingAppsDialogComponent, {
      width: '600px',
      maxWidth: '95vw'
    });
  }

  private startLiveSubscription(): void {
    const relayUrls = this.relaysService.getOptimalRelays(
      this.utilities.preferredRelays
    );

    if (relayUrls.length === 0) {
      console.warn('No relays available for loading streams');
      this.loading.set(false);
      return;
    }

    const filter: Filter = {
      kinds: [30311],
      limit: 100,
    };

    // Set a timeout to stop loading even if no events arrive
    const loadingTimeout = setTimeout(() => {
      if (this.loading()) {
        console.log('[Streams] No events received within timeout, stopping loading state');
        this.loading.set(false);
      }
    }, 5000); // 5 second timeout

    this.subscription = this.pool.subscribe(
      relayUrls,
      filter,
      (event: Event) => {
        // Use d-tag + pubkey as unique identifier for replaceable events (kind:30311)
        const dTag = event.tags.find((tag: string[]) => tag[0] === 'd')?.[1] || '';
        const uniqueId = `${event.pubkey}:${dTag}`;

        // Check if we already have this event and if the new one is newer
        const existing = this.eventMap.get(uniqueId);
        if (existing && existing.created_at >= event.created_at) {
          return; // Ignore older versions
        }

        // Store the latest version
        this.eventMap.set(uniqueId, event);

        // Update the categorized lists
        this.categorizeStreams();

        // Mark as loaded once we start receiving events
        if (this.loading()) {
          clearTimeout(loadingTimeout);
          this.loading.set(false);
        }
      }
    );
  }

  private categorizeStreams(): void {
    const live: Event[] = [];
    const planned: Event[] = [];
    const ended: Event[] = [];
    const currentTime = Math.floor(Date.now() / 1000);

    for (const event of this.eventMap.values()) {
      // Skip streams from muted/blocked users
      if (this.reporting.isUserBlocked(event.pubkey)) {
        continue;
      }

      // Skip streams that are blocked by content
      if (this.reporting.isContentBlocked(event)) {
        continue;
      }

      // TODO: Remove when the spam is gone.
      // Skip spam streams with known spam tags
      const tTags = event.tags.filter((tag: string[]) => tag[0] === 't').map((tag: string[]) => tag[1]?.toLowerCase());
      if (tTags.includes('burnerstreams')) {
        continue;
      }

      const statusTag = event.tags.find((tag: string[]) => tag[0] === 'status');
      const status = statusTag?.[1] || 'planned';

      // Check if event should be considered ended based on time
      const endsTag = event.tags.find((tag: string[]) => tag[0] === 'ends');
      const endsTime = endsTag?.[1] ? parseInt(endsTag[1], 10) : null;

      if (status === 'live') {
        // Consider live events as ended if they haven't been updated in over 1 hour
        // and have an end time that has passed
        if (endsTime && endsTime < currentTime && event.created_at < currentTime - 3600) {
          ended.push(event);
        } else {
          live.push(event);
        }
      } else if (status === 'planned') {
        planned.push(event);
      } else if (status === 'ended') {
        ended.push(event);
      }
    }

    // Sort by start time (most recent first for live/ended, soonest first for planned)
    const sortByStarts = (a: Event, b: Event, ascending = false) => {
      const aStarts = parseInt(a.tags.find(tag => tag[0] === 'starts')?.[1] || '0', 10);
      const bStarts = parseInt(b.tags.find(tag => tag[0] === 'starts')?.[1] || '0', 10);
      return ascending ? aStarts - bStarts : bStarts - aStarts;
    };

    live.sort((a, b) => sortByStarts(a, b, false));
    planned.sort((a, b) => sortByStarts(a, b, true));
    ended.sort((a, b) => sortByStarts(a, b, false));

    this.liveStreams.set(live);
    this.plannedStreams.set(planned);
    this.endedStreams.set(ended);
  }

  onTabChange(index: number): void {
    this.selectedTabIndex.set(index);
  }

  refresh(): void {
    // Clear existing data and restart subscription
    this.eventMap.clear();
    this.loading.set(true);

    if (this.subscription) {
      this.subscription.close();
    }

    this.startLiveSubscription();
  }
}
