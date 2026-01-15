import { Component, inject, signal, computed, OnDestroy, OnInit, ViewChild, TemplateRef } from '@angular/core';

import { MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatMenuModule } from '@angular/material/menu';
import { Event, Filter } from 'nostr-tools';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { AccountRelayService } from '../../services/relays/account-relay';
import { UtilitiesService } from '../../services/utilities.service';
import { ReportingService } from '../../services/reporting.service';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { DatabaseService } from '../../services/database.service';
import { TwoColumnLayoutService } from '../../services/two-column-layout.service';
import { PanelActionsService } from '../../services/panel-actions.service';
import { LiveEventComponent } from '../../components/event-types/live-event.component';
import { StreamingAppsDialogComponent } from './streaming-apps-dialog/streaming-apps-dialog.component';
import { StreamsSettingsDialogComponent } from './streams-settings-dialog/streams-settings-dialog.component';

@Component({
  selector: 'app-streams',
  imports: [
    MatProgressSpinnerModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatTabsModule,
    MatCardModule,
    MatMenuModule,
    LiveEventComponent,
    StreamsSettingsDialogComponent,
  ],
  templateUrl: './streams.component.html',
  styleUrl: './streams.component.scss',
})
export class StreamsComponent implements OnInit, OnDestroy {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private accountRelay = inject(AccountRelayService);
  private utilities = inject(UtilitiesService);
  private reporting = inject(ReportingService);
  private dialog = inject(MatDialog);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private database = inject(DatabaseService);
  private twoColumnLayout = inject(TwoColumnLayoutService);
  private panelActions = inject(PanelActionsService);

  // Template refs for panel header content
  @ViewChild('headerActionsMenuTemplate') headerActionsMenuTemplate!: TemplateRef<unknown>;

  liveStreams = signal<Event[]>([]);
  plannedStreams = signal<Event[]>([]);
  endedStreams = signal<Event[]>([]);
  loading = signal(true);
  selectedTabIndex = signal(0);
  showSettingsDialog = signal(false);

  // Streams relay set state
  streamsRelaySet = signal<Event | null>(null);
  streamsRelays = signal<string[]>([]);

  // Relay set constants
  private readonly RELAY_SET_KIND = 30002;
  private readonly STREAMS_RELAY_SET_D_TAG = 'streams';

  // Current user pubkey
  private currentPubkey = computed(() => this.accountState.pubkey());
  isAuthenticated = computed(() => this.app.authenticated());

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
    this.initializeStreams();
  }

  ngOnInit(): void {
    // Setup panel header actions
    this.setupPanelActions();
  }

  /**
   * Setup panel header actions for the column toolbar
   */
  private setupPanelActions(): void {
    const actions = [
      {
        id: 'refresh',
        icon: 'refresh',
        label: 'Refresh',
        tooltip: 'Refresh streams',
        action: () => this.refresh(),
        disabled: this.loading(),
      },
      {
        id: 'more',
        icon: 'more_vert',
        label: 'More options',
        tooltip: 'More options',
        action: () => { }, // Menu trigger handled by template
        menu: true,
      },
    ];

    this.panelActions.setLeftPanelActions(actions);

    // Set up menu template after view init
    setTimeout(() => {
      if (this.headerActionsMenuTemplate) {
        this.panelActions.setLeftPanelMenuTemplate(this.headerActionsMenuTemplate);
      }
    });
  }

  /**
   * Initialize streams by first loading relay set, then starting subscriptions
   */
  private async initializeStreams(): Promise<void> {
    await this.loadStreamsRelaySet();
    this.startLiveSubscription();
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.close();
    }
    // Clear panel actions when component is destroyed
    this.panelActions.clearLeftPanelActions();
  }

  /**
   * Pre-load the user's streams relay set (kind 30002 with d tag "streams")
   * First checks the local database, then fetches from relays and persists
   */
  private async loadStreamsRelaySet(): Promise<void> {
    const pubkey = this.currentPubkey();
    if (!pubkey) return;

    try {
      // First, try to load from local database for immediate use
      const cachedEvent = await this.database.getParameterizedReplaceableEvent(
        pubkey,
        this.RELAY_SET_KIND,
        this.STREAMS_RELAY_SET_D_TAG
      );

      if (cachedEvent) {
        console.log('[Streams] Loaded relay set from database:', cachedEvent);
        this.streamsRelaySet.set(cachedEvent);
        const relays = cachedEvent.tags
          .filter((tag: string[]) => tag[0] === 'relay' && tag[1])
          .map((tag: string[]) => tag[1]);
        this.streamsRelays.set(relays);
      }

      // Then fetch from relays to get the latest version
      const accountRelays = this.accountRelay.getRelayUrls();
      const relayUrls = this.relaysService.getOptimalRelays(accountRelays);
      if (relayUrls.length === 0) return;

      const filter: Filter = {
        kinds: [this.RELAY_SET_KIND],
        authors: [pubkey],
        '#d': [this.STREAMS_RELAY_SET_D_TAG],
        limit: 1,
      };

      let foundEvent: Event | null = null;

      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 3000);
        const sub = this.pool.subscribe(relayUrls, filter, (event: Event) => {
          if (!foundEvent || event.created_at > foundEvent.created_at) {
            foundEvent = event;
          }
        });

        setTimeout(() => {
          sub.close();
          clearTimeout(timeout);
          resolve();
        }, 2000);
      });

      if (foundEvent) {
        const event = foundEvent as Event;
        // Only update if newer than cached
        if (!cachedEvent || event.created_at > cachedEvent.created_at) {
          console.log('[Streams] Found newer relay set from relays, updating...');
          this.streamsRelaySet.set(event);
          const relays = event.tags
            .filter((tag: string[]) => tag[0] === 'relay' && tag[1])
            .map((tag: string[]) => tag[1]);
          this.streamsRelays.set(relays);

          // Persist to database
          const dTag = event.tags.find((t: string[]) => t[0] === 'd')?.[1];
          await this.database.saveEvent({ ...event, dTag });
          console.log('[Streams] Saved relay set to database');
        }
      }
    } catch (error) {
      console.error('Error loading streams relay set:', error);
    }
  }

  openStreamingAppsDialog(): void {
    this.dialog.open(StreamingAppsDialogComponent, {
      // width: '600px',
      // maxWidth: '95vw'
    });
  }

  private startLiveSubscription(): void {
    // Get the user's account relays directly (no fallback)
    const accountRelays = this.accountRelay.getRelayUrls();

    // Combine with streams-specific relays from the user's relay set
    const customStreamsRelays = this.streamsRelays();
    const allRelayUrls = [...new Set([...accountRelays, ...customStreamsRelays])];

    console.log('[Streams] Account relays:', accountRelays);
    console.log('[Streams] Custom streams relays:', customStreamsRelays);
    console.log('[Streams] All relays:', allRelayUrls);

    if (allRelayUrls.length === 0) {
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
      allRelayUrls,
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

  openSettings(): void {
    this.showSettingsDialog.set(true);
  }

  async onSettingsDialogClosed(result: { saved: boolean } | null): Promise<void> {
    this.showSettingsDialog.set(false);
    if (result?.saved) {
      // Reload the streams relay set and restart subscription with new relays
      await this.loadStreamsRelaySet();
      this.refresh();
    }
  }
}
