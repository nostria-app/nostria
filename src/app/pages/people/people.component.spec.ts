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
            searchProfiles: vi.fn().mockReturnValue([]),
            getSortedProfiles: vi.fn().mockImplementation((p: unknown[]) => p),
            getFilteredProfiles: vi.fn().mockImplementation((_f: unknown, p: unknown[]) => p),
            loadProfilesForPubkeys: vi.fn().mockResolvedValue([]),
            getProfile: vi.fn().mockReturnValue(undefined),
          },
        },
        {
          provide: AccountStateService,
          useValue: {
            pubkey: signal(''),
            followingList: signal<string[]>(['pubkey1']),
            follow: vi.fn().mockResolvedValue(undefined),
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
            getPeopleViewMode: vi.fn().mockReturnValue(undefined),
            setPeopleViewMode: vi.fn(),
            getPeopleFilters: vi.fn().mockReturnValue(undefined),
            setPeopleFilters: vi.fn(),
            getPeopleSortOption: vi.fn().mockReturnValue(undefined),
            setPeopleSortOption: vi.fn(),
          },
        },
        {
          provide: FavoritesService,
          useValue: {},
        },
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn(),
          },
        },
        {
          provide: Followset,
          useValue: {
            fetchStarterPacks: vi.fn().mockResolvedValue([]),
            convertStarterPacksToInterests: vi.fn().mockReturnValue([]),
            starterPacks: signal([]),
            convertStarterPacksToProfiles: vi.fn().mockResolvedValue([]),
          },
        },
        {
          provide: NotificationService,
          useValue: {
            notify: vi.fn(),
          },
        },
        {
          provide: FeedsCollectionService,
          useValue: {
            refreshFollowingFeeds: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: FollowSetsService,
          useValue: {
            followSets: signal([]),
            hasInitiallyLoaded: signal(false),
            getFollowSetByDTag: vi.fn().mockReturnValue(undefined),
            createFollowSet: vi.fn().mockResolvedValue(null),
          },
        },
        {
          provide: ProfileHoverCardService,
          useValue: {
            closeHoverCard: vi.fn(),
          },
        },
        {
          provide: UtilitiesService,
          useValue: {},
        },
        {
          provide: TwoColumnLayoutService,
          useValue: {
            setWideLeft: vi.fn(),
            openProfile: vi.fn(),
          },
        },
        {
          provide: TrustService,
          useValue: {
            fetchMetricsBatch: vi.fn().mockResolvedValue(undefined),
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
      expect(container!.classList.contains('medium-grid')).toBe(true);
      expect(container!.classList.contains('comfortable-list')).toBe(false);
      expect(container!.classList.contains('small-grid')).toBe(false);
      expect(container!.classList.contains('details-list')).toBe(false);
    });

    it('should apply comfortable-list class when viewMode is comfortable', async () => {
      component.changeViewMode('comfortable');
      fixture.detectChanges();
      await fixture.whenStable();
      const container = getPeopleContainer();
      expect(container).toBeTruthy();
      expect(container!.classList.contains('comfortable-list')).toBe(true);
      expect(container!.classList.contains('medium-grid')).toBe(false);
    });

    it('should apply small-grid class when viewMode is small', async () => {
      component.changeViewMode('small');
      fixture.detectChanges();
      await fixture.whenStable();
      const container = getPeopleContainer();
      expect(container).toBeTruthy();
      expect(container!.classList.contains('small-grid')).toBe(true);
      expect(container!.classList.contains('medium-grid')).toBe(false);
    });

    it('should apply details-list class when viewMode is details', async () => {
      component.changeViewMode('details');
      fixture.detectChanges();
      await fixture.whenStable();
      const container = getPeopleContainer();
      expect(container).toBeTruthy();
      expect(container!.classList.contains('details-list')).toBe(true);
      expect(container!.classList.contains('medium-grid')).toBe(false);
    });

    it('should switch classes when viewMode changes', async () => {
      component.changeViewMode('comfortable');
      fixture.detectChanges();
      await fixture.whenStable();
      let container = getPeopleContainer();
      expect(container!.classList.contains('comfortable-list')).toBe(true);

      component.changeViewMode('details');
      fixture.detectChanges();
      await fixture.whenStable();
      container = getPeopleContainer();
      expect(container!.classList.contains('details-list')).toBe(true);
      expect(container!.classList.contains('comfortable-list')).toBe(false);
    });
  });
});
