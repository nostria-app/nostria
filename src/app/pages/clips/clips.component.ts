import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatMenuModule } from '@angular/material/menu';
import { Event, Filter } from 'nostr-tools';
import { SwipeEvent, SwipeGestureDirective, SwipeProgressEvent } from '../../directives/swipe-gesture.directive';
import { CommentsListComponent } from '../../components/comments-list/comments-list.component';
import { AccountStateService } from '../../services/account-state.service';
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
    MatTabsModule,
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
  private database = inject(DatabaseService);
  private reporting = inject(ReportingService);
  private utilities = inject(UtilitiesService);
  private layout = inject(LayoutService);
  private logger = inject(LoggerService);

  loading = signal(true);
  selectedTabIndex = signal(0);
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

  commentsOpen = signal(false);
  commentsEvent = signal<Event | null>(null);

  eligibleClips = computed(() => {
    const events = this.allClips();
    const includeArchive = this.includeArchive();
    const archiveOnly = this.archiveOnly();

    return events
      .filter(event => this.isPortraitShortFormVideo(event))
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
    if (this.layout.isHandset()) {
      this.layout.hideMobileNav.set(true);
    }
    await this.initializeClips();
  }

  ngOnDestroy(): void {
    this.layout.hideMobileNav.set(false);
  }

  async refresh(): Promise<void> {
    await this.loadClips();
  }

  onTabChange(index: number): void {
    this.selectedTabIndex.set(index);
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
    await this.loadClips();
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
    this.loading.set(true);

    try {
      const relayUrls = this.clipsRelays().length > 0 ? this.clipsRelays() : DEFAULT_CLIPS_RELAYS;
      const filter: Filter = {
        kinds: [...CLIPS_KINDS],
        limit: 300,
      };

      const dedupedMap = new Map<string, Event>();

      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => {
          resolve();
        }, 7000);

        const subscription = this.pool.subscribe(relayUrls, filter, (event: Event) => {
          if (this.reporting.isUserBlocked(event.pubkey) || this.reporting.isContentBlocked(event)) {
            return;
          }

          const dedupeKey = this.getDedupeKey(event);
          const existing = dedupedMap.get(dedupeKey);

          if (!existing || event.created_at > existing.created_at) {
            dedupedMap.set(dedupeKey, event);
          }
        });

        setTimeout(() => {
          subscription.close();
          clearTimeout(timeout);
          resolve();
        }, 4500);
      });

      const clips = Array.from(dedupedMap.values()).sort((a, b) => b.created_at - a.created_at);
      this.allClips.set(clips);
      this.resetExploreLimit();
      this.ensureIndexesInRange();
    } catch (error) {
      this.logger.error('Failed to load clips', error);
    } finally {
      this.loading.set(false);
    }
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
  }

  private resetExploreLimit(): void {
    this.exploreLimit.set(EXPLORE_PAGE_SIZE);
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
    const hasPlatformVine = event.tags.some(tag => tag[0] === 'platform' && tag[1] === 'vine');
    const hasOriginVine = event.tags.some(tag => tag[0] === 'origin' && tag[1] === 'vine');
    const hasVineId = event.tags.some(tag => tag[0] === 'vine_id' && !!tag[1]);
    const hasArchiveLabel = event.tags.some(
      tag => tag[0] === 'l' && tag[1] === 'vine-archive' && tag[2] === 'archive.divine.video'
    );
    const hasArchiveNamespace = event.tags.some(tag => tag[0] === 'L' && tag[1] === 'archive.divine.video');

    return hasPlatformVine || hasOriginVine || hasVineId || hasArchiveLabel || hasArchiveNamespace;
  }
}
