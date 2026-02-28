import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, ElementRef } from '@angular/core';
import { provideRouter } from '@angular/router';
import { MusicComponent } from './music.component';
import { RelayPoolService } from '../../services/relays/relay-pool';
import { RelaysService } from '../../services/relays/relays';
import { AccountRelayService } from '../../services/relays/account-relay';
import { UtilitiesService } from '../../services/utilities.service';
import { ReportingService } from '../../services/reporting.service';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { MediaPlayerService } from '../../services/media-player.service';
import { DataService } from '../../services/data.service';
import { DatabaseService } from '../../services/database.service';
import { OfflineMusicService } from '../../services/offline-music.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { LayoutService } from '../../services/layout.service';
import { TwoColumnLayoutService } from '../../services/two-column-layout.service';
import { FollowSetsService } from '../../services/follow-sets.service';
import { MusicDataService } from '../../services/music-data.service';
import { LoggerService } from '../../services/logger.service';

describe('MusicComponent', () => {
    let component: MusicComponent;
    let fixture: ComponentFixture<MusicComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [MusicComponent],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                {
                    provide: RelayPoolService,
                    useValue: {
                        subscribe: vi.fn().mockReturnValue({ close: vi.fn() }),
                    },
                },
                {
                    provide: RelaysService,
                    useValue: { getOptimalRelays: vi.fn().mockReturnValue([]) },
                },
                {
                    provide: AccountRelayService,
                    useValue: { getRelayUrls: vi.fn().mockReturnValue([]) },
                },
                {
                    provide: UtilitiesService,
                    useValue: { anonymousRelays: [], extractLyricsFromEvent: vi.fn() },
                },
                {
                    provide: ReportingService,
                    useValue: {
                        isUserBlocked: vi.fn().mockReturnValue(false),
                        isContentBlocked: vi.fn().mockReturnValue(false),
                    },
                },
                {
                    provide: AccountStateService,
                    useValue: {
                        followingList: vi.fn().mockReturnValue([]),
                        pubkey: vi.fn().mockReturnValue(null),
                    },
                },
                {
                    provide: ApplicationService,
                    useValue: { authenticated: vi.fn().mockReturnValue(false) },
                },
                { provide: MediaPlayerService, useValue: {} },
                { provide: DataService, useValue: { getCachedProfile: vi.fn() } },
                {
                    provide: DatabaseService,
                    useValue: {
                        getEventsByKind: vi.fn().mockReturnValue(Promise.resolve([])),
                        getParameterizedReplaceableEvent: vi.fn().mockReturnValue(Promise.resolve(null)),
                        saveEvent: vi.fn().mockReturnValue(Promise.resolve()),
                    },
                },
                {
                    provide: OfflineMusicService,
                    useValue: { offlineTracks: vi.fn().mockReturnValue([]) },
                },
                {
                    provide: AccountLocalStateService,
                    useValue: {
                        getMusicYoursSectionCollapsed: vi.fn().mockReturnValue(false),
                        setMusicYoursSectionCollapsed: vi.fn(),
                    },
                },
                { provide: LayoutService, useValue: {} },
                {
                    provide: TwoColumnLayoutService,
                    useValue: { setWideLeft: vi.fn() },
                },
                { provide: MusicDataService, useValue: {} },
                {
                    provide: FollowSetsService,
                    useValue: { followSets: vi.fn().mockReturnValue([]) },
                },
                {
                    provide: LoggerService,
                    useValue: {
                        debug: vi.fn(),
                        warn: vi.fn(),
                        error: vi.fn(),
                    },
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(MusicComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should have panel-with-sticky-header class on host', () => {
        const hostEl = fixture.nativeElement as HTMLElement;
        expect(hostEl.classList.contains('panel-with-sticky-header')).toBe(true);
    });

    it('should call updateContainerWidth on window resize', () => {
        vi.spyOn(component, 'updateContainerWidth');
        window.dispatchEvent(new Event('resize'));
        expect(component.updateContainerWidth).toHaveBeenCalled();
    });

    it('should update containerWidth when musicContent element exists', () => {
        // Simulate having a musicContent element with a width
        const mockElement = document.createElement('div');
        Object.defineProperty(mockElement, 'offsetWidth', { value: 800 });
        component.musicContent = { nativeElement: mockElement } as ElementRef<HTMLDivElement>;

        component.updateContainerWidth();
        expect(component.containerWidth()).toBe(800);
    });

    it('should not throw when musicContent is undefined', () => {
        component.musicContent = undefined;
        expect(() => component.updateContainerWidth()).not.toThrow();
    });
});
