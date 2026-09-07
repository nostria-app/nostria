import { Event } from 'nostr-tools';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { UtilitiesService } from '../../services/utilities.service';
import { ReportingService } from '../../services/reporting.service';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { LayoutService } from '../../services/layout.service';
import { DatabaseService } from '../../services/database.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { UserRelayService } from '../../services/relays/user-relay';
import { UserRelaysService } from '../../services/relays/user-relays';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { FollowSetsService, FollowSet } from '../../services/follow-sets.service';
import { LoggerService } from '../../services/logger.service';

import { ArticlesDiscoverComponent, filterVisibleArticles } from './articles.component';

function createArticleEvent(id: string, pubkey: string, createdAt: number): Event {
  return {
    id,
    pubkey,
    created_at: createdAt,
    kind: 30023,
    tags: [['d', id]],
    content: `article-${id}`,
    sig: `sig-${id}`,
  };
}

describe('filterVisibleArticles', () => {
  it('removes blocked articles from the rendered listing', () => {
    const articles = [
      createArticleEvent('a', 'pubkey-a', 1),
      createArticleEvent('b', 'pubkey-b', 2),
      createArticleEvent('c', 'pubkey-c', 3),
    ];

    const visible = filterVisibleArticles(articles, article => article.pubkey === 'pubkey-b');

    expect(visible.map(article => article.id)).toEqual(['a', 'c']);
  });

  it('preserves the order of visible articles', () => {
    const articles = [
      createArticleEvent('first', 'pubkey-a', 1),
      createArticleEvent('second', 'pubkey-b', 2),
      createArticleEvent('third', 'pubkey-c', 3),
    ];

    const visible = filterVisibleArticles(articles, article => article.id === 'second');

    expect(visible.map(article => article.id)).toEqual(['first', 'third']);
  });
});

describe('Article history pagination', () => {
  let fixture: ComponentFixture<ArticlesDiscoverComponent>;
  let component: ArticlesDiscoverComponent;
  const query = vi.fn<RelayPoolService['query']>();
  const subscribe = vi.fn<RelayPoolService['subscribe']>();
  const followingList = signal<string[]>([]);
  const followSets = signal<FollowSet[]>([]);
  const intersections: (() => void)[] = [];

  beforeEach(async () => {
    query.mockReset().mockResolvedValue([]);
    subscribe.mockReset().mockReturnValue({ close: vi.fn() });
    followingList.set([]);
    followSets.set([]);
    intersections.length = 0;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        intersections.push(() => callback([{ isIntersecting: true }]));
      }
      observe(): void { /* Intersections are driven explicitly by the tests. */ }
      disconnect(): void { /* No native observer was allocated. */ }
    });
    await TestBed.configureTestingModule({
      imports: [ArticlesDiscoverComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: RelayPoolService, useValue: { query, subscribe } satisfies Pick<RelayPoolService, 'query' | 'subscribe'> },
        { provide: AccountStateService, useValue: { pubkey: signal(''), followingList } satisfies Pick<AccountStateService, 'pubkey' | 'followingList'> },
        { provide: FollowSetsService, useValue: { followSets } satisfies Pick<FollowSetsService, 'followSets'> },
        { provide: ApplicationService, useValue: { authenticated: signal(false) } satisfies Pick<ApplicationService, 'authenticated'> },
        { provide: AccountRelayService, useValue: { getRelayUrls: () => ['wss://one.test', 'wss://two.test'] } satisfies Pick<AccountRelayService, 'getRelayUrls'> },
        { provide: UtilitiesService, useValue: { anonymousRelays: ['wss://anonymous.test'] } satisfies Pick<UtilitiesService, 'anonymousRelays'> },
        { provide: DatabaseService, useValue: {
          getEventsByPubkeyAndKind: vi.fn().mockResolvedValue([]),
          saveEvent: vi.fn().mockResolvedValue(undefined),
        } satisfies Pick<DatabaseService, 'getEventsByPubkeyAndKind' | 'saveEvent'> },
        { provide: ReportingService, useValue: {
          isContentBlocked: () => false, isUserBlocked: () => false,
        } satisfies Pick<ReportingService, 'isContentBlocked' | 'isUserBlocked'> },
        { provide: UserRelaysService, useValue: { getUserRelays: vi.fn().mockResolvedValue([]) } satisfies Pick<UserRelaysService, 'getUserRelays'> },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
        { provide: Router, useValue: { navigate: vi.fn() } },
        ...[RelaysService, LayoutService, UserRelayService, AccountLocalStateService].map(provide => ({ provide, useValue: {} })),
        { provide: LoggerService, useValue: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } },
      ],
    }).overrideComponent(ArticlesDiscoverComponent, {
      set: { imports: [], template: '<div #loadMoreSentinel></div>' },
    }).compileComponents();
    fixture = TestBed.createComponent(ArticlesDiscoverComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
    component.loading.set(false);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetches beyond the initial subscription and maintains an independent cursor per relay', async () => {
    query.mockImplementation(async ([relay]) => [
      createArticleEvent(relay, 'author', relay === 'wss://one.test' ? 100 : 200),
    ]);
    await component.loadMore();
    expect(component.currentArticles()).toHaveLength(2);
    expect(component.hasMore()).toBe(true);
    query.mockClear();
    await component.loadMore();
    expect(query).toHaveBeenCalledWith(['wss://one.test'], expect.objectContaining({ until: 100 }));
    expect(query).toHaveBeenCalledWith(['wss://two.test'], expect.objectContaining({ until: 200 }));
    expect(component.currentArticles()).toHaveLength(2);
  });

  it('reveals cached articles before requesting older history', async () => {
    const receive = subscribe.mock.calls[0][2];
    for (let i = 0; i < 25; i++) receive(createArticleEvent(`cached-${i}`, 'author', 100 + i));
    expect(component.currentArticles()).toHaveLength(10);
    await component.loadMore();
    expect(component.currentArticles()).toHaveLength(20);
    expect(query).not.toHaveBeenCalled();
    await component.loadMore();
    expect(component.currentArticles()).toHaveLength(25);
    await component.loadMore();
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('re-arms scrolling after a page when the sentinel remains visible', async () => {
    query.mockResolvedValue([createArticleEvent('history', 'author', 100)]);
    intersections.at(-1)!();
    await fixture.whenStable();
    expect(query).toHaveBeenCalledTimes(2);
    intersections.at(-1)!();
    await fixture.whenStable();
    expect(query).toHaveBeenCalledTimes(4);
  });

  it('pauses automatic loading on empty responses while allowing a manual retry', async () => {
    const observerCount = intersections.length;
    await component.loadMore();
    await fixture.whenStable();
    expect(intersections).toHaveLength(observerCount);
    expect(component.hasMore()).toBe(true);
    await component.loadMore();
    expect(query).toHaveBeenCalledTimes(4);
    expect(component.loadingMore()).toBe(false);
  });

  it('keeps concurrent scroll notifications from starting overlapping queries', async () => {
    let resolvePage!: (events: Event[]) => void;
    const page = new Promise<Event[]>(resolve => { resolvePage = resolve; });
    query.mockReturnValue(page);
    const firstLoad = component.loadMore();
    await component.loadMore();
    expect(query).toHaveBeenCalledTimes(2);
    resolvePage([]);
    await firstLoad;
  });

  it('paginates a selected people list using its authors even when its cache is empty', async () => {
    followSets.set([{ id: 'set', dTag: 'reading', title: 'Reading', pubkeys: ['reader'], createdAt: 1, isPrivate: false }]);
    component.selectedListFilter.set('reading');
    component.showFollowing.set(true);
    component.showPublic.set(false);
    await component.loadMore();
    expect(query).toHaveBeenCalledWith(['wss://one.test'], expect.objectContaining({ authors: ['reader'] }));
  });

  it('ignores history responses from a request invalidated by refresh', async () => {
    let resolvePage!: (events: Event[]) => void;
    const page = new Promise<Event[]>(resolve => { resolvePage = resolve; });
    query.mockReturnValue(page);
    const pending = component.loadMore();
    component.refresh();
    resolvePage([createArticleEvent('stale', 'author', 100)]);
    await pending;
    expect(component.currentArticles()).toEqual([]);
  });

  it('expands the inclusive boundary query for articles sharing the same timestamp', async () => {
    const now = 1000;
    vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
    const sameSecond = Array.from({ length: 30 }, (_, i) => createArticleEvent(`tie-${i}`, 'author', now));
    query.mockResolvedValue(sameSecond);
    await component.loadMore();
    await component.loadMore(); // Reveal the remaining cached previews.
    query.mockClear();
    await component.loadMore();
    expect(query).toHaveBeenCalledWith(['wss://one.test'], expect.objectContaining({ until: now, limit: 60 }));
  });
});
