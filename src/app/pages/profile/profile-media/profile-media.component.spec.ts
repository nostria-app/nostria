import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ProfileMediaComponent } from './profile-media.component';
import { PROFILE_STATE } from '../../../services/profile-state-factory.service';
import { LayoutService } from '../../../services/layout.service';
import { LoggerService } from '../../../services/logger.service';
import { NostrRecord } from '../../../interfaces';
import { Event } from 'nostr-tools';

function createMockMediaEvent(id: string, createdAt: number, kind = 20): Event {
    return {
        id,
        pubkey: 'test-pubkey',
        created_at: createdAt,
        kind,
        tags: [],
        content: '',
        sig: 'test-sig',
    };
}

function createMockNostrRecord(id: string, createdAt: number, kind = 20): NostrRecord {
    return {
        event: createMockMediaEvent(id, createdAt, kind),
        data: {},
    };
}

describe('ProfileMediaComponent', () => {
    let component: ProfileMediaComponent;
    let fixture: ComponentFixture<ProfileMediaComponent>;

    // Mock profile state with writable signals for test control
    const mockDisplayedMedia = signal<NostrRecord[]>([]);
    const mockIsLoadingMoreMedia = signal<boolean>(false);
    const mockHasMoreMedia = signal<boolean>(true);
    const mockHasMoreMediaToDisplay = signal<boolean>(false);
    const mockIsInitiallyLoading = signal<boolean>(false);
    const mockIsInRightPanel = signal<boolean>(false);

    const mockProfileState = {
        displayedMedia: mockDisplayedMedia,
        isLoadingMoreMedia: mockIsLoadingMoreMedia,
        hasMoreMedia: mockHasMoreMedia,
        hasMoreMediaToDisplay: mockHasMoreMediaToDisplay,
        isInitiallyLoading: mockIsInitiallyLoading,
        isInRightPanel: mockIsInRightPanel,
        increaseMediaDisplayLimit: vi.fn(),
        loadMoreMedia: vi.fn().mockReturnValue(Promise.resolve([])),
    };

    const mockLayoutService = {
        isBrowser: signal(true),
        leftPanelScrolledToBottom: signal(false),
        rightPanelScrolledToBottom: signal(false),
        leftPanelScrollReady: signal(false),
        rightPanelScrollReady: signal(false),
        refreshLeftPanelScroll: vi.fn(),
        refreshRightPanelScroll: vi.fn(),
    };

    const mockLoggerService = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    };

    beforeEach(async () => {
        // Reset signals before each test
        mockDisplayedMedia.set([]);
        mockIsLoadingMoreMedia.set(false);
        mockHasMoreMedia.set(true);
        mockHasMoreMediaToDisplay.set(false);
        mockIsInitiallyLoading.set(false);
        mockIsInRightPanel.set(false);
        mockLayoutService.leftPanelScrolledToBottom.set(false);
        mockLayoutService.rightPanelScrolledToBottom.set(false);
        mockLayoutService.leftPanelScrollReady.set(false);
        mockLayoutService.rightPanelScrollReady.set(false);

        // Reset spies
        mockProfileState.increaseMediaDisplayLimit.mockClear();
        mockProfileState.loadMoreMedia.mockClear();
        mockProfileState.loadMoreMedia.mockReturnValue(Promise.resolve([]));
        mockLayoutService.refreshLeftPanelScroll.mockClear();
        mockLayoutService.refreshRightPanelScroll.mockClear();

        await TestBed.configureTestingModule({
            imports: [ProfileMediaComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: PROFILE_STATE, useValue: mockProfileState },
                { provide: LayoutService, useValue: mockLayoutService },
                { provide: LoggerService, useValue: mockLoggerService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ProfileMediaComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('computed signals', () => {
        it('should expose media from profile state', () => {
            const records = [
                createMockNostrRecord('1', 1000, 20),
                createMockNostrRecord('2', 2000, 21),
            ];
            mockDisplayedMedia.set(records);

            expect(component.media()).toEqual(records);
        });

        it('should expose isLoadingMore from profile state', () => {
            expect(component.isLoadingMore()).toBe(false);
            mockIsLoadingMoreMedia.set(true);
            expect(component.isLoadingMore()).toBe(true);
        });

        it('should expose hasMore from profile state', () => {
            expect(component.hasMore()).toBe(true);
            mockHasMoreMedia.set(false);
            expect(component.hasMore()).toBe(false);
        });

        it('should expose hasMoreToDisplay from profile state', () => {
            expect(component.hasMoreToDisplay()).toBe(false);
            mockHasMoreMediaToDisplay.set(true);
            expect(component.hasMoreToDisplay()).toBe(true);
        });

        it('should extract events from media for navigation', () => {
            const records = [
                createMockNostrRecord('evt-1', 1000, 20),
                createMockNostrRecord('evt-2', 2000, 21),
            ];
            mockDisplayedMedia.set(records);

            const events = component.mediaEvents();
            expect(events.length).toBe(2);
            expect(events[0].id).toBe('evt-1');
            expect(events[1].id).toBe('evt-2');
        });

        it('should return empty mediaEvents when no media', () => {
            expect(component.mediaEvents()).toEqual([]);
        });
    });

    describe('loadMore', () => {
        it('should call profileState.loadMoreMedia', async () => {
            await component.loadMore();
            expect(mockProfileState.loadMoreMedia).toHaveBeenCalled();
        });

        it('should not load when already loading', async () => {
            mockIsLoadingMoreMedia.set(true);
            await component.loadMore();
            expect(mockProfileState.loadMoreMedia).not.toHaveBeenCalled();
        });

        it('should not load when no more media available', async () => {
            mockHasMoreMedia.set(false);
            await component.loadMore();
            expect(mockProfileState.loadMoreMedia).not.toHaveBeenCalled();
        });

        it('should set error signal on failure', async () => {
            mockProfileState.loadMoreMedia.mockReturnValue(Promise.reject(new Error('Network error')));
            await component.loadMore();
            expect(component.error()).toBe('Failed to load more media. Please try again.');
        });

        it('should not set error when load succeeds', async () => {
            mockProfileState.loadMoreMedia.mockReturnValue(Promise.resolve([]));
            await component.loadMore();
            expect(component.error()).toBeNull();
        });
    });

    describe('template rendering', () => {
        it('should show loading state when initially loading with no media', async () => {
            mockIsInitiallyLoading.set(true);
            mockDisplayedMedia.set([]);
            fixture.detectChanges();
            await fixture.whenStable();

            const el = fixture.nativeElement as HTMLElement;
            const loadingState = el.querySelector('.loading-state');
            expect(loadingState).toBeTruthy();
        });

        it('should show empty state when not loading and no media', async () => {
            mockIsInitiallyLoading.set(false);
            mockDisplayedMedia.set([]);
            fixture.detectChanges();
            await fixture.whenStable();

            const el = fixture.nativeElement as HTMLElement;
            const emptyState = el.querySelector('.empty-state');
            expect(emptyState).toBeTruthy();
            expect(emptyState?.textContent).toContain('No media to display yet');
        });

        it('should show media grid when media items are present', async () => {
            mockDisplayedMedia.set([
                createMockNostrRecord('1', 1000, 20),
            ]);
            fixture.detectChanges();
            await fixture.whenStable();

            const el = fixture.nativeElement as HTMLElement;
            const grid = el.querySelector('.media-grid');
            expect(grid).toBeTruthy();
        });

        it('should show loading spinner when loading more', async () => {
            mockDisplayedMedia.set([createMockNostrRecord('1', 1000)]);
            mockIsLoadingMoreMedia.set(true);
            fixture.detectChanges();
            await fixture.whenStable();

            const el = fixture.nativeElement as HTMLElement;
            const loadingMore = el.querySelector('.loading-more');
            expect(loadingMore).toBeTruthy();
        });

        it('should show end message when no more to load', async () => {
            mockDisplayedMedia.set([createMockNostrRecord('1', 1000)]);
            mockHasMoreMedia.set(false);
            mockHasMoreMediaToDisplay.set(false);
            fixture.detectChanges();
            await fixture.whenStable();

            const el = fixture.nativeElement as HTMLElement;
            const endMessage = el.querySelector('.end-message');
            expect(endMessage).toBeTruthy();
            expect(endMessage?.textContent).toContain('No more media to load');
        });

        it('should not show end message while still loading', async () => {
            mockDisplayedMedia.set([createMockNostrRecord('1', 1000)]);
            mockHasMoreMedia.set(true);
            mockHasMoreMediaToDisplay.set(false);
            fixture.detectChanges();
            await fixture.whenStable();

            const el = fixture.nativeElement as HTMLElement;
            const endMessage = el.querySelector('.end-message');
            expect(endMessage).toBeFalsy();
        });
    });

    describe('SSR safety', () => {
        it('should not set up scroll effects when not in browser', async () => {
            // Re-create with non-browser layout service
            const nonBrowserLayout = {
                ...mockLayoutService,
                isBrowser: signal(false),
            };

            await TestBed.resetTestingModule();
            await TestBed.configureTestingModule({
                imports: [ProfileMediaComponent],
                providers: [
                    provideZonelessChangeDetection(),
                    { provide: PROFILE_STATE, useValue: mockProfileState },
                    { provide: LayoutService, useValue: nonBrowserLayout },
                    { provide: LoggerService, useValue: mockLoggerService },
                ],
            }).compileComponents();

            const ssrFixture = TestBed.createComponent(ProfileMediaComponent);
            const ssrComponent = ssrFixture.componentInstance;
            expect(ssrComponent).toBeTruthy();
        });
    });
});
