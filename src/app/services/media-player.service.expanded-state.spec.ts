import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MediaItem } from '../interfaces';
import { AccountLocalStateService } from './account-local-state.service';
import { AccountStateService } from './account-state.service';
import { ApplicationService } from './application.service';
import { LayoutService } from './layout.service';
import { LocalStorageService } from './local-storage.service';
import { MediaPlayerService } from './media-player.service';
import { OfflineMusicService } from './offline-music.service';
import { UtilitiesService } from './utilities.service';
import { WakeLockService } from './wake-lock.service';

describe('MediaPlayerService expanded state switching', () => {
    let service: MediaPlayerService;
    const layoutMock = {
        showMediaPlayer: signal(false),
        fullscreenMediaPlayer: signal(false),
        expandedMediaPlayer: signal(false),
    };

    const baseItem: Omit<MediaItem, 'type' | 'source'> = {
        artwork: '',
        title: 'Test',
        artist: 'Artist',
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            providers: [
                provideZonelessChangeDetection(),
                MediaPlayerService,
                { provide: ApplicationService, useValue: { isBrowser: () => true, initialized: () => false } },
                {
                    provide: LocalStorageService,
                    useValue: {
                        getItem: () => null,
                        setItem: vi.fn(),
                        removeItem: vi.fn(),
                    },
                },
                { provide: LayoutService, useValue: layoutMock },
                { provide: UtilitiesService, useValue: {} },
                { provide: WakeLockService, useValue: {} },
                { provide: OfflineMusicService, useValue: { getCachedAudioUrl: async (url: string) => url } },
                { provide: AccountStateService, useValue: { pubkey: () => null } },
                { provide: AccountLocalStateService, useValue: {} },
                { provide: DomSanitizer, useValue: { bypassSecurityTrustResourceUrl: (url: string) => url } },
                { provide: Router, useValue: {} },
            ],
        }).compileComponents();

        service = TestBed.inject(MediaPlayerService);
        layoutMock.showMediaPlayer.set(false);
        layoutMock.fullscreenMediaPlayer.set(false);
        layoutMock.expandedMediaPlayer.set(false);
        vi.spyOn(service, 'start').mockReturnValue(Promise.resolve());
    });

    it('collapses to mini when playing music after expanded video', () => {
        layoutMock.expandedMediaPlayer.set(true);
        service.current.set({
            ...baseItem,
            type: 'Video',
            source: 'https://example.com/previous-video.mp4',
        });

        service.play({
            ...baseItem,
            type: 'Music',
            source: 'https://example.com/track.mp3',
        });

        expect(layoutMock.expandedMediaPlayer()).toBe(false);
    });

    it('keeps expanded mode for video content', () => {
        layoutMock.expandedMediaPlayer.set(false);

        service.play({
            ...baseItem,
            type: 'Video',
            source: 'https://example.com/video.mp4',
        });

        expect(layoutMock.expandedMediaPlayer()).toBe(true);
    });

    it('keeps expanded mode when moving between music tracks in expanded playlist', () => {
        layoutMock.expandedMediaPlayer.set(true);
        service.current.set({
            ...baseItem,
            type: 'Music',
            source: 'https://example.com/track-1.mp3',
        });

        service.play({
            ...baseItem,
            type: 'Music',
            source: 'https://example.com/track-2.mp3',
        });

        expect(layoutMock.expandedMediaPlayer()).toBe(true);
    });

    it('uses anonymous CORS for same-origin audio sources', () => {
        const shouldUseCors = (service as any).shouldUseAnonymousCorsForAudio('/assets/track.mp3');
        expect(shouldUseCors).toBe(true);
    });

    it('does not use anonymous CORS for external-origin audio sources', () => {
        const shouldUseCors = (service as any).shouldUseAnonymousCorsForAudio('https://example.com/track.mp3');
        expect(shouldUseCors).toBe(false);
    });

    it('does not use anonymous CORS for blob audio sources', () => {
        const shouldUseCors = (service as any).shouldUseAnonymousCorsForAudio('blob:https://nostria.app/1234');
        expect(shouldUseCors).toBe(false);
    });
});
