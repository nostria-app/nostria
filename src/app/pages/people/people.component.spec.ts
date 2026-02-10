import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { PeopleComponent } from './people.component';
import { FollowingService } from '../../services/following.service';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { FavoritesService } from '../../services/favorites.service';
import { Followset } from '../../services/followset';
import { NotificationService } from '../../services/notification.service';
import { FeedsCollectionService } from '../../services/feeds-collection.service';
import { FollowSetsService } from '../../services/follow-sets.service';
import { ProfileHoverCardService } from '../../services/profile-hover-card.service';
import { UtilitiesService } from '../../services/utilities.service';
import { TwoColumnLayoutService } from '../../services/two-column-layout.service';
import { TrustService } from '../../services/trust.service';
import { LoggerService } from '../../services/logger.service';
import { MatDialog } from '@angular/material/dialog';

describe('PeopleComponent', () => {
  let component: PeopleComponent;
  let fixture: ComponentFixture<PeopleComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PeopleComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(new Map()),
          },
        },
        {
          provide: FollowingService,
          useValue: {
            isLoading: signal(false),
            profiles: signal([]),
            searchProfiles: jasmine.createSpy('searchProfiles').and.returnValue([]),
            getSortedProfiles: jasmine.createSpy('getSortedProfiles').and.callFake((p: unknown[]) => p),
            getFilteredProfiles: jasmine.createSpy('getFilteredProfiles').and.callFake((_f: unknown, p: unknown[]) => p),
            loadProfilesForPubkeys: jasmine.createSpy('loadProfilesForPubkeys').and.resolveTo([]),
            getProfile: jasmine.createSpy('getProfile').and.returnValue(undefined),
          },
        },
        {
          provide: AccountStateService,
          useValue: {
            pubkey: signal(''),
            followingList: signal<string[]>(['pubkey1']),
            follow: jasmine.createSpy('follow').and.resolveTo(),
          },
        },
        {
          provide: ApplicationService,
          useValue: {
            initialized: signal(false),
          },
        },
        {
          provide: LocalStorageService,
          useValue: {},
        },
        {
          provide: AccountLocalStateService,
          useValue: {
            getPeopleViewMode: jasmine.createSpy('getPeopleViewMode').and.returnValue(undefined),
            setPeopleViewMode: jasmine.createSpy('setPeopleViewMode'),
            getPeopleFilters: jasmine.createSpy('getPeopleFilters').and.returnValue(undefined),
            setPeopleFilters: jasmine.createSpy('setPeopleFilters'),
            getPeopleSortOption: jasmine.createSpy('getPeopleSortOption').and.returnValue(undefined),
            setPeopleSortOption: jasmine.createSpy('setPeopleSortOption'),
          },
        },
        {
          provide: FavoritesService,
          useValue: {},
        },
        {
          provide: MatDialog,
          useValue: {
            open: jasmine.createSpy('open'),
          },
        },
        {
          provide: Followset,
          useValue: {
            fetchStarterPacks: jasmine.createSpy('fetchStarterPacks').and.resolveTo([]),
            convertStarterPacksToInterests: jasmine.createSpy('convertStarterPacksToInterests').and.returnValue([]),
            starterPacks: signal([]),
            convertStarterPacksToProfiles: jasmine.createSpy('convertStarterPacksToProfiles').and.resolveTo([]),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            notify: jasmine.createSpy('notify'),
          },
        },
        {
          provide: FeedsCollectionService,
          useValue: {
            refreshFollowingFeeds: jasmine.createSpy('refreshFollowingFeeds').and.resolveTo(),
          },
        },
        {
          provide: FollowSetsService,
          useValue: {
            followSets: signal([]),
            hasInitiallyLoaded: signal(false),
            getFollowSetByDTag: jasmine.createSpy('getFollowSetByDTag').and.returnValue(undefined),
            createFollowSet: jasmine.createSpy('createFollowSet').and.resolveTo(null),
          },
        },
        {
          provide: ProfileHoverCardService,
          useValue: {
            closeHoverCard: jasmine.createSpy('closeHoverCard'),
          },
        },
        {
          provide: UtilitiesService,
          useValue: {},
        },
        {
          provide: TwoColumnLayoutService,
          useValue: {
            setWideLeft: jasmine.createSpy('setWideLeft'),
            openProfile: jasmine.createSpy('openProfile'),
          },
        },
        {
          provide: TrustService,
          useValue: {
            fetchMetricsBatch: jasmine.createSpy('fetchMetricsBatch').and.resolveTo(),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            info: jasmine.createSpy('info'),
            warn: jasmine.createSpy('warn'),
            error: jasmine.createSpy('error'),
            debug: jasmine.createSpy('debug'),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PeopleComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('people-container view mode classes', () => {
    function getPeopleContainer(): HTMLElement | null {
      return fixture.nativeElement.querySelector('.people-container');
    }

    it('should apply medium-grid class by default', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      const container = getPeopleContainer();
      expect(container).toBeTruthy();
      expect(container!.classList.contains('medium-grid')).toBeTrue();
      expect(container!.classList.contains('comfortable-list')).toBeFalse();
      expect(container!.classList.contains('small-grid')).toBeFalse();
      expect(container!.classList.contains('details-list')).toBeFalse();
    });

    it('should apply comfortable-list class when viewMode is comfortable', async () => {
      component.changeViewMode('comfortable');
      fixture.detectChanges();
      await fixture.whenStable();
      const container = getPeopleContainer();
      expect(container).toBeTruthy();
      expect(container!.classList.contains('comfortable-list')).toBeTrue();
      expect(container!.classList.contains('medium-grid')).toBeFalse();
    });

    it('should apply small-grid class when viewMode is small', async () => {
      component.changeViewMode('small');
      fixture.detectChanges();
      await fixture.whenStable();
      const container = getPeopleContainer();
      expect(container).toBeTruthy();
      expect(container!.classList.contains('small-grid')).toBeTrue();
      expect(container!.classList.contains('medium-grid')).toBeFalse();
    });

    it('should apply details-list class when viewMode is details', async () => {
      component.changeViewMode('details');
      fixture.detectChanges();
      await fixture.whenStable();
      const container = getPeopleContainer();
      expect(container).toBeTruthy();
      expect(container!.classList.contains('details-list')).toBeTrue();
      expect(container!.classList.contains('medium-grid')).toBeFalse();
    });

    it('should switch classes when viewMode changes', async () => {
      component.changeViewMode('comfortable');
      fixture.detectChanges();
      await fixture.whenStable();
      let container = getPeopleContainer();
      expect(container!.classList.contains('comfortable-list')).toBeTrue();

      component.changeViewMode('details');
      fixture.detectChanges();
      await fixture.whenStable();
      container = getPeopleContainer();
      expect(container!.classList.contains('details-list')).toBeTrue();
      expect(container!.classList.contains('comfortable-list')).toBeFalse();
    });
  });
});
