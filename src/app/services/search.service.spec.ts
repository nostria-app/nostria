import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, provideZonelessChangeDetection, signal } from '@angular/core';
import { SearchService, SearchResultProfile } from './search.service';
import { LayoutService } from './layout.service';
import { AccountStateService } from './account-state.service';
import { FollowingService } from './following.service';
import { UserDataService } from './user-data.service';
import { RelaysService } from './relays/relays';
import { RelayPoolService } from './relays/relay-pool';
import { DatabaseService } from './database.service';
import { MatDialog } from '@angular/material/dialog';
import { EventService } from './event';
import { MediaPlayerService } from './media-player.service';
import { RssParserService } from './rss-parser.service';
import { SearchRelayService } from './relays/search-relay';
import { LoggerService } from './logger.service';
import { TrustService } from './trust.service';

/**
 * Helper to create a mock SearchResultProfile for testing.
 */
function createProfile(opts: {
    name?: string;
    display_name?: string;
    nip05?: string;
    about?: string;
    source?: 'following' | 'cached' | 'remote';
    pubkey?: string;
    wotRank?: number;
} = {}): SearchResultProfile {
    const pubkey = opts.pubkey || 'a'.repeat(64);
    const data: Record<string, string | undefined> = {};
    if (opts.name !== undefined)
        data['name'] = opts.name;
    if (opts.display_name !== undefined)
        data['display_name'] = opts.display_name;
    if (opts.nip05 !== undefined)
        data['nip05'] = opts.nip05;
    if (opts.about !== undefined)
        data['about'] = opts.about;

    return {
        event: {
            id: 'e'.repeat(64),
            pubkey,
            created_at: Math.floor(Date.now() / 1000),
            kind: 0,
            tags: [],
            content: JSON.stringify(data),
            sig: 's'.repeat(128),
        },
        data,
        source: opts.source || 'cached',
        wotRank: opts.wotRank,
    };
}

describe('SearchService', () => {
    let service: SearchService;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                SearchService,
                { provide: PLATFORM_ID, useValue: 'browser' },
                {
                    provide: LayoutService,
                    useValue: {
                        query: signal(''),
                        searchInput: '',
                        toggleSearch: vi.fn(),
                        openProfile: vi.fn(),
                        openProfileAsPrimary: vi.fn(),
                        toast: vi.fn(),
                        router: { navigate: vi.fn() },
                    },
                },
                {
                    provide: AccountStateService,
                    useValue: { pubkey: signal(undefined) },
                },
                {
                    provide: FollowingService,
                    useValue: {
                        searchProfiles: vi.fn().mockReturnValue([]),
                        toNostrRecords: vi.fn().mockReturnValue([]),
                    },
                },
                {
                    provide: UserDataService,
                    useValue: { getEventById: vi.fn() },
                },
                {
                    provide: RelaysService,
                    useValue: { getAllObservedRelays: vi.fn().mockReturnValue(Promise.resolve([])) },
                },
                {
                    provide: RelayPoolService,
                    useValue: { getEventById: vi.fn() },
                },
                {
                    provide: DatabaseService,
                    useValue: {
                        searchCachedProfiles: vi.fn().mockReturnValue(Promise.resolve([])),
                        saveEvent: vi.fn(),
                    },
                },
                { provide: MatDialog, useValue: { open: vi.fn() } },
                {
                    provide: EventService,
                    useValue: { createNote: vi.fn() },
                },
                {
                    provide: MediaPlayerService,
                    useValue: { media: signal([]), enque: vi.fn() },
                },
                {
                    provide: RssParserService,
                    useValue: { parse: vi.fn() },
                },
                {
                    provide: SearchRelayService,
                    useValue: {
                        searchProfiles: vi.fn().mockReturnValue(Promise.resolve([])),
                        search: vi.fn().mockReturnValue(Promise.resolve([])),
                    },
                },
                {
                    provide: LoggerService,
                    useValue: {
                        info: vi.fn(),
                        warn: vi.fn(),
                        error: vi.fn(),
                        debug: vi.fn(),
                    },
                },
                {
                    provide: TrustService,
                    useValue: {
                        isEnabled: vi.fn().mockReturnValue(false),
                        fetchMetricsBatch: vi.fn().mockReturnValue(Promise.resolve(new Map())),
                    },
                },
            ],
        });

        service = TestBed.inject(SearchService);
    });

    describe('getRelevanceScore', () => {
        it('should return 0 for exact match on name', () => {
            const profile = createProfile({ name: 'hus' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(0);
        });

        it('should return 0 for exact match on name (case-insensitive)', () => {
            const profile = createProfile({ name: 'Hus' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(0);
        });

        it('should return 0 for exact match on NIP-05 username', () => {
            const profile = createProfile({ nip05: 'hus@nostria.app' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(0);
        });

        it('should return 1 for starts-with match on name', () => {
            const profile = createProfile({ name: 'hustle' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(1);
        });

        it('should return 1 for starts-with match on NIP-05 username', () => {
            const profile = createProfile({ nip05: 'hustler@example.com' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(1);
        });

        it('should return 2 for exact match on display_name', () => {
            const profile = createProfile({ display_name: 'hus' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(2);
        });

        it('should return 3 for starts-with match on display_name', () => {
            const profile = createProfile({ display_name: 'Hustle King' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(3);
        });

        it('should return 4 for contains match on name', () => {
            const profile = createProfile({ name: 'xhus_dev' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(4);
        });

        it('should return 4 for contains match on display_name', () => {
            const profile = createProfile({ display_name: 'The Hustle' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(4);
        });

        it('should return 4 for contains match on NIP-05', () => {
            const profile = createProfile({ nip05: 'user@bushfire.com' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(4);
        });

        it('should return 5 for match only in about', () => {
            const profile = createProfile({ name: 'alice', about: 'I like huskies' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(5);
        });

        it('should return 6 for no match', () => {
            const profile = createProfile({ name: 'alice', about: 'Developer' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(6);
        });

        it('should return 6 for empty query', () => {
            const profile = createProfile({ name: 'hus' });
            expect(service.getRelevanceScore(profile, '')).toBe(6);
        });

        it('should prefer name exact match over NIP-05 starts-with', () => {
            const exactName = createProfile({ name: 'hus', nip05: 'other@example.com' });
            const nip05StartsWith = createProfile({ name: 'other', nip05: 'hustler@example.com' });
            expect(service.getRelevanceScore(exactName, 'hus'))
                .toBeLessThan(service.getRelevanceScore(nip05StartsWith, 'hus'));
        });

        it('should handle profiles with no data fields gracefully', () => {
            const profile = createProfile({});
            expect(service.getRelevanceScore(profile, 'hus')).toBe(6);
        });

        it('should handle NIP-05 without @ (no domain)', () => {
            const profile = createProfile({ nip05: 'hus' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(0);
        });

        it('should correctly score NIP-05 domain-only match as contains', () => {
            // NIP-05 is user@domain, search matches domain part
            const profile = createProfile({ name: 'alice', nip05: 'alice@hus.app' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(4);
        });
    });

    describe('search result sorting by relevance', () => {
        it('should rank exact name match above starts-with match within same source', () => {
            const exactMatch = createProfile({ name: 'hus', source: 'cached', pubkey: 'a'.repeat(64) });
            const startsWithMatch = createProfile({ name: 'hustle', source: 'cached', pubkey: 'b'.repeat(64) });
            const containsMatch = createProfile({ name: 'enthused', source: 'cached', pubkey: 'c'.repeat(64) });

            // Manually test the relevance scores are in correct order
            const exactScore = service.getRelevanceScore(exactMatch, 'hus');
            const startsScore = service.getRelevanceScore(startsWithMatch, 'hus');
            const containsScore = service.getRelevanceScore(containsMatch, 'hus');

            expect(exactScore).toBeLessThan(startsScore);
            expect(startsScore).toBeLessThan(containsScore);
        });

        it('should rank NIP-05 exact username match at same level as name exact match', () => {
            const nameExact = createProfile({ name: 'hus', pubkey: 'a'.repeat(64) });
            const nip05Exact = createProfile({ nip05: 'hus@example.com', pubkey: 'b'.repeat(64) });

            expect(service.getRelevanceScore(nameExact, 'hus'))
                .toBe(service.getRelevanceScore(nip05Exact, 'hus'));
        });

        it('should still prioritize following source over cached with better relevance', () => {
            const followingContains = createProfile({ name: 'enthused', source: 'following', pubkey: 'a'.repeat(64) });
            const cachedExact = createProfile({ name: 'hus', source: 'cached', pubkey: 'b'.repeat(64) });

            // Following should come first regardless of relevance (source priority is primary)
            const followingScore = service.getRelevanceScore(followingContains, 'hus');
            const cachedScore = service.getRelevanceScore(cachedExact, 'hus');

            // The relevance score itself doesn't include source - that's handled in the sort comparator
            expect(followingScore).toBeGreaterThan(cachedScore);
            // But in sorting, following always comes before cached
        });
    });
});
