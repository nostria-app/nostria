import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
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
import { LiveEventComponent } from '../../components/event-types/live-event.component';

@Component({
  selector: 'app-streams',
  imports: [
    CommonModule,
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatTabsModule,
    MatCardModule,
    LiveEventComponent,
  ],
  templateUrl: './streams.component.html',
  styleUrl: './streams.component.scss',
})
export class StreamsComponent {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);

  liveStreams = signal<Event[]>([]);
  plannedStreams = signal<Event[]>([]);
  endedStreams = signal<Event[]>([]);
  loading = signal(true);
  selectedTabIndex = signal(0);

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
    this.loadStreams();

    // Refresh live streams every 30 seconds
    setInterval(() => {
      this.loadStreams();
    }, 30000);
  }

  async loadStreams(): Promise<void> {
    this.loading.set(true);

    try {
      // Get relay URLs from the utilities service
      const relayUrls = this.relaysService.getOptimalRelays(
        this.utilities.preferredRelays
      );

      if (relayUrls.length === 0) {
        console.warn('No relays available for loading streams');
        this.loading.set(false);
        return;
      }

      // Query for kind:30311 (Live Streaming Events)
      const filter: Filter = {
        kinds: [30311],
        limit: 100,
      };

      const events = await this.pool.query(relayUrls, filter, 5000);

      // Group events by status
      const live: Event[] = [];
      const planned: Event[] = [];
      const ended: Event[] = [];

      for (const event of events) {
        const statusTag = event.tags.find((tag: string[]) => tag[0] === 'status');
        const status = statusTag?.[1] || 'planned';

        // Check if event should be considered ended based on time
        const endsTag = event.tags.find((tag: string[]) => tag[0] === 'ends');
        const endsTime = endsTag?.[1] ? parseInt(endsTag[1], 10) : null;
        const currentTime = Math.floor(Date.now() / 1000);

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
    } catch (error) {
      console.error('Failed to load streams:', error);
    } finally {
      this.loading.set(false);
    }
  }

  onTabChange(index: number): void {
    this.selectedTabIndex.set(index);
  }

  refresh(): void {
    this.loadStreams();
  }
}
