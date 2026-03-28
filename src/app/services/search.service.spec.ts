import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { SearchService, SearchResultProfile } from './search.service';

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
        service = Object.assign(Object.create(SearchService.prototype), {
            searchResults: signal([]),
            logger: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                debug: vi.fn(),
            },
        }) as SearchService;
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

        it('should return 0 for exact match on display_name', () => {
            const profile = createProfile({ display_name: 'hus' });
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

        it('should return 1 for starts-with match on display_name', () => {
            const profile = createProfile({ display_name: 'Hustle King' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(1);
        });

        it('should return 2 for contains match on name', () => {
            const profile = createProfile({ name: 'xhus_dev' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(2);
        });

        it('should return 2 for contains match on display_name', () => {
            const profile = createProfile({ display_name: 'The Hustle' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(2);
        });

        it('should return 2 for contains match on NIP-05', () => {
            const profile = createProfile({ nip05: 'user@huskfire.com' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(2);
        });

        it('should return 3 for match only in about', () => {
            const profile = createProfile({ name: 'alice', about: 'I like huskies' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(3);
        });

        it('should return 4 for no match', () => {
            const profile = createProfile({ name: 'alice', about: 'Developer' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(4);
        });

        it('should return 4 for empty query', () => {
            const profile = createProfile({ name: 'hus' });
            expect(service.getRelevanceScore(profile, '')).toBe(4);
        });

        it('should prefer name exact match over NIP-05 starts-with', () => {
            const exactName = createProfile({ name: 'hus', nip05: 'other@example.com' });
            const nip05StartsWith = createProfile({ name: 'other', nip05: 'hustler@example.com' });
            expect(service.getRelevanceScore(exactName, 'hus'))
                .toBeLessThan(service.getRelevanceScore(nip05StartsWith, 'hus'));
        });

        it('should handle profiles with no data fields gracefully', () => {
            const profile = createProfile({});
            expect(service.getRelevanceScore(profile, 'hus')).toBe(4);
        });

        it('should handle NIP-05 without @ (no domain)', () => {
            const profile = createProfile({ nip05: 'hus' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(0);
        });

        it('should correctly score NIP-05 domain-only match as contains', () => {
            // NIP-05 is user@domain, search matches domain part
            const profile = createProfile({ name: 'alice', nip05: 'alice@hus.app' });
            expect(service.getRelevanceScore(profile, 'hus')).toBe(2);
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

        it('should rank exact display_name match at same level as exact name match', () => {
            const nameExact = createProfile({ name: 'meg', pubkey: 'a'.repeat(64) });
            const displayNameExact = createProfile({ display_name: 'meg', pubkey: 'b'.repeat(64) });

            expect(service.getRelevanceScore(nameExact, 'meg'))
                .toBe(service.getRelevanceScore(displayNameExact, 'meg'));
        });

        it('should prioritize exact match over source priority in sorting', () => {
            const followingContains = createProfile({ name: 'enthused', source: 'following', pubkey: 'a'.repeat(64) });
            const cachedExact = createProfile({ name: 'hus', source: 'cached', pubkey: 'b'.repeat(64) });
            const sorted = service['sortByRelevance']([followingContains, cachedExact], 'hus');

            expect(sorted[0]).toBe(cachedExact);
        });

        it('should put an exact match before a longer prefix match', () => {
            const longerPrefix = createProfile({ name: 'Megan', source: 'following', pubkey: 'a'.repeat(64) });
            const exact = createProfile({ name: 'meg', source: 'cached', pubkey: 'b'.repeat(64) });
            const sorted = service['sortByRelevance']([longerPrefix, exact], 'meg');

            expect(sorted[0]).toBe(exact);
        });
    });
});
