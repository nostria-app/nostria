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
import { ReportingService } from '../../services/reporting.service';
import { UtilitiesService } from '../../services/utilities.service';
import { LayoutService } from '../../services/layout.service';
import { ClipsSettingsDialogComponent } from './clips-settings-dialog/clips-settings-dialog.component';
import { ClipsVideoCardComponent } from './clips-video-card/clips-video-card.component';

const RELAY_SET_KIND = 30002;
const CLIPS_RELAY_SET_D_TAG = 'clips';
const CLIPS_KINDS = [22, 34236];
const EXPLORE_PAGE_SIZE = 24;
const FOLLOWING_PROFILE_VIDEO_LIMIT = 50;
// TODO: As clip volume grows, consider reducing this limit and using a created_at-based latest window per profile.

const DEFAULT_CLIPS_RELAYS = [
  'wss://nos.lol/',
  'wss://relay.damus.io/',
  'wss://relay3.openvine.co/',
  'wss://relay.divine.video/',
];

type SwipeMode = 'following' | 'foryou';

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
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  private database = inject(DatabaseService);
  private reporting = inject(ReportingService);
  private utilities = inject(UtilitiesService);
  private layout = inject(LayoutService);
  private router = inject(Router);
  private logger = inject(LoggerService);

  loading = signal(true);
  selectedTabIndex = signal(2);
  showSettingsDialog = signal(false);

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
  private pendingForYouRestoreEventId: string | null = null;
  private forYouRestoreApplied = false;
  private exploreLoadObserver: IntersectionObserver | null = null;
  private exploreAutoLoadInProgress = false;
  private exploreLoadSentinel = viewChild<ElementRef<HTMLDivElement>>('exploreLoadSentinel');

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
  exploreClips = computed(() => this.eligibleClips());
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
    this.pendingForYouRestoreEventId = this.accountLocalState.getClipsLastForYouEventId(this.getAccountKey()) || null;

    if (this.layout.isHandset()) {
      this.layout.hideMobileNav.set(true);
    }
    await this.initializeClips();
    this.refreshExploreAutoLoadObserver();
  }

  ngOnDestroy(): void {
    this.layout.hideMobileNav.set(false);
    this.exploreLoadObserver?.disconnect();
    this.exploreLoadObserver = null;
  }

  async refresh(): Promise<void> {
    await this.loadCachedClips();
    this.loading.set(false);
    await this.loadClips();
  }

  onTabChange(index: number): void {
    this.selectedTabIndex.set(index);
    this.refreshExploreAutoLoadObserver();

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

    if (mode === 'following') {
      this.followingAnimating.set(false);
      this.followingDragOffset.set(event.deltaY);
      return;
    }

    this.forYouAnimating.set(false);
    this.forYouDragOffset.set(event.deltaY);
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

  openComments(event: Event): void {
    this.commentsEvent.set(event);
    this.commentsOpen.set(true);
  }

  closeComments(): void {
    this.commentsOpen.set(false);
    this.commentsEvent.set(null);
  }

  private async initializeClips(): Promise<void> {
    await this.loadClipsRelaySet();
    await this.loadCachedClips();
    this.loading.set(false);
    await this.loadClips();
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
        this.allClips.set(cachedClips);
        this.resetExploreLimit();
        this.ensureIndexesInRange();
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

  private async loadClips(): Promise<void> {
    if (this.allClips().length === 0) {
      this.loading.set(true);
    }

    try {
      const relayUrls = this.clipsRelays().length > 0 ? this.clipsRelays() : DEFAULT_CLIPS_RELAYS;
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
        await Promise.all(
          followingAuthors.map(author => this.collectClipsForFilter(
            relayUrls,
            {
              kinds: [...CLIPS_KINDS],
              authors: [author],
              limit: FOLLOWING_PROFILE_VIDEO_LIMIT,
            },
            dedupedMap,
            3500
          ))
        );
      }

      const clips = Array.from(dedupedMap.values()).sort((a, b) => b.created_at - a.created_at);
      this.allClips.set(clips);
      await Promise.allSettled(clips.map(event => this.database.saveEvent(event)));
      this.resetExploreLimit();
      this.ensureIndexesInRange();
    } catch (error) {
      this.logger.error('Failed to load clips', error);
    } finally {
      this.loading.set(false);
    }
  }

  private async collectClipsForFilter(
    relayUrls: string[],
    filter: Filter,
    targetMap: Map<string, Event>,
    timeoutMs: number
  ): Promise<void> {
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        resolve();
      }, timeoutMs + 2000);

      const subscription = this.pool.subscribe(relayUrls, filter, (event: Event) => {
        if (this.reporting.isUserBlocked(event.pubkey) || this.reporting.isContentBlocked(event)) {
          return;
        }

        const dedupeKey = this.getDedupeKey(event);
        const existing = targetMap.get(dedupeKey);
        if (!existing || event.created_at > existing.created_at) {
          targetMap.set(dedupeKey, event);
        }
      });

      setTimeout(() => {
        subscription.close();
        clearTimeout(timeout);
        resolve();
      }, timeoutMs);
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

    this.tryRestoreForYouPosition();

    if (this.selectedTabIndex() === 2) {
      this.persistForYouPosition();
    }
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
    if (index >= 0) {
      this.forYouIndex.set(index);
    }

    this.forYouRestoreApplied = true;
  }

  private persistForYouPosition(): void {
    const clip = this.currentForYouClip();
    if (!clip) {
      return;
    }

    this.accountLocalState.setClipsLastForYouEventId(this.getAccountKey(), clip.id);
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
