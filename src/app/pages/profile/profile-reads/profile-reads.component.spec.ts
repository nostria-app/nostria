import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ProfileReadsComponent } from './profile-reads.component';
import { NostrService } from '../../../services/nostr.service';
import { PROFILE_STATE } from '../../../services/profile-state-factory.service';
import { LayoutService } from '../../../services/layout.service';
import { LoggerService } from '../../../services/logger.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { BookmarkService } from '../../../services/bookmark.service';
import { EventService } from '../../../services/event';
import { SharedRelayService } from '../../../services/relays/shared-relay';
import { ZapService } from '../../../services/zap.service';
import { AccountStateService } from '../../../services/account-state.service';
import { UserRelaysService } from '../../../services/relays/user-relays';
import { NostrRecord } from '../../../interfaces';
import { Event } from 'nostr-tools';

function createMockEvent(id: string, createdAt: number, kind = 30023): Event {
  return {
    id,
    pubkey: 'test-pubkey',
    created_at: createdAt,
    kind,
    tags: [['d', `slug-${id}`], ['title', `Article ${id}`]],
    content: 'Test article content',
    sig: 'test-sig',
  };
}

function createMockNostrRecord(id: string, createdAt: number, kind = 30023): NostrRecord {
  return {
    event: createMockEvent(id, createdAt, kind),
    data: {},
  };
}

describe('ProfileReadsComponent', () => {
  let component: ProfileReadsComponent;
  let fixture: ComponentFixture<ProfileReadsComponent>;

  // Mock signals for profile state
  const mockPubkey = signal<string>('test-pubkey');
  const mockArticles = signal<NostrRecord[]>([]);
  const mockSortedArticles = signal<NostrRecord[]>([]);
  const mockIsLoadingMoreArticles = signal<boolean>(false);
  const mockHasMoreArticles = signal<boolean>(true);
  const mockIsInitiallyLoading = signal<boolean>(false);
  const mockIsInRightPanel = signal<boolean>(false);

  const mockProfileState = {
    pubkey: mockPubkey,
    articles: mockArticles,
    sortedArticles: mockSortedArticles,
    isLoadingMoreArticles: mockIsLoadingMoreArticles,
    hasMoreArticles: mockHasMoreArticles,
    isInitiallyLoading: mockIsInitiallyLoading,
    isInRightPanel: mockIsInRightPanel,
    loadMoreArticles: jasmine.createSpy('loadMoreArticles').and.returnValue(Promise.resolve([])),
  };

  const mockLayoutService = {
    isBrowser: signal(true),
    leftPanelScrolledToBottom: signal(false),
    rightPanelScrolledToBottom: signal(false),
    leftPanelScrollReady: signal(false),
    rightPanelScrollReady: signal(false),
    openArticle: jasmine.createSpy('openArticle'),
    copyToClipboard: jasmine.createSpy('copyToClipboard'),
  };

  const mockLoggerService = {
    debug: jasmine.createSpy('debug'),
    info: jasmine.createSpy('info'),
    warn: jasmine.createSpy('warn'),
    error: jasmine.createSpy('error'),
  };

  const mockUtilitiesService = {
    getTagValues: jasmine.createSpy('getTagValues').and.callFake((tag: string, tags: string[][]) => {
      const found = tags.filter(t => t[0] === tag).map(t => t[1]);
      return found.length > 0 ? found : [''];
    }),
    normalizeRelayUrls: jasmine.createSpy('normalizeRelayUrls').and.callFake((urls: string[]) => urls),
  };

  const mockBookmarkService = {};

  const mockEventService = {
    loadReactions: jasmine.createSpy('loadReactions').and.returnValue(Promise.resolve({ events: [] })),
  };

  const mockSharedRelayService = {
    getMany: jasmine.createSpy('getMany').and.returnValue(Promise.resolve([])),
  };

  const mockZapService = {
    getZapsForEvent: jasmine.createSpy('getZapsForEvent').and.returnValue(Promise.resolve([])),
    parseZapReceipt: jasmine.createSpy('parseZapReceipt').and.returnValue({ amount: 0 }),
  };

  const mockAccountStateService = {
    pubkey: jasmine.createSpy('pubkey').and.returnValue('user-pubkey'),
  };

  const mockUserRelaysService = {
    ensureRelaysForPubkey: jasmine.createSpy('ensureRelaysForPubkey').and.returnValue(Promise.resolve()),
    getRelaysForPubkey: jasmine.createSpy('getRelaysForPubkey').and.returnValue([]),
  };

  const mockActivatedRoute = {
    parent: {
      snapshot: {
        paramMap: {
          get: jasmine.createSpy('get').and.returnValue('test-pubkey'),
        },
      },
    },
  };

  const mockRouter = {};

  const mockNostrService = {};

  beforeEach(async () => {
    // Reset signals
    mockPubkey.set('test-pubkey');
    mockArticles.set([]);
    mockSortedArticles.set([]);
    mockIsLoadingMoreArticles.set(false);
    mockHasMoreArticles.set(true);
    mockIsInitiallyLoading.set(false);
    mockIsInRightPanel.set(false);
    mockLayoutService.leftPanelScrolledToBottom.set(false);
    mockLayoutService.rightPanelScrolledToBottom.set(false);
    mockLayoutService.leftPanelScrollReady.set(false);
    mockLayoutService.rightPanelScrollReady.set(false);

    // Reset spies
    mockProfileState.loadMoreArticles.calls.reset();
    mockProfileState.loadMoreArticles.and.returnValue(Promise.resolve([]));
    mockLayoutService.openArticle.calls.reset();
    mockLayoutService.copyToClipboard.calls.reset();
    mockUtilitiesService.getTagValues.calls.reset();
    mockEventService.loadReactions.calls.reset();
    mockSharedRelayService.getMany.calls.reset();
    mockZapService.getZapsForEvent.calls.reset();
    mockZapService.parseZapReceipt.calls.reset();

    await TestBed.configureTestingModule({
      imports: [ProfileReadsComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: PROFILE_STATE, useValue: mockProfileState },
        { provide: LayoutService, useValue: mockLayoutService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: UtilitiesService, useValue: mockUtilitiesService },
        { provide: BookmarkService, useValue: mockBookmarkService },
        { provide: EventService, useValue: mockEventService },
        { provide: SharedRelayService, useValue: mockSharedRelayService },
        { provide: ZapService, useValue: mockZapService },
        { provide: AccountStateService, useValue: mockAccountStateService },
        { provide: UserRelaysService, useValue: mockUserRelaysService },
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: Router, useValue: mockRouter },
        { provide: NostrService, useValue: mockNostrService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileReadsComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('input signals', () => {
    it('should default isVisible to false', () => {
      expect(component.isVisible()).toBeFalse();
    });

    it('should accept isVisible input via setInput', () => {
      fixture.componentRef.setInput('isVisible', true);
      expect(component.isVisible()).toBeTrue();
    });

    it('should update isVisible when input changes', () => {
      fixture.componentRef.setInput('isVisible', true);
      expect(component.isVisible()).toBeTrue();

      fixture.componentRef.setInput('isVisible', false);
      expect(component.isVisible()).toBeFalse();
    });
  });

  describe('sortedArticles', () => {
    it('should expose sortedArticles from profile state', () => {
      const records = [
        createMockNostrRecord('1', 1000),
        createMockNostrRecord('2', 2000),
      ];
      mockSortedArticles.set(records);

      expect(component.sortedArticles()).toEqual(records);
    });

    it('should return empty array when no articles', () => {
      expect(component.sortedArticles()).toEqual([]);
    });
  });

  describe('loadMoreArticles', () => {
    it('should call profileState.loadMoreArticles', async () => {
      await component.loadMoreArticles();
      expect(mockProfileState.loadMoreArticles).toHaveBeenCalled();
    });

    it('should not load when already loading', async () => {
      mockIsLoadingMoreArticles.set(true);
      await component.loadMoreArticles();
      expect(mockProfileState.loadMoreArticles).not.toHaveBeenCalled();
    });

    it('should not load when no more articles available', async () => {
      mockHasMoreArticles.set(false);
      await component.loadMoreArticles();
      expect(mockProfileState.loadMoreArticles).not.toHaveBeenCalled();
    });

    it('should set error signal on failure', async () => {
      mockProfileState.loadMoreArticles.and.returnValue(Promise.reject(new Error('Network error')));
      await component.loadMoreArticles();
      expect(component.error()).toBe('Failed to load older articles. Please try again.');
    });

    it('should pass oldest timestamp when articles exist', async () => {
      const articles = [
        createMockNostrRecord('1', 3000),
        createMockNostrRecord('2', 1000),
        createMockNostrRecord('3', 2000),
      ];
      mockArticles.set(articles);

      await component.loadMoreArticles();
      expect(mockProfileState.loadMoreArticles).toHaveBeenCalledWith(999);
    });
  });

  describe('getArticleTitle', () => {
    it('should extract title from event tags', () => {
      const event = createMockEvent('1', 1000);
      const title = component.getArticleTitle(event);
      expect(title).toBe('Article 1');
    });
  });

  describe('getArticleImage', () => {
    it('should extract image from event tags', () => {
      const event = createMockEvent('1', 1000);
      event.tags.push(['image', 'https://example.com/image.jpg']);
      const image = component.getArticleImage(event);
      expect(image).toBe('https://example.com/image.jpg');
    });

    it('should return empty string when no image tag', () => {
      const event = createMockEvent('1', 1000);
      const image = component.getArticleImage(event);
      expect(image).toBe('');
    });
  });

  describe('formatZapAmount', () => {
    it('should format millions with M suffix', () => {
      expect(component.formatZapAmount(1500000)).toBe('1.5M');
    });

    it('should format thousands with k suffix', () => {
      expect(component.formatZapAmount(1500)).toBe('1.5k');
    });

    it('should return raw number for amounts under 1000', () => {
      expect(component.formatZapAmount(500)).toBe('500');
    });

    it('should handle zero', () => {
      expect(component.formatZapAmount(0)).toBe('0');
    });
  });

  describe('getPubkey', () => {
    it('should get pubkey from parent route', () => {
      expect(component.getPubkey()).toBe('test-pubkey');
    });
  });

  describe('template rendering', () => {
    it('should show loading state when initially loading with no articles', async () => {
      mockIsInitiallyLoading.set(true);
      mockSortedArticles.set([]);
      fixture.detectChanges();
      await fixture.whenStable();

      const el = fixture.nativeElement as HTMLElement;
      const loadingState = el.querySelector('.loading-state');
      expect(loadingState).toBeTruthy();
    });

    it('should show empty state when not loading and no articles', async () => {
      mockIsInitiallyLoading.set(false);
      mockIsLoadingMoreArticles.set(false);
      mockSortedArticles.set([]);
      fixture.detectChanges();
      await fixture.whenStable();

      const el = fixture.nativeElement as HTMLElement;
      const emptyState = el.querySelector('.empty-state');
      expect(emptyState).toBeTruthy();
      expect(emptyState?.textContent).toContain('No articles to display yet');
    });

    it('should show articles grid when articles are present', async () => {
      mockSortedArticles.set([createMockNostrRecord('1', 1000)]);
      fixture.detectChanges();
      await fixture.whenStable();

      const el = fixture.nativeElement as HTMLElement;
      const grid = el.querySelector('.articles-grid');
      expect(grid).toBeTruthy();
    });

    it('should show loading more indicator when loading more articles', async () => {
      mockSortedArticles.set([createMockNostrRecord('1', 1000)]);
      mockIsLoadingMoreArticles.set(true);
      fixture.detectChanges();
      await fixture.whenStable();

      const el = fixture.nativeElement as HTMLElement;
      const loadingMore = el.querySelector('.loading-more-indicator');
      expect(loadingMore).toBeTruthy();
    });

    it('should show end message when no more articles', async () => {
      const articles = [createMockNostrRecord('1', 1000)];
      mockSortedArticles.set(articles);
      mockArticles.set(articles);
      mockHasMoreArticles.set(false);
      fixture.detectChanges();
      await fixture.whenStable();

      const el = fixture.nativeElement as HTMLElement;
      const endMessage = el.querySelector('.no-more-content');
      expect(endMessage).toBeTruthy();
      expect(endMessage?.textContent).toContain("You've seen all articles");
    });
  });
});
