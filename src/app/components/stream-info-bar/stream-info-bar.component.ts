import { Component, computed, input, inject, signal, effect, OnDestroy, ElementRef, ViewChild } from '@angular/core';
import { Event, Filter } from 'nostr-tools';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterModule } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { ZapDialogComponent, ZapDialogData } from '../zap-dialog/zap-dialog.component';
import { DataService } from '../../services/data.service';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { UtilitiesService } from '../../services/utilities.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { IgdbService, GameData } from '../../services/igdb.service';
import { GameHoverCardService } from '../../services/game-hover-card.service';

@Component({
  selector: 'app-stream-info-bar',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatChipsModule,
    MatBadgeModule,
    MatProgressBarModule,
    RouterModule,
    UserProfileComponent,
  ],
  template: `
    <div class="stream-info-bar">
      <div class="stream-header">
        <div class="stream-title-section">
          <h2 class="stream-title">{{ title() }}</h2>
          <div class="stream-meta">
            <app-user-profile [pubkey]="streamerPubkey()" />
            <span class="separator">•</span>
            <div class="live-badge">
              <span class="live-text">LIVE</span>
            </div>
            <span class="viewer-count-badge">{{ viewerCount() }} viewers</span>
            <span class="time-badge">{{ elapsedTime() }}</span>
            @if (streamProvider()) {
            <span class="separator">•</span>
            <a [href]="streamProviderUrl()" target="_blank" rel="noopener noreferrer" class="provider-link">
              <mat-icon>podcasts</mat-icon>
              {{ streamProvider() }}
            </a>
            }
          </div>
        </div>
        
        <div class="stream-actions">
          <button 
            mat-flat-button 
            class="zap-button"
            (click)="openZapDialog()"
            matTooltip="Send zap to streamer">
            <mat-icon>bolt</mat-icon>
            Zap
          </button>
        </div>
      </div>
      
      @if (description()) {
      <div class="stream-description">
        {{ description() }}
      </div>
      }

      @if (zapGoalAmount() > 0) {
      <div class="zap-goal">
        <div class="zap-goal-header">
          <span class="zap-goal-label">
            <mat-icon>bolt</mat-icon>
            Zap Goal: {{ formatSats(zapGoalAmount()) }}
          </span>
          <span class="zap-goal-progress">{{ formatSats(currentZapAmount()) }} / {{ formatSats(zapGoalAmount()) }}</span>
        </div>
        <mat-progress-bar 
          mode="determinate" 
          [value]="zapGoalProgress()"
          class="zap-goal-bar">
        </mat-progress-bar>
      </div>
      }
      
      @if (tags().length > 0) {
      <div class="stream-tags">
        <mat-chip-set>
          @for (tag of tags(); track tag) {
          <mat-chip>{{ tag }}</mat-chip>
          }
        </mat-chip-set>
      </div>
      }

      <!-- Game Info Section -->
      @if (gameData()) {
      @let game = gameData()!;
      <div class="game-section" #gameCover
           (mouseenter)="onGameCoverHover(gameCover)" 
           (mouseleave)="onGameCoverLeave()">
        @if (gameCoverUrl()) {
        <img [src]="gameCoverUrl()" [alt]="game.name" title="{{ game.name }}" class="game-cover-image" />
        }
        <div class="game-info">
          <span class="game-label">
            <mat-icon>sports_esports</mat-icon>
            Playing
          </span>
          <span class="game-name">{{ game.name }}</span>
          @if (gameGenres()) {
          <span class="game-genres">{{ gameGenres() }}</span>
          }
        </div>
      </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }

    .stream-info-bar {
      container-type: inline-size;
      background: var(--mat-sys-surface-container);
      border-top: 1px solid var(--mat-sys-outline-variant);
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .stream-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      flex-wrap: wrap;
    }

    .stream-title-section {
      flex: 1;
      min-width: 0;
      width: 100%;
    }

    .stream-title {
      margin: 0 0 8px 0;
      font-size: 1.5rem;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .stream-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 0.875rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .separator {
      opacity: 0.5;
    }

    .live-badge {
      background: var(--mat-sys-error);
      color: #fff;
      padding: 4px 8px;
      border-radius: 4px;
      font-weight: 700;
      font-size: 0.75rem;
      letter-spacing: 0.5px;
    }

    .viewer-count-badge,
    .time-badge {
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface);
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .provider-link {
      display: flex;
      align-items: center;
      gap: 4px;
      color: var(--mat-sys-on-surface-variant);
      text-decoration: none;
      transition: color 0.2s;
      
      &:hover {
        color: var(--mat-sys-primary);
      }

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }

    .stream-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .zap-button {
      background: linear-gradient(135deg, #ffd700 0%, #ffed4e 100%);
      color: #000;
      font-weight: 600;
      
      mat-icon {
        margin-right: 4px;
      }

      &:hover {
        background: linear-gradient(135deg, #ffed4e 0%, #ffd700 100%);
      }
    }

    .stream-description {
      font-size: 0.875rem;
      line-height: 1.5;
      color: var(--mat-sys-on-surface);
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .zap-goal {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .zap-goal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.875rem;
    }

    .zap-goal-label {
      display: flex;
      align-items: center;
      gap: 4px;
      font-weight: 600;
      color: var(--mat-sys-on-surface);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: #ffd700;
      }
    }

    .zap-goal-progress {
      font-weight: 600;
      color: var(--mat-sys-on-surface-variant);
    }

    .zap-goal-bar {
      height: 8px;
      border-radius: 4px;
      
      ::ng-deep .mdc-linear-progress__bar-inner {
        border-color: #ffd700 !important;
      }
    }

    .stream-tags {
      mat-chip-set {
        --mdc-chip-container-height: 28px;
      }
      
      mat-chip {
        font-size: 0.75rem;
      }
    }

    .game-section {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
      background: var(--mat-sys-surface-container-high);
      border-radius: 12px;
      cursor: pointer;
      transition: background 0.2s ease;

      &:hover {
        background: var(--mat-sys-surface-container-highest);
      }

      .game-cover-image {
        width: 48px;
        height: 64px;
        object-fit: cover;
        border-radius: 6px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
      }

      .game-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .game-label {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.75rem;
        color: var(--mat-sys-on-surface-variant);
        text-transform: uppercase;
        letter-spacing: 0.5px;

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
          color: var(--mat-sys-primary);
        }
      }

      .game-name {
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--mat-sys-on-surface);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .game-genres {
        font-size: 0.75rem;
        color: var(--mat-sys-on-surface-variant);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    /* Compact mode for smaller viewports or when sidebar is visible */
    @container (max-width: 900px) {
      .stream-info-bar {
        padding: 12px 16px;
      }

      .stream-title {
        font-size: 1.1rem;
      }

      .stream-description {
        -webkit-line-clamp: 1;
        font-size: 0.8rem;
      }

      .stream-meta {
        flex-wrap: wrap;
        font-size: 0.8rem;
      }

      .viewer-count-badge,
      .time-badge {
        font-size: 0.75rem;
        padding: 2px 8px;
      }

      .live-badge {
        font-size: 0.65rem;
        padding: 3px 6px;
      }
    }

    /* Extra compact for very small spaces */
    @container (max-width: 600px) {
      .stream-info-bar {
        padding: 8px 12px;
      }

      .stream-title {
        font-size: 1rem;
      }

      .stream-description {
        display: none;
      }

      .zap-goal {
        display: none;
      }

      .provider-link {
        display: none;
      }
    }

    /* Compact mode for smaller containers */
    @container (max-width: 900px) {
      .stream-info-bar {
        padding: 12px 16px;
        gap: 10px;
      }

      .stream-title {
        font-size: 1.1rem;
      }

      .stream-description {
        -webkit-line-clamp: 1;
        font-size: 0.8rem;
      }

      .stream-meta {
        flex-wrap: wrap;
        font-size: 0.8rem;
      }

      .viewer-count-badge,
      .time-badge {
        font-size: 0.75rem;
        padding: 2px 8px;
      }

      .live-badge {
        font-size: 0.65rem;
        padding: 3px 6px;
      }
    }

    /* Extra compact for very small containers */
    @container (max-width: 600px) {
      .stream-info-bar {
        padding: 8px 12px;
        gap: 8px;
      }

      .stream-title {
        font-size: 1rem;
      }

      .stream-description {
        display: none;
      }

      .zap-goal {
        display: none;
      }

      .provider-link {
        display: none;
      }
    }

    @media (max-width: 768px) {
      .stream-info-bar {
        padding: 12px 16px;
      }

      .stream-title {
        font-size: 1.25rem;
      }

      .stream-header {
        flex-direction: column;
        align-items: stretch;
      }

      .stream-actions {
        justify-content: stretch;
        
        .zap-button {
          flex: 1;
        }
      }
    }
  `]
})
export class StreamInfoBarComponent implements OnDestroy {
  liveEvent = input.required<Event>();

  @ViewChild('gameCover') gameCoverElement?: ElementRef<HTMLElement>;

  private dialog = inject(MatDialog);
  private dataService = inject(DataService);
  private relayPool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private utilities = inject(UtilitiesService);
  private snackBar = inject(MatSnackBar);
  private igdbService = inject(IgdbService);
  private gameHoverCardService = inject(GameHoverCardService);

  // Game data for IGDB integration
  gameData = signal<GameData | null>(null);
  gameLoading = signal(false);

  // Current stream event (may be updated via subscription)
  private currentEvent = signal<Event | null>(null);
  private streamSubscription: { close: () => void } | null = null;
  private zapSubscription: { close: () => void } | null = null;
  private zapEventIds = new Set<string>();

  // Viewer count (from current_participants tag in stream event)
  viewerCount = computed(() => {
    const event = this.currentEvent() || this.liveEvent();
    const participantsTag = event.tags.find(tag => tag[0] === 'current_participants');
    return participantsTag?.[1] ? parseInt(participantsTag[1], 10) : 0;
  });

  // Elapsed time tracking
  elapsedTime = signal('00:00:00');
  private elapsedTimeInterval?: number;

  // Zap goal tracking
  zapGoalAmount = signal(0); // in sats
  currentZapAmount = signal(0); // in sats
  private zapGoalEvent = signal<Event | null>(null); // Store the full goal event
  zapGoalProgress = computed(() => {
    const goal = this.zapGoalAmount();
    if (goal === 0) return 0;
    const current = this.currentZapAmount();
    return Math.min((current / goal) * 100, 100);
  });

  // Stream title
  title = computed(() => {
    const event = this.currentEvent() || this.liveEvent();
    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return titleTag?.[1] || 'Live Stream';
  });

  // Stream description
  description = computed(() => {
    const event = this.currentEvent() || this.liveEvent();
    const summaryTag = event.tags.find(tag => tag[0] === 'summary');
    return summaryTag?.[1] || null;
  });

  // Stream provider (from event pubkey metadata)
  streamProvider = computed(() => {
    const event = this.currentEvent() || this.liveEvent();
    // Try to extract provider from service tag or determine from pubkey
    const serviceTag = event.tags.find(tag => tag[0] === 'service');
    if (serviceTag?.[1]) {
      const url = serviceTag[1];
      if (url.includes('zap.stream')) return 'zap.stream';
      // Extract domain from URL
      try {
        const domain = new URL(url).hostname;
        return domain.replace('www.', '').replace('api-', '').replace(/^ca\./, '');
      } catch {
        return null;
      }
    }
    return null;
  });

  // Stream provider URL
  streamProviderUrl = computed(() => {
    const event = this.currentEvent() || this.liveEvent();
    const serviceTag = event.tags.find(tag => tag[0] === 'service');
    if (serviceTag?.[1]) {
      const url = serviceTag[1];
      try {
        const urlObj = new URL(url);
        return `${urlObj.protocol}//${urlObj.hostname}`;
      } catch {
        return '#';
      }
    }
    return '#';
  });

  // Start time from "starts" tag
  startTime = computed(() => {
    const event = this.currentEvent() || this.liveEvent();
    const startsTag = event.tags.find(tag => tag[0] === 'starts');
    return startsTag?.[1] ? parseInt(startsTag[1], 10) : null;
  });

  // Streamer pubkey - use host p tag if available, otherwise event pubkey
  streamerPubkey = computed(() => {
    const event = this.currentEvent() || this.liveEvent();
    // Find the p tag with "host" role
    const hostTag = event.tags.find(tag => tag[0] === 'p' && tag[3] === 'host');
    return hostTag?.[1] || event.pubkey;
  });

  // Streamer npub
  streamerNpub = computed(() => {
    return this.utilities.getNpubFromPubkey(this.streamerPubkey());
  });

  // Tags
  tags = computed(() => {
    const event = this.currentEvent() || this.liveEvent();
    return event.tags
      .filter(tag => tag[0] === 't')
      .map(tag => tag[1])
      .slice(0, 5); // Limit to 5 tags
  });

  // IGDB game ID from tags
  igdbGameId = computed(() => {
    const event = this.currentEvent() || this.liveEvent();
    if (!event) return null;
    return this.igdbService.extractIgdbId(event.tags);
  });

  // Game cover URL
  gameCoverUrl = computed(() => {
    return this.igdbService.getBestCoverUrl(this.gameData(), 'medium');
  });

  // Game genres
  gameGenres = computed(() => {
    return this.igdbService.getGenreString(this.gameData());
  });

  // Event address for tracking viewers
  eventAddress = computed(() => {
    const event = this.currentEvent() || this.liveEvent();
    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
    if (!dTag) return null;
    return `${event.kind}:${event.pubkey}:${dTag}`;
  });

  constructor() {
    // Subscribe to stream updates
    effect(() => {
      const event = this.liveEvent();
      if (event) {
        this.subscribeToStreamUpdates(event);
      }
    });

    // Load game data when IGDB ID is present
    effect(() => {
      const gameId = this.igdbGameId();
      if (gameId) {
        this.loadGameData(gameId);
      } else {
        this.gameData.set(null);
      }
    });

    // Start elapsed time counter
    effect(() => {
      const startTimestamp = this.startTime();
      if (startTimestamp) {
        this.startElapsedTimeCounter(startTimestamp);
      }
    });

    // Fetch zap goal and track zaps only if goal exists
    effect(() => {
      const event = this.currentEvent() || this.liveEvent();
      const goalTag = event.tags.find(tag => tag[0] === 'goal');
      if (goalTag?.[1]) {
        this.fetchZapGoal(goalTag[1]);
      } else {
        // No goal tag, clear any existing zap tracking
        this.zapGoalEvent.set(null);
        this.zapGoalAmount.set(0);
        this.currentZapAmount.set(0);
        if (this.zapSubscription) {
          this.zapSubscription.close();
          this.zapSubscription = null;
        }
      }
    });
  }

  ngOnDestroy(): void {
    if (this.elapsedTimeInterval) {
      clearInterval(this.elapsedTimeInterval);
    }
    if (this.streamSubscription) {
      this.streamSubscription.close();
    }
    if (this.zapSubscription) {
      this.zapSubscription.close();
    }
  }

  private async loadGameData(gameId: number): Promise<void> {
    // Check if already cached
    if (this.igdbService.isGameCached(gameId)) {
      this.gameData.set(this.igdbService.getCachedGame(gameId)!);
      return;
    }

    this.gameLoading.set(true);
    try {
      const data = await this.igdbService.fetchGameData(gameId);
      this.gameData.set(data);
    } finally {
      this.gameLoading.set(false);
    }
  }

  // Game hover card methods
  onGameCoverHover(element: HTMLElement): void {
    const gameId = this.igdbGameId();
    if (gameId) {
      this.gameHoverCardService.showHoverCard(element, gameId);
    }
  }

  onGameCoverLeave(): void {
    this.gameHoverCardService.hideHoverCard();
  }

  private subscribeToStreamUpdates(event: Event): void {
    // Close existing subscription if any
    if (this.streamSubscription) {
      this.streamSubscription.close();
    }

    // Get d-tag for this stream (kind 30311 is a replaceable event)
    const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
    if (!dTag) {
      console.warn('[StreamInfoBar] No d-tag found, cannot subscribe to updates');
      return;
    }

    const relayUrls = this.relaysService.getOptimalRelays(
      this.utilities.preferredRelays
    );

    if (relayUrls.length === 0) {
      console.warn('[StreamInfoBar] No relays available for stream updates');
      return;
    }

    console.log('[StreamInfoBar] Subscribing to stream updates:', { kind: event.kind, pubkey: event.pubkey.substring(0, 8), dTag });

    // Subscribe to updates for this specific stream
    const filter: Filter = {
      kinds: [event.kind],
      authors: [event.pubkey],
      '#d': [dTag],
    };

    this.streamSubscription = this.relayPool.subscribe(
      relayUrls,
      filter,
      (updatedEvent: Event) => {
        // Only update if this event is newer than the current one
        const current = this.currentEvent() || this.liveEvent();
        if (updatedEvent.created_at > current.created_at) {
          console.log('[StreamInfoBar] Received stream update:', {
            previousTimestamp: current.created_at,
            newTimestamp: updatedEvent.created_at,
          });
          this.currentEvent.set(updatedEvent);
        }
      }
    );
  }

  private startElapsedTimeCounter(startTimestamp: number): void {
    // Clear existing interval if any
    if (this.elapsedTimeInterval) {
      clearInterval(this.elapsedTimeInterval);
    }

    // Update immediately
    this.updateElapsedTime(startTimestamp);

    // Update every second
    this.elapsedTimeInterval = window.setInterval(() => {
      this.updateElapsedTime(startTimestamp);
    }, 1000);
  }

  private updateElapsedTime(startTimestamp: number): void {
    const now = Math.floor(Date.now() / 1000);
    const elapsed = now - startTimestamp;

    const hours = Math.floor(elapsed / 3600);
    const minutes = Math.floor((elapsed % 3600) / 60);
    const seconds = elapsed % 60;

    const formatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    this.elapsedTime.set(formatted);
  }

  private async fetchZapGoal(goalEventId: string): Promise<void> {
    const relayUrls = this.relaysService.getOptimalRelays(
      this.utilities.preferredRelays
    );

    if (relayUrls.length === 0) {
      console.warn('[StreamInfoBar] No relays available for fetching zap goal');
      return;
    }

    console.log('[StreamInfoBar] Fetching zap goal:', { goalEventId: goalEventId.substring(0, 16) });

    try {
      const events = await this.relayPool.query(
        relayUrls,
        { kinds: [9041], ids: [goalEventId] },
        5000
      );

      if (events.length > 0) {
        const goalEvent = events[0];
        const amountTag = goalEvent.tags.find(tag => tag[0] === 'amount');
        if (amountTag?.[1]) {
          // Amount is in millisats, convert to sats
          const amountInSats = Math.floor(parseInt(amountTag[1]) / 1000);
          this.zapGoalAmount.set(amountInSats);
          this.zapGoalEvent.set(goalEvent);

          console.log('[StreamInfoBar] Zap goal loaded:', { goalAmount: amountInSats, goalId: goalEventId.substring(0, 16) });

          // Now start tracking zaps for this goal
          this.trackGoalZaps();
        }
      } else {
        console.warn('[StreamInfoBar] Zap goal event not found:', goalEventId);
        this.zapGoalEvent.set(null);
        this.zapGoalAmount.set(0);
      }
    } catch (error) {
      console.error('[StreamInfoBar] Error fetching zap goal:', error);
      this.zapGoalEvent.set(null);
      this.zapGoalAmount.set(0);
    }
  }

  private trackGoalZaps(): void {
    // Close existing subscription if any
    if (this.zapSubscription) {
      this.zapSubscription.close();
      this.zapSubscription = null;
    }

    const goalEvent = this.zapGoalEvent();
    if (!goalEvent) {
      console.warn('[StreamInfoBar] No goal event, cannot track zaps');
      return;
    }

    // Reset zap tracking
    this.zapEventIds.clear();
    this.currentZapAmount.set(0);

    // Get relays from the goal event's relays tag (NIP-75 requirement)
    const relaysTag = goalEvent.tags.find(tag => tag[0] === 'relays');
    let relayUrls: string[];

    if (relaysTag && relaysTag.length > 1) {
      // Use relays specified in the goal event (skip the first element which is 'relays')
      relayUrls = relaysTag.slice(1);
      console.log('[StreamInfoBar] Using relays from goal event:', relayUrls);
    } else {
      // Fallback to optimal relays if goal doesn't specify
      relayUrls = this.relaysService.getOptimalRelays(
        this.utilities.preferredRelays
      );
      console.log('[StreamInfoBar] Goal has no relay hints, using optimal relays:', relayUrls.length);
    }

    if (relayUrls.length === 0) {
      console.warn('[StreamInfoBar] No relays available for tracking zaps');
      return;
    }

    // Check for closed_at timestamp (NIP-75)
    const closedAtTag = goalEvent.tags.find(tag => tag[0] === 'closed_at');
    const closedAt = closedAtTag?.[1] ? parseInt(closedAtTag[1]) : null;
    const now = Math.floor(Date.now() / 1000);

    if (closedAt && closedAt < now) {
      console.log('[StreamInfoBar] Goal is closed, using until filter:', new Date(closedAt * 1000));
    }

    console.log('[StreamInfoBar] Subscribing to goal zap receipts:', {
      goalId: goalEvent.id.substring(0, 16),
      relayCount: relayUrls.length,
      closedAt: closedAt ? new Date(closedAt * 1000).toISOString() : 'none'
    });

    // Subscribe to kind 9735 zap receipts that reference this goal event
    // According to NIP-75, zaps to the goal should tag the goal event ID in the 'e' tag
    const filter: Filter & { '#e'?: string[] } = {
      kinds: [9735],
      '#e': [goalEvent.id], // Filter zaps that reference the goal event
      until: closedAt || undefined, // Only count zaps before closed_at if specified
    };

    this.zapSubscription = this.relayPool.subscribe(
      relayUrls,
      filter,
      (zapReceipt: Event) => {
        // Deduplicate by event ID
        if (this.zapEventIds.has(zapReceipt.id)) {
          return;
        }

        this.zapEventIds.add(zapReceipt.id);

        // If goal is closed, verify the zap timestamp is before closed_at
        if (closedAt && zapReceipt.created_at > closedAt) {
          console.log('[StreamInfoBar] Ignoring zap after goal closed:', {
            zapTime: new Date(zapReceipt.created_at * 1000).toISOString(),
            closedTime: new Date(closedAt * 1000).toISOString()
          });
          return;
        }

        // Extract and add zap amount
        const boltTag = zapReceipt.tags.find(tag => tag[0] === 'bolt11');
        if (boltTag?.[1]) {
          const amountInSats = this.extractAmountFromBolt11(boltTag[1]);
          if (amountInSats > 0) {
            this.currentZapAmount.update(current => current + amountInSats);
            console.log('[StreamInfoBar] New goal zap received:', { amountInSats, total: this.currentZapAmount() });
          }
        }
      }
    );
  }

  private extractAmountFromBolt11(bolt11: string): number {
    try {
      // Extract amount from bolt11 invoice
      // Format: lnbc{amount}{multiplier}...
      // Example: lnbc10u... = 10 micro-bitcoin = 1000 sats
      const match = bolt11.toLowerCase().match(/^lnbc(\d+)([munp]?)/);
      if (!match) {
        return 0;
      }

      const amount = parseInt(match[1]);
      const multiplier = match[2];

      // Convert to sats based on multiplier
      // 1 BTC = 100,000,000 sats
      let sats = 0;
      switch (multiplier) {
        case 'm': // milli-bitcoin (0.001 BTC)
          sats = amount * 100000;
          break;
        case 'u': // micro-bitcoin (0.000001 BTC)
          sats = amount * 100;
          break;
        case 'n': // nano-bitcoin (0.000000001 BTC)
          sats = amount / 10;
          break;
        case 'p': // pico-bitcoin (0.000000000001 BTC)
          sats = amount / 10000;
          break;
        case '': // whole bitcoin
          sats = amount * 100000000;
          break;
        default:
          return 0;
      }

      return Math.floor(sats);
    } catch {
      return 0;
    }
  }

  formatSats(sats: number): string {
    if (sats >= 1000000) {
      return `${(sats / 1000000).toFixed(2)}M`;
    } else if (sats >= 1000) {
      return `${(sats / 1000).toFixed(1)}K`;
    }
    return sats.toString();
  }

  async openZapDialog(): Promise<void> {
    const event = this.currentEvent() || this.liveEvent();
    // Use the host pubkey for zaps
    const recipientPubkey = this.streamerPubkey();

    // Get recipient metadata
    const metadata = await this.dataService.getProfile(recipientPubkey);

    if (!metadata) {
      this.snackBar.open('Unable to load streamer profile', 'Dismiss', {
        duration: 3000,
      });
      return;
    }

    // Parse metadata content
    let parsedMetadata: Record<string, unknown> | undefined;
    try {
      parsedMetadata = typeof metadata.event.content === 'string'
        ? JSON.parse(metadata.event.content)
        : metadata.event.content;
    } catch (error) {
      console.error('Error parsing metadata:', error);
    }

    // Prepare dialog data
    const dialogData: ZapDialogData = {
      recipientPubkey,
      recipientName:
        (typeof parsedMetadata?.['name'] === 'string' ? parsedMetadata['name'] : undefined) ||
        (typeof parsedMetadata?.['display_name'] === 'string' ? parsedMetadata['display_name'] : undefined) ||
        undefined,
      recipientMetadata: parsedMetadata,
      eventId: event.id, // Reference the stream event
      eventKind: event.kind, // Reference the stream event kind
      eventAddress: this.eventAddress() || undefined, // Pass the addressable event tag (a tag)
      goalEventId: this.zapGoalEvent()?.id, // Reference the goal event if it exists
      eventContent: `Live stream: ${this.title()}`,
    };

    // Open zap dialog
    const dialogRef = this.dialog.open(ZapDialogComponent, {
      width: '500px',
      data: dialogData,
      disableClose: true,
      panelClass: 'responsive-dialog',
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        // Zap was sent successfully
        this.snackBar.open('Zap sent successfully!', 'Dismiss', {
          duration: 3000,
        });
      }
    });
  }
}
