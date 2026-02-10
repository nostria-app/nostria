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
            subscribe: jasmine.createSpy('subscribe').and.returnValue({ close: jasmine.createSpy('close') }),
          },
        },
        {
          provide: RelaysService,
          useValue: { getOptimalRelays: jasmine.createSpy('getOptimalRelays').and.returnValue([]) },
        },
        {
          provide: AccountRelayService,
          useValue: { getRelayUrls: jasmine.createSpy('getRelayUrls').and.returnValue([]) },
        },
        {
          provide: UtilitiesService,
          useValue: { anonymousRelays: [], extractLyricsFromEvent: jasmine.createSpy('extractLyricsFromEvent') },
        },
        {
          provide: ReportingService,
          useValue: {
            isUserBlocked: jasmine.createSpy('isUserBlocked').and.returnValue(false),
            isContentBlocked: jasmine.createSpy('isContentBlocked').and.returnValue(false),
          },
        },
        {
          provide: AccountStateService,
          useValue: {
            followingList: jasmine.createSpy('followingList').and.returnValue([]),
            pubkey: jasmine.createSpy('pubkey').and.returnValue(null),
          },
        },
        {
          provide: ApplicationService,
          useValue: { authenticated: jasmine.createSpy('authenticated').and.returnValue(false) },
        },
        { provide: MediaPlayerService, useValue: {} },
        { provide: DataService, useValue: { getCachedProfile: jasmine.createSpy('getCachedProfile') } },
        {
          provide: DatabaseService,
          useValue: {
            getEventsByKind: jasmine.createSpy('getEventsByKind').and.returnValue(Promise.resolve([])),
            getParameterizedReplaceableEvent: jasmine.createSpy('getParameterizedReplaceableEvent').and.returnValue(Promise.resolve(null)),
            saveEvent: jasmine.createSpy('saveEvent').and.returnValue(Promise.resolve()),
          },
        },
        {
          provide: OfflineMusicService,
          useValue: { offlineTracks: jasmine.createSpy('offlineTracks').and.returnValue([]) },
        },
        {
          provide: AccountLocalStateService,
          useValue: {
            getMusicYoursSectionCollapsed: jasmine.createSpy('getMusicYoursSectionCollapsed').and.returnValue(false),
            setMusicYoursSectionCollapsed: jasmine.createSpy('setMusicYoursSectionCollapsed'),
          },
        },
        { provide: LayoutService, useValue: {} },
        {
          provide: TwoColumnLayoutService,
          useValue: { setWideLeft: jasmine.createSpy('setWideLeft') },
        },
        { provide: MusicDataService, useValue: {} },
        {
          provide: FollowSetsService,
          useValue: { followSets: jasmine.createSpy('followSets').and.returnValue([]) },
        },
        {
          provide: LoggerService,
          useValue: {
            debug: jasmine.createSpy('debug'),
            warn: jasmine.createSpy('warn'),
            error: jasmine.createSpy('error'),
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
    expect(hostEl.classList.contains('panel-with-sticky-header')).toBeTrue();
  });

  it('should call updateContainerWidth on window resize', () => {
    spyOn(component, 'updateContainerWidth');
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
