import { Component, computed, ElementRef, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { Router } from '@angular/router';
import { Event, Filter } from 'nostr-tools';
import { SwipeEvent, SwipeGestureDirective, SwipeProgressEvent } from '../../directives/swipe-gesture.directive';
import { CommentsListComponent } from '../../components/comments-list/comments-list.component';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService, ANONYMOUS_PUBKEY } from '../../services/account-local-state.service';
import { DatabaseService } from '../../services/database.service';
import { LoggerService } from '../../services/logger.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { UserRelaysService } from '../../services/relays/user-relays';
import { ReportingService } from '../../services/reporting.service';
import { UtilitiesService } from '../../services/utilities.service';
import { LayoutService } from '../../services/layout.service';
import { EventService } from '../../services/event';
import { ClipsSettingsDialogComponent } from './clips-settings-dialog/clips-settings-dialog.component';
import { ClipsVideoCardComponent } from './clips-video-card/clips-video-card.component';
import { SharedRelayService } from '../../services/relays/shared-relay';
import { ZapService } from '../../services/zap.service';
import { LocalStorageService } from '../../services/local-storage.service';

const RELAY_SET_KIND = 30002;
const CLIPS_RELAY_SET_D_TAG = 'clips';
const CLIPS_KINDS = [22, 34236];
const EXPLORE_PAGE_SIZE = 24;
const INITIAL_CLIPS_BATCH_SIZE = 5;
const INITIAL_CLIPS_TIMEOUT_MS = 1500;
const INITIAL_CLIPS_RELAY_LIMIT_PER_SOURCE = 4;
const INITIAL_CLIPS_RELAY_LIMIT_TOTAL = 12;
const FULL_CLIPS_RELAY_LIMIT_PER_SOURCE = 8;
const FULL_CLIPS_RELAY_LIMIT_TOTAL = 20;
const FOLLOWING_PROFILE_VIDEO_LIMIT = 50;
const FOLLOWING_FETCH_CONCURRENCY = 3;
// TODO: As clip volume grows, consider reducing this limit and using a created_at-based latest window per profile.
const CLIP_COMMENTS_KIND = 1111;
const CLIP_COMMENTS_PREFETCH_LIMIT = 30;
const PROFILE_PREFETCH_MAX_AUTHORS = 120;
const CLIPS_CURRENT_EVENT_STORAGE_PREFIX = 'clips-current-event';
const INTERACTION_PREFETCH_COOLDOWN_MS = 6000;

interface CachedClipEventRecord {
  version: 1;
  savedAt: number;
  event: Event;
}

const DEFAULT_CLIPS_RELAYS = [
  'wss://nos.lol/',
  'wss://relay.damus.io/',
  'wss://relay3.openvine.co/',
  'wss://relay.divine.video/',
];

type SwipeMode = 'following' | 'foryou';

const SWIPE_DRAG_DEADZONE_PX = 6;
const SWIPE_PREVIEW_THRESHOLD_PX = 18;

@Component({
  selector: 'app-clips',
  host: {
    '(window:keydown)': 'onWindowKeyDown($event)',
  },
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    CommentsListComponent,
    SwipeGestureDirective,
    ClipsSettingsDialogComponent,
    ClipsVideoCardComponent,
  ],
  templateUrl: './clips.component.html',
  styleUrl: './clips.component.scss',
})
export class ClipsComponent implements OnInit, OnDestroy {
  private pool = inject(RelayPoolService);
  private relaysService = inject(RelaysService);
  private accountRelay = inject(AccountRelayService);
  private userRelays = inject(UserRelaysService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  private database = inject(DatabaseService);
  private reporting = inject(ReportingService);
  private utilities = inject(UtilitiesService);
  private layout = inject(LayoutService);
  private eventService = inject(EventService);
  private sharedRelay = inject(SharedRelayService);
  private zapService = inject(ZapService);
  private localStorage = inject(LocalStorageService);
  private router = inject(Router);
  private logger = inject(LoggerService);

  loading = signal(true);
  selectedTabIndex = signal(2);
  showSettingsDialog = signal(false);
  isHandset = computed(() => this.layout.isHandset());

  includeArchive = signal(false);
  archiveOnly = signal(false);

  allClips = signal<Event[]>([]);
  exploreLimit = signal(EXPLORE_PAGE_SIZE);
  clipsRelaySet = signal<Event | null>(null);
  clipsRelays = signal<string[]>([]);

  followingIndex = signal(0);
  forYouIndex = signal(0);

  followingDragOffset = signal(0);
  forYouDragOffset = signal(0);
  followingAnimating = signal(false);
  forYouAnimating = signal(false);

  private followingCommittedSwipe = false;
  private forYouCommittedSwipe = false;
  private followingSwipeDelta = 0;
  private forYouSwipeDelta = 0;
  private lastWheelNavigationAt = 0;
  private pendingFollowingRestoreEventId: string | null = null;
  private followingRestoreApplied = false;
  private pendingForYouRestoreEventId: string | null = null;
  private forYouRestoreApplied = false;
  private exploreLoadObserver: IntersectionObserver | null = null;
  private exploreAutoLoadInProgress = false;
  private exploreLoadSentinel = viewChild<ElementRef<HTMLDivElement>>('exploreLoadSentinel');
  private prefetchedInteractionIds = new Set<string>();
  private interactionPrefetchInFlight = new Set<string>();
  private interactionLastPrefetchedAt = new Map<string, number>();

  commentsOpen = signal(false);
  commentsEvent = signal<Event | null>(null);

  eligibleClips = computed(() => {
    const events = this.allClips();
    const includeArchive = this.includeArchive();
    const archiveOnly = this.archiveOnly();

    return events
      .filter(event => this.isPortraitShortFormVideo(event) || (this.isArchiveEvent(event) && this.isVideoEvent(event)))
      .filter(event => {
        const isArchive = this.isArchiveEvent(event);
        if (archiveOnly) return isArchive;
        if (includeArchive) return true;
        return !isArchive;
      });
  });

  followingClips = computed(() => {
    const following = new Set(this.accountState.followingList());
    if (following.size === 0) return [];
    return this.eligibleClips().filter(event => following.has(event.pubkey));
  });

  forYouClips = computed(() => this.eligibleClips());
  exploreClips = computed(() => {
    const deduped = new Map<string, Event>();

    const combined = [...this.forYouClips(), ...this.followingClips()];
    for (const event of combined) {
      const dedupeKey = this.getDedupeKey(event);
      const existing = deduped.get(dedupeKey);
      if (!existing || event.created_at > existing.created_at) {
        deduped.set(dedupeKey, event);
      }
    }

    return Array.from(deduped.values()).sort((a, b) => b.created_at - a.created_at);
  });
  visibleExploreClips = computed(() => this.exploreClips().slice(0, this.exploreLimit()));
  hasMoreExploreClips = computed(() => this.visibleExploreClips().length < this.exploreClips().length);

  currentFollowingClip = computed(() => {
    const clips = this.followingClips();
    if (clips.length === 0) return null;
    const index = Math.min(this.followingIndex(), clips.length - 1);
    return clips[index] || null;
  });

  currentForYouClip = computed(() => {
    const clips = this.forYouClips();
    if (clips.length === 0) return null;
    const index = Math.min(this.forYouIndex(), clips.length - 1);
    return clips[index] || null;
  });

  async ngOnInit(): Promise<void> {
    this.pendingFollowingRestoreEventId = this.accountLocalState.getClipsLastFollowingEventId(this.getAccountKey()) || null;
    this.pendingForYouRestoreEventId = this.accountLocalState.getClipsLastForYouEventId(this.getAccountKey()) || null;
    this.restoreCurrentClipFromStorage();

    if (this.layout.isHandset()) {
      this.layout.hideMobileNav.set(true);
    }
    await this.initializeClips();
    this.refreshExploreAutoLoadObserver();
  }

  ngOnDestroy(): void {
    this.persistFollowingPosition();
    this.persistForYouPosition();
    this.layout.hideMobileNav.set(false);
    this.exploreLoadObserver?.disconnect();
    this.exploreLoadObserver = null;
  }

  async refresh(): Promise<void> {
    await this.loadCachedClips();
    this.loading.set(false);
    await this.loadClips(true);
  }

  onTabChange(index: number): void {
    this.selectedTabIndex.set(index);
    this.refreshExploreAutoLoadObserver();
    this.prefetchActiveAndNextInteractions();

    if (index === 1) {
      this.tryRestoreFollowingPosition();
      this.persistFollowingPosition();
    }

    if (index === 2) {
      this.tryRestoreForYouPosition();
      this.persistForYouPosition();
    }
  }

  openClipFromExplore(clip: Event): void {
    const forYou = this.forYouClips();
    const index = forYou.findIndex(item => item.id === clip.id);
    if (index >= 0) {
      this.forYouIndex.set(index);
      this.persistForYouPosition();
    }
    this.selectedTabIndex.set(2);
    this.tryRestoreForYouPosition();
    this.prefetchActiveAndNextInteractions();
  }

  getClipPoster(event: Event): string {
    const imetaTag = event.tags.find(tag => tag[0] === 'imeta');
    if (!imetaTag) return '';
    const parsed = this.utilities.parseImetaTag(imetaTag, true);
    return parsed['image'] || '';
  }

  getClipTitle(event: Event): string {
    return event.tags.find(tag => tag[0] === 'title')?.[1] || 'Clip';
  }

  async goHome(): Promise<void> {
    this.closeComments();
    this.showSettingsDialog.set(false);
    await this.router.navigateByUrl('/');
  }

  createClip(): void {
    this.layout.openRecordVideoDialog();
  }

  openSettings(): void {
    this.showSettingsDialog.set(true);
  }

  async onSettingsDialogClosed(result: { saved: boolean } | null): Promise<void> {
    this.showSettingsDialog.set(false);
    if (result?.saved) {
      await this.initializeClips();
    }
  }

  onIncludeArchiveChanged(value: boolean): void {
    this.includeArchive.set(value);
    if (!value && this.archiveOnly()) {
      this.archiveOnly.set(false);
    }
    this.resetExploreLimit();
    this.ensureIndexesInRange();
  }

  onArchiveOnlyChanged(value: boolean): void {
    this.archiveOnly.set(value);
    if (value) {
      this.includeArchive.set(true);
    }
    this.resetExploreLimit();
    this.ensureIndexesInRange();
  }

  toggleIncludeArchive(): void {
    this.onIncludeArchiveChanged(!this.includeArchive());
  }

  toggleArchiveOnly(): void {
    this.onArchiveOnlyChanged(!this.archiveOnly());
  }

  loadMoreExploreClips(): void {
    this.exploreLimit.update(limit => limit + EXPLORE_PAGE_SIZE);
    this.refreshExploreAutoLoadObserver();
  }

  nextClip(mode: SwipeMode): void {
    this.advanceByKeyboard(mode, 1);
  }

  previousClip(mode: SwipeMode): void {
    this.advanceByKeyboard(mode, -1);
  }

  canNavigate(mode: SwipeMode, delta: number): boolean {
    const clips = mode === 'following' ? this.followingClips() : this.forYouClips();
    const currentIndex = mode === 'following' ? this.followingIndex() : this.forYouIndex();
    const nextIndex = currentIndex + delta;
    return nextIndex >= 0 && nextIndex < clips.length;
  }

  onSwipeProgress(event: SwipeProgressEvent, mode: SwipeMode): void {
    if (event.direction !== 'vertical') return;

    const offset = Math.abs(event.deltaY) <= SWIPE_DRAG_DEADZONE_PX ? 0 : event.deltaY;

    if (mode === 'following') {
      this.followingAnimating.set(false);
      this.followingDragOffset.set(offset);
      return;
    }

    this.forYouAnimating.set(false);
    this.forYouDragOffset.set(offset);
  }

  onSwipe(event: SwipeEvent, mode: SwipeMode): void {
    const delta = event.direction === 'up' ? 1 : -1;

    if (mode === 'following') {
      this.followingCommittedSwipe = true;
      this.followingSwipeDelta = delta;
      return;
    }

    this.forYouCommittedSwipe = true;
    this.forYouSwipeDelta = delta;
  }

  onSwipeEnd(mode: SwipeMode): void {
    if (mode === 'following') {
      if (this.followingCommittedSwipe) {
        this.advanceIndex('following', this.followingSwipeDelta);
      }

      if (this.followingDragOffset() !== 0) {
        this.followingAnimating.set(true);
      }

      this.followingDragOffset.set(0);
      this.followingCommittedSwipe = false;
      this.followingSwipeDelta = 0;
      return;
    }

    if (this.forYouCommittedSwipe) {
      this.advanceIndex('foryou', this.forYouSwipeDelta);
    }

    if (this.forYouDragOffset() !== 0) {
      this.forYouAnimating.set(true);
    }

    this.forYouDragOffset.set(0);
    this.forYouCommittedSwipe = false;
    this.forYouSwipeDelta = 0;
  }

  onWheelNavigate(event: WheelEvent, mode: SwipeMode): void {
    if (this.loading() || this.commentsOpen() || this.showSettingsDialog()) {
      return;
    }

    if (Math.abs(event.deltaY) < 24) {
      return;
    }

    const now = Date.now();
    if (now - this.lastWheelNavigationAt < 220) {
      return;
    }

    const delta = event.deltaY > 0 ? 1 : -1;
    if (!this.canNavigate(mode, delta)) {
      return;
    }

    event.preventDefault();
    this.lastWheelNavigationAt = now;
    this.advanceByKeyboard(mode, delta);
  }

  onWindowKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const tagName = target?.tagName?.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) {
      return;
    }

    if (this.commentsOpen() || this.showSettingsDialog()) {
      return;
    }

    const mode = this.selectedTabIndex() === 1 ? 'following' : this.selectedTabIndex() === 2 ? 'foryou' : null;
    if (!mode) {
      return;
    }

    const key = event.key.toLowerCase();

    if (event.key === 'ArrowDown' || key === 'j') {
      event.preventDefault();
      this.advanceByKeyboard(mode, 1);
      return;
    }

    if (event.key === 'ArrowUp' || key === 'k') {
      event.preventDefault();
      this.advanceByKeyboard(mode, -1);
    }
  }

  getCardTransform(mode: SwipeMode): string {
    if (mode === 'following') {
      return `translateY(${this.followingDragOffset()}px)`;
    }
    return `translateY(${this.forYouDragOffset()}px)`;
  }

  isCardAnimating(mode: SwipeMode): boolean {
    return mode === 'following' ? this.followingAnimating() : this.forYouAnimating();
  }

  hasSwipePreview(mode: SwipeMode): boolean {
    const offset = mode === 'following' ? this.followingDragOffset() : this.forYouDragOffset();
    if (Math.abs(offset) < SWIPE_PREVIEW_THRESHOLD_PX) {
      return false;
    }

    const previewDelta = offset > 0 ? -1 : 1;
    return this.canNavigate(mode, previewDelta);
  }

  getSwipePreviewClip(mode: SwipeMode): Event | null {
    if (!this.hasSwipePreview(mode)) {
      return null;
    }

    const clips = mode === 'following' ? this.followingClips() : this.forYouClips();
    const currentIndex = mode === 'following' ? this.followingIndex() : this.forYouIndex();
    const offset = mode === 'following' ? this.followingDragOffset() : this.forYouDragOffset();
    const previewIndex = currentIndex + (offset > 0 ? -1 : 1);

    return clips[previewIndex] || null;
  }

  getSwipePreviewTransform(mode: SwipeMode): string {
    const offset = mode === 'following' ? this.followingDragOffset() : this.forYouDragOffset();
    if (offset === 0) {
      return 'translateY(100%)';
    }

    const gap = 18;
    if (offset > 0) {
      return `translateY(calc(-100% + ${offset - gap}px))`;
    }

    return `translateY(calc(100% + ${offset + gap}px))`;
  }

  openComments(event: Event): void {
    this.commentsEvent.set(event);
    this.commentsOpen.set(true);
  }

  closeComments(): void {
    this.commentsOpen.set(false);
    this.commentsEvent.set(null);
  }

  private async initializeClips(): Promise<void> {
    await this.loadCachedClips();

    if (this.allClips().length > 0) {
      this.loading.set(false);
    }

    const relaySetPromise = this.loadClipsRelaySet();
    await this.loadInitialClips();

    await relaySetPromise;

    void this.loadClips(false);
  }

  private async loadCachedClips(): Promise<void> {
    try {
      const eventsByKind = await Promise.all(CLIPS_KINDS.map(kind => this.database.getEventsByKind(kind)));
      const dedupedMap = new Map<string, Event>();

      for (const events of eventsByKind) {
        for (const event of events) {
          if (this.reporting.isUserBlocked(event.pubkey) || this.reporting.isContentBlocked(event)) {
            continue;
          }

          const dedupeKey = this.getDedupeKey(event);
          const existing = dedupedMap.get(dedupeKey);
          if (!existing || event.created_at > existing.created_at) {
            dedupedMap.set(dedupeKey, event);
          }
        }
      }

      const cachedClips = Array.from(dedupedMap.values()).sort((a, b) => b.created_at - a.created_at);
      if (cachedClips.length > 0) {
        this.applyClipsAndPreserveCurrentSelection(cachedClips);

        const clipsRelayUrls = this.clipsRelays().length > 0 ? this.clipsRelays() : DEFAULT_CLIPS_RELAYS;
        void this.prefetchClipAuthorProfiles(cachedClips, clipsRelayUrls);
      }
    } catch (error) {
      this.logger.error('Failed to load cached clips', error);
    }
  }

  private async loadClipsRelaySet(): Promise<void> {
    const pubkey = this.accountState.pubkey();

    if (!pubkey) {
      this.clipsRelays.set([...DEFAULT_CLIPS_RELAYS]);
      return;
    }

    try {
      const cachedEvent = await this.database.getParameterizedReplaceableEvent(
        pubkey,
        RELAY_SET_KIND,
        CLIPS_RELAY_SET_D_TAG
      );

      if (cachedEvent) {
        this.clipsRelaySet.set(cachedEvent);
        this.clipsRelays.set(this.extractRelaysFromRelaySet(cachedEvent));
      }

      const accountRelays = this.accountRelay.getRelayUrls();
      const relayUrls = this.relaysService.getOptimalRelays(accountRelays);

      if (relayUrls.length === 0) {
        if (this.clipsRelays().length === 0) {
          this.clipsRelays.set([...DEFAULT_CLIPS_RELAYS]);
        }
        return;
      }

      const filter: Filter = {
        kinds: [RELAY_SET_KIND],
        authors: [pubkey],
        '#d': [CLIPS_RELAY_SET_D_TAG],
        limit: 1,
      };

      let foundEvent: Event | null = null;

      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          resolve();
        }, 5000);

        const subscription = this.pool.subscribe(relayUrls, filter, (event: Event) => {
          if (!foundEvent || event.created_at > foundEvent.created_at) {
            foundEvent = event;
          }
        });

        setTimeout(() => {
          subscription.close();
          clearTimeout(timeout);
          resolve();
        }, 3000);
      });

      if (foundEvent) {
        const event = foundEvent as Event;
        if (!cachedEvent || event.created_at > cachedEvent.created_at) {
          this.clipsRelaySet.set(event);
          this.clipsRelays.set(this.extractRelaysFromRelaySet(event));
          await this.database.saveEvent({ ...event, dTag: CLIPS_RELAY_SET_D_TAG });
        }
      }

      if (this.clipsRelays().length === 0) {
        this.clipsRelays.set([...DEFAULT_CLIPS_RELAYS]);
      }
    } catch (error) {
      this.logger.error('Failed to load clips relay set', error);
      if (this.clipsRelays().length === 0) {
        this.clipsRelays.set([...DEFAULT_CLIPS_RELAYS]);
      }
    }
  }

  private async loadInitialClips(): Promise<void> {
    try {
      const relayUrls = this.getClipsQueryRelayUrls(INITIAL_CLIPS_RELAY_LIMIT_PER_SOURCE, INITIAL_CLIPS_RELAY_LIMIT_TOTAL);
      const dedupedMap = new Map<string, Event>();

      for (const event of this.allClips()) {
        const dedupeKey = this.getDedupeKey(event);
        const existing = dedupedMap.get(dedupeKey);
        if (!existing || event.created_at > existing.created_at) {
          dedupedMap.set(dedupeKey, event);
        }
      }

      await this.collectClipsForFilter(
        relayUrls,
        {
          kinds: [...CLIPS_KINDS],
          limit: INITIAL_CLIPS_BATCH_SIZE,
        },
        dedupedMap,
        INITIAL_CLIPS_TIMEOUT_MS,
        INITIAL_CLIPS_BATCH_SIZE
      );

      const clips = Array.from(dedupedMap.values()).sort((a, b) => b.created_at - a.created_at);
      if (clips.length > 0) {
        this.applyClipsAndPreserveCurrentSelection(clips);
        void Promise.allSettled(clips.map(event => this.database.saveEvent(event)));
        void this.prefetchClipAuthorProfiles(clips, relayUrls);
      } else {
        this.resetExploreLimit();
        this.ensureIndexesInRange();
      }
    } catch (error) {
      this.logger.error('Failed to load initial clips batch', error);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadClips(showLoadingIndicator = true): Promise<void> {
    if (showLoadingIndicator && this.allClips().length === 0) {
      this.loading.set(true);
    }

    try {
      const relayUrls = this.getClipsQueryRelayUrls(FULL_CLIPS_RELAY_LIMIT_PER_SOURCE, FULL_CLIPS_RELAY_LIMIT_TOTAL);
      const dedupedMap = new Map<string, Event>();

      for (const event of this.allClips()) {
        const dedupeKey = this.getDedupeKey(event);
        const existing = dedupedMap.get(dedupeKey);
        if (!existing || event.created_at > existing.created_at) {
          dedupedMap.set(dedupeKey, event);
        }
      }

      await this.collectClipsForFilter(
        relayUrls,
        {
          kinds: [...CLIPS_KINDS],
          limit: 300,
        },
        dedupedMap,
        4500
      );

      const followingAuthors = Array.from(new Set(this.accountState.followingList()));
      if (followingAuthors.length > 0) {
        await this.loadFollowingAuthorClips(followingAuthors, relayUrls, dedupedMap);
      }

      const clips = Array.from(dedupedMap.values()).sort((a, b) => b.created_at - a.created_at);
      this.applyClipsAndPreserveCurrentSelection(clips);
      await Promise.allSettled(clips.map(event => this.database.saveEvent(event)));
      void this.prefetchClipAuthorProfiles(clips, relayUrls);
      this.clearUnresolvedRestoreTargets();

      if (this.selectedTabIndex() === 1) {
        this.persistFollowingPosition();
      }

      if (this.selectedTabIndex() === 2) {
        this.persistForYouPosition();
      }
    } catch (error) {
      this.logger.error('Failed to load clips', error);
    } finally {
      this.loading.set(false);
    }
  }

  private getClipsQueryRelayUrls(perSourceLimit: number, totalLimit: number): string[] {
    const configuredRelays = this.clipsRelays().length > 0
      ? this.relaysService.getOptimalRelays(this.clipsRelays(), perSourceLimit)
      : [];

    const defaultClipsRelays = this.relaysService.getOptimalRelays(DEFAULT_CLIPS_RELAYS, perSourceLimit);

    const accountRelayUrls = this.accountRelay.getRelayUrls();
    const accountRelays = accountRelayUrls.length > 0
      ? this.relaysService.getOptimalRelays(accountRelayUrls, perSourceLimit)
      : [];

    const mergedRelays = this.utilities.getUniqueNormalizedRelayUrls([
      ...configuredRelays,
      ...defaultClipsRelays,
      ...accountRelays,
    ]);

    if (mergedRelays.length <= totalLimit) {
      return mergedRelays;
    }

    return this.relaysService.getOptimalRelays(mergedRelays, totalLimit);
  }

  private applyClipsAndPreserveCurrentSelection(clips: Event[]): void {
    const currentFollowingEventId = this.currentFollowingClip()?.id || this.pendingFollowingRestoreEventId;
    const currentForYouEventId = this.currentForYouClip()?.id || this.pendingForYouRestoreEventId;

    this.allClips.set(clips);
    this.restoreClipIndexById('following', currentFollowingEventId);
    this.restoreClipIndexById('foryou', currentForYouEventId);
    this.resetExploreLimit();
    this.ensureIndexesInRange();
  }

  private restoreClipIndexById(mode: SwipeMode, eventId: string | null): void {
    if (!eventId) {
      return;
    }

    if (mode === 'following') {
      const index = this.followingClips().findIndex(event => event.id === eventId);
      if (index >= 0) {
        this.followingIndex.set(index);
      }
      return;
    }

    const index = this.forYouClips().findIndex(event => event.id === eventId);
    if (index >= 0) {
      this.forYouIndex.set(index);
    }
  }

  private async collectClipsForFilter(
    relayUrls: string[],
    filter: Filter,
    targetMap: Map<string, Event>,
    timeoutMs: number,
    resolveWhenTotalAtLeast?: number
  ): Promise<void> {
    if (relayUrls.length === 0) {
      return;
    }

    if (resolveWhenTotalAtLeast && targetMap.size >= resolveWhenTotalAtLeast) {
      return;
    }

    await new Promise<void>(resolve => {
      let finished = false;
      let subscription: { close: () => void } | null = null;

      const finish = (): void => {
        if (finished) {
          return;
        }

        finished = true;
        subscription?.close();
        clearTimeout(timeout);
        resolve();
      };

      const timeout = setTimeout(() => {
        finish();
      }, timeoutMs);

      subscription = this.pool.subscribe(relayUrls, filter, (event: Event) => {
        if (this.reporting.isUserBlocked(event.pubkey) || this.reporting.isContentBlocked(event)) {
          return;
        }

        const dedupeKey = this.getDedupeKey(event);
        const existing = targetMap.get(dedupeKey);
        if (!existing || event.created_at > existing.created_at) {
          targetMap.set(dedupeKey, event);
        }

        if (resolveWhenTotalAtLeast && targetMap.size >= resolveWhenTotalAtLeast) {
          finish();
        }
      });
    });
  }

  private ensureIndexesInRange(): void {
    const followingLength = this.followingClips().length;
    const forYouLength = this.forYouClips().length;

    if (followingLength === 0) {
      this.followingIndex.set(0);
    } else if (this.followingIndex() > followingLength - 1) {
      this.followingIndex.set(followingLength - 1);
    }

    if (forYouLength === 0) {
      this.forYouIndex.set(0);
    } else if (this.forYouIndex() > forYouLength - 1) {
      this.forYouIndex.set(forYouLength - 1);
    }

    this.tryRestoreFollowingPosition();
    this.tryRestoreForYouPosition();

    if (this.selectedTabIndex() === 1) {
      this.persistFollowingPosition();
    }

    if (this.selectedTabIndex() === 2) {
      this.persistForYouPosition();
    }

    this.prefetchActiveAndNextInteractions();
  }

  private resetExploreLimit(): void {
    this.exploreLimit.set(EXPLORE_PAGE_SIZE);
    this.refreshExploreAutoLoadObserver();
  }

  private advanceByKeyboard(mode: SwipeMode, delta: number): void {
    const moved = this.advanceIndex(mode, delta);
    if (!moved) {
      return;
    }

    if (mode === 'following') {
      this.followingAnimating.set(true);
      this.followingDragOffset.set(0);
      return;
    }

    this.forYouAnimating.set(true);
    this.forYouDragOffset.set(0);
  }

  private advanceIndex(mode: SwipeMode, delta: number): boolean {
    if (mode === 'following') {
      const clips = this.followingClips();
      if (clips.length === 0) return false;
      const next = this.followingIndex() + delta;
      if (next >= 0 && next < clips.length) {
        this.followingIndex.set(next);
        this.persistFollowingPosition();
        this.prefetchActiveAndNextInteractions();
        return true;
      }
      return false;
    }

    const clips = this.forYouClips();
    if (clips.length === 0) return false;
    const next = this.forYouIndex() + delta;
    if (next >= 0 && next < clips.length) {
      this.forYouIndex.set(next);
      this.persistForYouPosition();
      this.prefetchActiveAndNextInteractions();
      return true;
    }

    return false;
  }

  private extractRelaysFromRelaySet(event: Event): string[] {
    return event.tags.filter(tag => tag[0] === 'relay' && tag[1]).map(tag => tag[1]);
  }

  private getDedupeKey(event: Event): string {
    if (event.kind === 34236) {
      const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || event.id;
      return `${event.kind}:${event.pubkey}:${dTag}`;
    }
    return event.id;
  }

  private isPortraitShortFormVideo(event: Event): boolean {
    if (!CLIPS_KINDS.includes(event.kind)) {
      return false;
    }

    const imetaTags = event.tags.filter(tag => tag[0] === 'imeta');
    if (imetaTags.length === 0) {
      return false;
    }

    for (const imetaTag of imetaTags) {
      const parsed = this.utilities.parseImetaTag(imetaTag, true);
      const mimeType = parsed['m'] || '';
      if (mimeType && !mimeType.startsWith('video/')) {
        continue;
      }

      const dim = parsed['dim'];
      if (!dim) {
        continue;
      }

      const [widthRaw, heightRaw] = dim.split('x');
      const width = Number.parseInt(widthRaw || '', 10);
      const height = Number.parseInt(heightRaw || '', 10);

      if (!Number.isNaN(width) && !Number.isNaN(height) && height >= width) {
        return true;
      }
    }

    return false;
  }

  private isArchiveEvent(event: Event): boolean {
    const hasPlatformVine = event.tags.some(tag => {
      if (tag[0] !== 'platform' || !tag[1]) return false;
      return tag[1].toLowerCase().includes('vine');
    });
    const hasOriginVine = event.tags.some(tag => {
      if (tag[0] !== 'origin' || !tag[1]) return false;
      return tag[1].toLowerCase().includes('vine');
    });
    const hasVineId = event.tags.some(tag => tag[0] === 'vine_id' && !!tag[1]);
    const hasArchiveLabel = event.tags.some(
      tag => tag[0] === 'l' && !!tag[1] && tag[1].toLowerCase().includes('archive')
    );
    const hasArchiveNamespace = event.tags.some(
      tag => tag[0] === 'L' && !!tag[1] && tag[1].toLowerCase().includes('archive')
    );

    return hasPlatformVine || hasOriginVine || hasVineId || hasArchiveLabel || hasArchiveNamespace;
  }

  private isVideoEvent(event: Event): boolean {
    if (!CLIPS_KINDS.includes(event.kind)) {
      return false;
    }

    const imetaTags = event.tags.filter(tag => tag[0] === 'imeta');
    if (imetaTags.length === 0) {
      return false;
    }

    for (const imetaTag of imetaTags) {
      const parsed = this.utilities.parseImetaTag(imetaTag, true);
      const mimeType = parsed['m'] || '';
      const url = parsed['url'] || '';

      if (!url) {
        continue;
      }

      if (!mimeType || mimeType.startsWith('video/')) {
        return true;
      }
    }

    return false;
  }

  private getAccountKey(): string {
    return this.accountState.pubkey() || ANONYMOUS_PUBKEY;
  }

  private tryRestoreFollowingPosition(): void {
    if (this.followingRestoreApplied) {
      return;
    }

    const targetEventId = this.pendingFollowingRestoreEventId;
    if (!targetEventId) {
      this.followingRestoreApplied = true;
      return;
    }

    const clips = this.followingClips();
    if (clips.length === 0) {
      return;
    }

    const index = clips.findIndex(event => event.id === targetEventId);
    if (index < 0) {
      return;
    }

    this.followingIndex.set(index);
    this.followingRestoreApplied = true;
    this.pendingFollowingRestoreEventId = null;
  }

  private tryRestoreForYouPosition(): void {
    if (this.forYouRestoreApplied) {
      return;
    }

    const targetEventId = this.pendingForYouRestoreEventId;
    if (!targetEventId) {
      this.forYouRestoreApplied = true;
      return;
    }

    const clips = this.forYouClips();
    if (clips.length === 0) {
      return;
    }

    const index = clips.findIndex(event => event.id === targetEventId);
    if (index < 0) {
      return;
    }

    this.forYouIndex.set(index);
    this.forYouRestoreApplied = true;
    this.pendingForYouRestoreEventId = null;
  }

  private persistFollowingPosition(): void {
    if (this.pendingFollowingRestoreEventId && !this.followingRestoreApplied) {
      return;
    }

    const clip = this.currentFollowingClip();
    if (!clip) {
      return;
    }

    this.accountLocalState.setClipsLastFollowingEventId(this.getAccountKey(), clip.id);
  }

  private persistForYouPosition(): void {
    if (this.pendingForYouRestoreEventId && !this.forYouRestoreApplied) {
      return;
    }

    const clip = this.currentForYouClip();
    if (!clip) {
      return;
    }

    this.accountLocalState.setClipsLastForYouEventId(this.getAccountKey(), clip.id);
    this.persistCurrentClipToStorage(clip);
  }

  private getCurrentClipStorageKey(): string {
    return `${CLIPS_CURRENT_EVENT_STORAGE_PREFIX}:${this.getAccountKey()}`;
  }

  private restoreCurrentClipFromStorage(): void {
    try {
      const storageKey = this.getCurrentClipStorageKey();
      const cached = this.localStorage.getObject<CachedClipEventRecord>(storageKey);
      const event = cached?.event;

      if (!event || !this.isValidCachedClipEvent(event)) {
        if (cached) {
          this.localStorage.removeItem(storageKey);
        }
        return;
      }

      this.allClips.set([event]);
      this.pendingForYouRestoreEventId = event.id;
      this.forYouRestoreApplied = false;
      this.tryRestoreForYouPosition();
      this.loading.set(false);
    } catch (error) {
      this.logger.debug('Failed to restore cached current clip', error);
    }
  }

  private persistCurrentClipToStorage(event: Event): void {
    if (!this.isValidCachedClipEvent(event)) {
      return;
    }

    const payload: CachedClipEventRecord = {
      version: 1,
      savedAt: this.utilities.currentDate(),
      event,
    };

    this.localStorage.setObject(this.getCurrentClipStorageKey(), payload);
  }

  private isValidCachedClipEvent(event: Event): boolean {
    if (!event || !event.id || !event.pubkey || !Array.isArray(event.tags) || !CLIPS_KINDS.includes(event.kind)) {
      return false;
    }

    return this.isVideoEvent(event);
  }

  private clearUnresolvedRestoreTargets(): void {
    if (!this.followingRestoreApplied && this.pendingFollowingRestoreEventId && this.followingClips().length > 0) {
      const followingContainsTarget = this.followingClips().some(event => event.id === this.pendingFollowingRestoreEventId);
      if (!followingContainsTarget) {
        this.followingRestoreApplied = true;
        this.pendingFollowingRestoreEventId = null;
      }
    }

    if (!this.forYouRestoreApplied && this.pendingForYouRestoreEventId && this.forYouClips().length > 0) {
      const forYouContainsTarget = this.forYouClips().some(event => event.id === this.pendingForYouRestoreEventId);
      if (!forYouContainsTarget) {
        this.forYouRestoreApplied = true;
        this.pendingForYouRestoreEventId = null;
      }
    }
  }

  private prefetchActiveAndNextInteractions(): void {
    const mode: SwipeMode = this.selectedTabIndex() === 1 ? 'following' : 'foryou';
    const clips = mode === 'following' ? this.followingClips() : this.forYouClips();

    if (clips.length === 0) {
      return;
    }

    const currentIndex = mode === 'following' ? this.followingIndex() : this.forYouIndex();
    const currentClip = clips[Math.min(Math.max(currentIndex, 0), clips.length - 1)] ?? null;

    this.prefetchClipInteractions(currentClip);
  }

  private prefetchClipInteractions(event: Event | null): void {
    if (!event) {
      return;
    }

    const now = Date.now();
    const lastPrefetchedAt = this.interactionLastPrefetchedAt.get(event.id) || 0;
    if (now - lastPrefetchedAt < INTERACTION_PREFETCH_COOLDOWN_MS) {
      return;
    }

    if (this.prefetchedInteractionIds.has(event.id) || this.interactionPrefetchInFlight.has(event.id)) {
      return;
    }

    this.interactionPrefetchInFlight.add(event.id);

    const interactions: Promise<unknown>[] = [
      this.eventService.loadEventInteractions(
        event.id,
        event.kind,
        event.pubkey,
        false,
        false,
        EventService.INTERACTION_QUERY_LIMIT,
      ),
      this.zapService.getZapsForEvent(event.id),
    ];

    const currentUserPubkey = this.accountState.pubkey();
    if (currentUserPubkey) {
      interactions.push(this.prefetchComments(event, currentUserPubkey));
    }

    void Promise.allSettled(interactions).finally(() => {
      this.interactionPrefetchInFlight.delete(event.id);
      this.prefetchedInteractionIds.add(event.id);
      this.interactionLastPrefetchedAt.set(event.id, Date.now());
    });
  }

  private async loadFollowingAuthorClips(
    followingAuthors: string[],
    relayUrls: string[],
    dedupedMap: Map<string, Event>
  ): Promise<void> {
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < followingAuthors.length) {
        const index = cursor;
        cursor += 1;
        const author = followingAuthors[index];

        const authorRelayUrls = await this.getFollowingRelayUrls(author, relayUrls);

        await this.collectClipsForFilter(
          authorRelayUrls,
          {
            kinds: [...CLIPS_KINDS],
            authors: [author],
            limit: FOLLOWING_PROFILE_VIDEO_LIMIT,
          },
          dedupedMap,
          3500
        );
      }
    };

    const workerCount = Math.min(FOLLOWING_FETCH_CONCURRENCY, followingAuthors.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  }

  private async prefetchComments(event: Event, currentUserPubkey: string): Promise<void> {
    const filter: Record<string, unknown> = {
      kinds: [CLIP_COMMENTS_KIND],
      limit: CLIP_COMMENTS_PREFETCH_LIMIT,
    };

    const isAddressable = event.kind >= 30000 && event.kind < 40000;
    if (isAddressable) {
      const dTag = event.tags.find(tag => tag[0] === 'd')?.[1] || '';
      const aTagValue = `${event.kind}:${event.pubkey}:${dTag}`;
      filter['#A'] = [aTagValue];
    } else {
      filter['#e'] = [event.id];
    }

    await this.sharedRelay.getMany(currentUserPubkey, filter);
  }

  private async getFollowingRelayUrls(authorPubkey: string, featureRelayUrls: string[]): Promise<string[]> {
    try {
      await this.userRelays.ensureRelaysForPubkey(authorPubkey);
      const authorRelays = this.userRelays.getRelaysForPubkey(authorPubkey);
      const mergedRelays = this.utilities.getUniqueNormalizedRelayUrls([...featureRelayUrls, ...authorRelays]);

      if (mergedRelays.length > 0) {
        return mergedRelays;
      }
    } catch (error) {
      this.logger.debug('Failed to load author relays for clips following fetch', { authorPubkey, error });
    }

    return featureRelayUrls;
  }

  private async prefetchClipAuthorProfiles(clips: Event[], clipsRelayUrls: string[]): Promise<void> {
    const authors = Array.from(new Set(clips.map(event => event.pubkey).filter(pubkey => !!pubkey)))
      .slice(0, PROFILE_PREFETCH_MAX_AUTHORS);

    if (authors.length === 0) {
      return;
    }

    const queryRelayUrls = this.relaysService.getOptimalRelays(
      this.utilities.getUniqueNormalizedRelayUrls(clipsRelayUrls),
      8
    );

    if (queryRelayUrls.length === 0) {
      return;
    }

    try {
      const metadataEvents = await this.pool.query(
        queryRelayUrls,
        {
          kinds: [0],
          authors,
          limit: authors.length,
        },
        4000
      );

      if (metadataEvents.length === 0) {
        return;
      }

      const latestByAuthor = new Map<string, Event>();
      metadataEvents.forEach(event => {
        const existing = latestByAuthor.get(event.pubkey);
        if (!existing || event.created_at > existing.created_at) {
          latestByAuthor.set(event.pubkey, event);
        }
      });

      await Promise.allSettled(Array.from(latestByAuthor.values()).map(event => this.database.saveEvent(event)));
    } catch (error) {
      this.logger.debug('Failed to prefetch clip author profiles from clips relays', error);
    }
  }

  private refreshExploreAutoLoadObserver(): void {
    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

    if (!this.exploreLoadObserver) {
      this.exploreLoadObserver = new IntersectionObserver(
        entries => {
          const visible = entries.some(entry => entry.isIntersecting);
          if (visible) {
            this.onExploreLoadSentinelVisible();
          }
        },
        {
          root: null,
          rootMargin: '200px 0px 300px 0px',
          threshold: 0,
        }
      );
    }

    this.exploreLoadObserver.disconnect();

    if (this.selectedTabIndex() !== 0 || this.loading() || !this.hasMoreExploreClips()) {
      return;
    }

    setTimeout(() => {
      const sentinel = this.exploreLoadSentinel()?.nativeElement;
      if (!sentinel || !this.exploreLoadObserver || this.selectedTabIndex() !== 0 || !this.hasMoreExploreClips()) {
        return;
      }
      this.exploreLoadObserver.observe(sentinel);
    }, 0);
  }

  private onExploreLoadSentinelVisible(): void {
    if (this.exploreAutoLoadInProgress || this.selectedTabIndex() !== 0 || this.loading() || !this.hasMoreExploreClips()) {
      return;
    }

    this.exploreAutoLoadInProgress = true;
    this.loadMoreExploreClips();

    setTimeout(() => {
      this.exploreAutoLoadInProgress = false;
      this.refreshExploreAutoLoadObserver();
    }, 0);
  }
}
