import '@angular/compiler';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { MediaPlayerService } from './media-player.service';
import { ApplicationService } from './application.service';
import { LocalStorageService } from './local-storage.service';
import { LayoutService } from './layout.service';
import { UtilitiesService } from './utilities.service';
import { WakeLockService } from './wake-lock.service';
import { OfflineMusicService } from './offline-music.service';
import { AccountStateService } from './account-state.service';
import { AccountLocalStateService } from './account-local-state.service';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MediaItem } from '../interfaces';
import { NativeMediaSessionService } from './native-media-session.service';

describe('MediaPlayerService - Media Session API', () => {
    let service: MediaPlayerService;
    let mockMediaSession: any;
    let setActionHandlerSpy: Mock;

    TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());

    beforeEach(async () => {
        TestBed.resetTestingModule();
        // Mock Media Session API
        setActionHandlerSpy = vi.fn();
        mockMediaSession = {
            setActionHandler: setActionHandlerSpy,
            metadata: null,
            playbackState: 'none',
        };

        // Add mediaSession to navigator mock
        Object.defineProperty(navigator, 'mediaSession', {
            value: mockMediaSession,
            writable: true,
            configurable: true,
        });

        // Mock ApplicationService with browser detection
        const mockAppService = {
            isBrowser: () => true,
            initialized: vi.fn().mockReturnValue(false),
        };

        await TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                MediaPlayerService,
                { provide: ApplicationService, useValue: mockAppService },
                { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => { }, removeItem: () => { } } },
                { provide: LayoutService, useValue: {} },
                { provide: UtilitiesService, useValue: {} },
                { provide: WakeLockService, useValue: {} },
                { provide: OfflineMusicService, useValue: {} },
                { provide: AccountStateService, useValue: { pubkey: () => null } },
                { provide: AccountLocalStateService, useValue: {} },
                { provide: DomSanitizer, useValue: {} },
                { provide: Router, useValue: {} },
            ],
        }).compileComponents();

        service = TestBed.inject(MediaPlayerService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    it('should allow previous on the first queued item and restart it', () => {
        const startSpy = vi.spyOn(service, 'start').mockResolvedValue(undefined);

        service.media.set([
            {
                artwork: 'https://example.com/cover-1.jpg',
                title: 'Track 1',
                artist: 'Artist',
                source: 'https://example.com/track-1.mp3',
                type: 'Music',
            },
            {
                artwork: 'https://example.com/cover-2.jpg',
                title: 'Track 2',
                artist: 'Artist',
                source: 'https://example.com/track-2.mp3',
                type: 'Music',
            },
        ]);
        service.index = 0;

        expect(service.canPrevious()).toBe(true);

        service.previous();

        expect(service.index).toBe(0);
        expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it('should wrap previous from the first queued item when repeat all is enabled', () => {
        const startSpy = vi.spyOn(service, 'start').mockResolvedValue(undefined);

        service.media.set([
            {
                artwork: 'https://example.com/cover-1.jpg',
                title: 'Track 1',
                artist: 'Artist',
                source: 'https://example.com/track-1.mp3',
                type: 'Music',
            },
            {
                artwork: 'https://example.com/cover-2.jpg',
                title: 'Track 2',
                artist: 'Artist',
                source: 'https://example.com/track-2.mp3',
                type: 'Music',
            },
        ]);
        service.index = 0;
        service.repeat.set('all');

        service.previous();

        expect(service.index).toBe(1);
        expect(startSpy).toHaveBeenCalledTimes(1);
    });

    it('should choose a random previous item when shuffle is enabled', () => {
        const startSpy = vi.spyOn(service, 'start').mockResolvedValue(undefined);
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9);

        service.media.set([
            {
                artwork: 'https://example.com/cover-1.jpg',
                title: 'Track 1',
                artist: 'Artist',
                source: 'https://example.com/track-1.mp3',
                type: 'Music',
            },
            {
                artwork: 'https://example.com/cover-2.jpg',
                title: 'Track 2',
                artist: 'Artist',
                source: 'https://example.com/track-2.mp3',
                type: 'Music',
            },
        ]);
        service.index = 0;
        service.shuffle.set(true);

        try {
            service.previous();

            expect(service.index).toBe(1);
            expect(startSpy).toHaveBeenCalledTimes(1);
        } finally {
            randomSpy.mockRestore();
        }
    });

    it('should NOT initialize media session handlers in constructor', () => {
        // Media session handlers should not be set during construction (bootstrap)
        expect(setActionHandlerSpy).not.toHaveBeenCalled();
    });

    it('should handle missing Media Session API gracefully', async () => {
        // Remove mediaSession from navigator
        Object.defineProperty(navigator, 'mediaSession', {
            value: undefined,
            writable: true,
            configurable: true,
        });

        // Recreate the service through TestBed with undefined mediaSession
        const testBed = TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                MediaPlayerService,
                { provide: ApplicationService, useValue: { isBrowser: () => true, initialized: () => false } },
                { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => { }, removeItem: () => { } } },
                { provide: LayoutService, useValue: {} },
                { provide: UtilitiesService, useValue: {} },
                { provide: WakeLockService, useValue: {} },
                { provide: OfflineMusicService, useValue: {} },
                { provide: AccountStateService, useValue: { pubkey: () => null } },
                { provide: AccountLocalStateService, useValue: {} },
                { provide: DomSanitizer, useValue: {} },
                { provide: Router, useValue: {} },
            ],
        });

        const newService = testBed.inject(MediaPlayerService);

        // Should not throw any errors during construction
        expect(newService).toBeTruthy();
    });

    it('should handle partial Media Session API support', async () => {
        // Simulate environment where navigator.mediaSession exists but is null/undefined
        Object.defineProperty(navigator, 'mediaSession', {
            value: null,
            writable: true,
            configurable: true,
        });

        // Recreate service through TestBed
        const testBed = TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                MediaPlayerService,
                { provide: ApplicationService, useValue: { isBrowser: () => true, initialized: () => false } },
                { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => { }, removeItem: () => { } } },
                { provide: LayoutService, useValue: {} },
                { provide: UtilitiesService, useValue: {} },
                { provide: WakeLockService, useValue: {} },
                { provide: OfflineMusicService, useValue: {} },
                { provide: AccountStateService, useValue: { pubkey: () => null } },
                { provide: AccountLocalStateService, useValue: {} },
                { provide: DomSanitizer, useValue: {} },
                { provide: Router, useValue: {} },
            ],
        });

        // Should not throw errors
        const newService = testBed.inject(MediaPlayerService);
        expect(newService).toBeTruthy();
    });

    it('should detect when Media Session API is supported', () => {
        // Access the private property using bracket notation
        const isSupported = (service as any).isMediaSessionSupported;
        expect(isSupported).toBe(true);
    });

    it('should detect when Media Session API is not supported', async () => {
        // Remove mediaSession
        Object.defineProperty(navigator, 'mediaSession', {
            value: undefined,
            writable: true,
            configurable: true,
        });

        // Recreate service through TestBed
        const testBed = TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                MediaPlayerService,
                { provide: ApplicationService, useValue: { isBrowser: () => true, initialized: () => false } },
                { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => { }, removeItem: () => { } } },
                { provide: LayoutService, useValue: {} },
                { provide: UtilitiesService, useValue: {} },
                { provide: WakeLockService, useValue: {} },
                { provide: OfflineMusicService, useValue: {} },
                { provide: AccountStateService, useValue: { pubkey: () => null } },
                { provide: AccountLocalStateService, useValue: {} },
                { provide: DomSanitizer, useValue: {} },
                { provide: Router, useValue: {} },
            ],
        });

        // Check support on a fresh instance
        const newService = testBed.inject(MediaPlayerService);
        const isSupported = (newService as any).isMediaSessionSupported;
        expect(isSupported).toBe(false);
    });

    it('should not set playbackState when Media Session API is unavailable', async () => {
        // Remove mediaSession
        Object.defineProperty(navigator, 'mediaSession', {
            value: undefined,
            writable: true,
            configurable: true,
        });

        // Recreate service through TestBed
        const testBed = TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                MediaPlayerService,
                { provide: ApplicationService, useValue: { isBrowser: () => true, initialized: () => false } },
                { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => { }, removeItem: () => { } } },
                { provide: LayoutService, useValue: {} },
                { provide: UtilitiesService, useValue: {} },
                { provide: WakeLockService, useValue: {} },
                { provide: OfflineMusicService, useValue: {} },
                { provide: AccountStateService, useValue: { pubkey: () => null } },
                { provide: AccountLocalStateService, useValue: {} },
                { provide: DomSanitizer, useValue: {} },
                { provide: Router, useValue: {} },
            ],
        });

        const newService = testBed.inject(MediaPlayerService);

        // Try to pause (which normally sets playbackState)
        // Should not throw error
        expect(() => newService.pause()).not.toThrow();
    });

    it('should handle errors when initializing media session handlers', async () => {
        // Mock setActionHandler to throw an error
        const errorMediaSession = {
            setActionHandler: vi.fn().mockImplementation(() => {
                throw new Error('Test error');
            }),
            metadata: null,
            playbackState: 'none',
        };

        Object.defineProperty(navigator, 'mediaSession', {
            value: errorMediaSession,
            writable: true,
            configurable: true,
        });

        // Recreate service through TestBed
        const testBed = TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                MediaPlayerService,
                { provide: ApplicationService, useValue: { isBrowser: () => true, initialized: () => false } },
                { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => { }, removeItem: () => { } } },
                { provide: LayoutService, useValue: {} },
                { provide: UtilitiesService, useValue: {} },
                { provide: WakeLockService, useValue: {} },
                { provide: OfflineMusicService, useValue: {} },
                { provide: AccountStateService, useValue: { pubkey: () => null } },
                { provide: AccountLocalStateService, useValue: {} },
                { provide: DomSanitizer, useValue: {} },
                { provide: Router, useValue: {} },
            ],
        });

        const newService = testBed.inject(MediaPlayerService);

        // Call the private initializeMediaSession method
        // Should catch the error and not crash
        expect(() => (newService as any).initializeMediaSession()).not.toThrow();
    });

    it('should auto-advance while backgrounded without waiting for async audio resolution', async () => {
        const originalHidden = document.hidden;
        const playSpy = vi.fn().mockResolvedValue(undefined);

        class MockAudio {
            src = '';
            crossOrigin: string | null = null;
            error = null;
            currentTime = 0;
            duration = 0;
            playbackRate = 1;
            volume = 1;
            muted = false;
            private listeners = new Map<string, Set<EventListener>>();

            addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
                const callback = typeof listener === 'function'
                    ? listener
                    : listener.handleEvent.bind(listener);
                const listeners = this.listeners.get(type) ?? new Set<EventListener>();
                listeners.add(callback);
                this.listeners.set(type, listeners);
            }

            removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
                const callback = typeof listener === 'function'
                    ? listener
                    : listener.handleEvent.bind(listener);
                this.listeners.get(type)?.delete(callback);
            }

            play(): Promise<void> {
                return playSpy();
            }

            pause(): void {}
            load(): void {}
        }

        const originalAudio = globalThis.Audio;
        const originalMediaMetadata = globalThis.MediaMetadata;
        vi.stubGlobal('Audio', MockAudio as unknown as typeof Audio);
        vi.stubGlobal('MediaMetadata', class {
            constructor(_init?: MediaMetadataInit) {}
        });

        const blockingPromise = new Promise<string>(() => {});
        const getCachedAudioUrl = vi.fn().mockReturnValue(blockingPromise);
        const showMediaPlayer = signal(false);
        const expandedMediaPlayer = signal(false);

        const testBed = TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                MediaPlayerService,
                { provide: ApplicationService, useValue: { isBrowser: () => true, initialized: () => false } },
                { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => { }, removeItem: () => { } } },
                { provide: LayoutService, useValue: { showMediaPlayer, expandedMediaPlayer } },
                { provide: UtilitiesService, useValue: { sanitizeUrlAndBypassFrame: (url: string) => url } },
                { provide: WakeLockService, useValue: {} },
                { provide: OfflineMusicService, useValue: { getCachedAudioUrl, getCachedImageUrl: vi.fn().mockImplementation(async (url: string) => url) } },
                { provide: AccountStateService, useValue: { pubkey: () => null } },
                { provide: AccountLocalStateService, useValue: {} },
                { provide: DomSanitizer, useValue: { bypassSecurityTrustResourceUrl: (url: string) => url } },
                { provide: Router, useValue: {} },
            ],
        });

        const backgroundService = testBed.inject(MediaPlayerService);
        const tracks: MediaItem[] = [
            {
                artwork: 'https://example.com/cover-1.jpg',
                title: 'Track 1',
                artist: 'Artist',
                source: 'https://example.com/track-1.mp3',
                type: 'Music',
            },
            {
                artwork: 'https://example.com/cover-2.jpg',
                title: 'Track 2',
                artist: 'Artist',
                source: 'https://example.com/track-2.mp3',
                type: 'Music',
            },
        ];

        backgroundService.media.set(tracks);
        backgroundService.index = 0;

        Object.defineProperty(document, 'hidden', {
            value: true,
            writable: true,
            configurable: true,
        });

        try {
            await backgroundService.start();

            expect(backgroundService.current()?.source).toBe(tracks[0].source);
            expect(playSpy).toHaveBeenCalledTimes(1);

            (backgroundService as any).handleMediaEnded();

            expect(backgroundService.index).toBe(1);
            expect(backgroundService.current()?.source).toBe(tracks[1].source);
            expect(backgroundService.audio?.src).toBe(tracks[1].source);
            expect(playSpy).toHaveBeenCalledTimes(2);
            expect(getCachedAudioUrl).not.toHaveBeenCalled();
        } finally {
            Object.defineProperty(document, 'hidden', {
                value: originalHidden,
                writable: true,
                configurable: true,
            });

            vi.stubGlobal('Audio', originalAudio);
            vi.stubGlobal('MediaMetadata', originalMediaMetadata);
        }
    });

    it('falls back to HTML audio when native Android audio rejects immediately', async () => {
        const originalAudio = globalThis.Audio;
        const originalUserAgent = navigator.userAgent;
        const playSpy = vi.fn().mockResolvedValue(undefined);
        const showMediaPlayer = signal(false);
        const expandedMediaPlayer = signal(false);
        const mockNativeMediaSession = {
            setActionHandler: vi.fn(),
            setPlaybackStateHandler: vi.fn(),
            isAndroidRuntime: vi.fn().mockReturnValue(true),
            playAudio: vi.fn().mockRejectedValue(new Error('native playback unavailable')),
            stopAudio: vi.fn().mockResolvedValue(undefined),
            pauseAudio: vi.fn().mockResolvedValue(undefined),
            resumeAudio: vi.fn().mockResolvedValue(undefined),
            seekAudio: vi.fn().mockResolvedValue(undefined),
            setAudioRate: vi.fn().mockResolvedValue(undefined),
            updateState: vi.fn().mockResolvedValue(undefined),
            updateTimeline: vi.fn().mockResolvedValue(undefined),
            clear: vi.fn().mockResolvedValue(undefined),
        };

        class MockAudio {
            src = '';
            crossOrigin: string | null = null;
            error = null;
            currentTime = 0;
            duration = 0;
            playbackRate = 1;
            volume = 1;
            muted = false;

            addEventListener = vi.fn();
            removeEventListener = vi.fn();
            play = playSpy;
            pause = vi.fn();
            load = vi.fn();
        }

        vi.stubGlobal('Audio', MockAudio as unknown as typeof Audio);

        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Linux; Android 14; sdk_gphone64_x86_64) AppleWebKit/537.36 Chrome/123.0.0.0 Mobile Safari/537.36',
            writable: true,
            configurable: true,
        });

        const testBed = TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                MediaPlayerService,
                { provide: ApplicationService, useValue: { isBrowser: () => true, initialized: () => false } },
                { provide: NativeMediaSessionService, useValue: mockNativeMediaSession },
                { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => { }, removeItem: () => { } } },
                { provide: LayoutService, useValue: { showMediaPlayer, expandedMediaPlayer } },
                { provide: UtilitiesService, useValue: { sanitizeUrlAndBypassFrame: (url: string) => url } },
                { provide: WakeLockService, useValue: {} },
                { provide: OfflineMusicService, useValue: { getCachedAudioUrl: vi.fn().mockImplementation(async (url: string) => url), getCachedImageUrl: vi.fn().mockImplementation(async (url: string) => url) } },
                { provide: AccountStateService, useValue: { pubkey: () => null } },
                { provide: AccountLocalStateService, useValue: {} },
                { provide: DomSanitizer, useValue: { bypassSecurityTrustResourceUrl: (url: string) => url } },
                { provide: Router, useValue: {} },
            ],
        });

        const androidService = testBed.inject(MediaPlayerService);
        androidService.media.set([
            {
                artwork: 'https://example.com/cover.jpg',
                title: 'Track 1',
                artist: 'Artist',
                source: 'https://example.com/track.mp3',
                type: 'Music',
            },
        ]);
        androidService.index = 0;

        try {
            await androidService.start();

            expect(mockNativeMediaSession.playAudio).toHaveBeenCalledTimes(1);
            expect(playSpy).toHaveBeenCalledTimes(1);
            expect(androidService.audio?.src).toBe('https://example.com/track.mp3');
            expect((androidService as any).nativeAndroidAudioActive).toBe(false);
        } finally {
            vi.stubGlobal('Audio', originalAudio);
            Object.defineProperty(navigator, 'userAgent', {
                value: originalUserAgent,
                writable: true,
                configurable: true,
            });
        }
    });
});
