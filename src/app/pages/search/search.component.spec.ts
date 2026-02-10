import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { SearchComponent } from './search.component';
import { DatabaseService } from '../../services/database.service';
import { SearchRelayService } from '../../services/relays/search-relay';
import { FollowingService } from '../../services/following.service';
import { LayoutService } from '../../services/layout.service';
import { LoggerService } from '../../services/logger.service';
import { UtilitiesService } from '../../services/utilities.service';
import { AccountStateService } from '../../services/account-state.service';

describe('SearchComponent', () => {
  let component: SearchComponent;
  let fixture: ComponentFixture<SearchComponent>;
  let mockSearchRelay: jasmine.SpyObj<SearchRelayService>;

  beforeEach(async () => {
    mockSearchRelay = jasmine.createSpyObj('SearchRelayService', [
      'search',
      'searchProfiles',
    ]);
    mockSearchRelay.search.and.resolveTo([]);
    mockSearchRelay.searchProfiles.and.resolveTo([]);

    await TestBed.configureTestingModule({
      imports: [SearchComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: DatabaseService,
          useValue: {
            getEventsByKind: jasmine.createSpy('getEventsByKind').and.resolveTo([]),
          },
        },
        { provide: SearchRelayService, useValue: mockSearchRelay },
        {
          provide: FollowingService,
          useValue: {
            searchProfiles: jasmine.createSpy('searchProfiles').and.returnValue([]),
            toNostrRecords: jasmine.createSpy('toNostrRecords').and.returnValue([]),
          },
        },
        {
          provide: LayoutService,
          useValue: {
            openProfile: jasmine.createSpy('openProfile'),
            openGenericEvent: jasmine.createSpy('openGenericEvent'),
            toast: jasmine.createSpy('toast'),
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
        {
          provide: UtilitiesService,
          useValue: {
            isEventExpired: jasmine.createSpy('isEventExpired').and.returnValue(false),
          },
        },
        {
          provide: AccountStateService,
          useValue: {
            isFollowing: signal(() => false),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SearchComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('searchProgress', () => {
    it('should be null initially', () => {
      expect(component.searchProgress()).toBeNull();
    });

    it('should be null after clearing search', () => {
      component.searchProgress.set({ currentStep: 1, totalSteps: 4, message: 'test' });
      component.clearSearch();
      expect(component.searchProgress()).toBeNull();
    });

    it('should be null after search completes', async () => {
      component.searchQuery.set('test');
      await component.performSearch();
      expect(component.searchProgress()).toBeNull();
    });

    it('should be null after search fails', async () => {
      mockSearchRelay.searchProfiles.and.rejectWith(new Error('fail'));
      component.searchQuery.set('test');
      await component.performSearch();
      expect(component.searchProgress()).toBeNull();
    });
  });

  describe('calculateTotalSteps', () => {
    it('should return 4 for source=all, type=all (1 local + 3 relay)', () => {
      expect(component.calculateTotalSteps('all', 'all')).toBe(4);
    });

    it('should return 1 for source=local only', () => {
      expect(component.calculateTotalSteps('local', 'all')).toBe(1);
    });

    it('should return 3 for source=relays, type=all', () => {
      expect(component.calculateTotalSteps('relays', 'all')).toBe(3);
    });

    it('should return 2 for source=all, type=profiles (1 local + 1 relay)', () => {
      expect(component.calculateTotalSteps('all', 'profiles')).toBe(2);
    });

    it('should return 2 for source=all, type=notes (1 local + 1 relay)', () => {
      expect(component.calculateTotalSteps('all', 'notes')).toBe(2);
    });

    it('should return 1 for source=relays, type=profiles', () => {
      expect(component.calculateTotalSteps('relays', 'profiles')).toBe(1);
    });

    it('should return 2 for source=all with kindFilter (1 local + 1 relay)', () => {
      expect(component.calculateTotalSteps('all', 'all', [30030])).toBe(2);
    });

    it('should return 1 for source=relays with kindFilter', () => {
      expect(component.calculateTotalSteps('relays', 'all', [30030])).toBe(1);
    });
  });

  describe('progress bar rendering', () => {
    it('should show progress bar when searching with multiple steps', async () => {
      // Use a delayed promise so we can inspect intermediate state
      let resolveSearch: () => void;
      const searchPromise = new Promise<void>(resolve => resolveSearch = resolve);

      mockSearchRelay.searchProfiles.and.callFake(() => searchPromise.then(() => []));

      component.searchQuery.set('test');
      const performPromise = component.performSearch();

      // Wait for microtasks so local search completes
      await new Promise(resolve => setTimeout(resolve, 0));
      fixture.detectChanges();

      // Progress should be set during search
      const progress = component.searchProgress();
      expect(progress).not.toBeNull();
      expect(progress!.totalSteps).toBeGreaterThan(0);
      expect(progress!.message).toBeTruthy();

      // Check DOM for progress bar
      const progressBar = fixture.nativeElement.querySelector('.search-progress-bar');
      expect(progressBar).toBeTruthy();

      // Complete the search
      resolveSearch!();
      await performPromise;
    });

    it('should not show progress bar when not searching', () => {
      fixture.detectChanges();
      const progressBar = fixture.nativeElement.querySelector('.search-progress-bar');
      expect(progressBar).toBeNull();
    });

    it('should display step message during search', async () => {
      let resolveSearch: () => void;
      const searchPromise = new Promise<void>(resolve => resolveSearch = resolve);

      mockSearchRelay.searchProfiles.and.callFake(() => searchPromise.then(() => []));

      component.searchQuery.set('test');
      const performPromise = component.performSearch();

      await new Promise(resolve => setTimeout(resolve, 0));
      fixture.detectChanges();

      const loadingState = fixture.nativeElement.querySelector('.loading-state');
      expect(loadingState).toBeTruthy();
      const messageEl = loadingState.querySelector('p');
      expect(messageEl).toBeTruthy();
      expect(messageEl.textContent.trim().length).toBeGreaterThan(0);

      resolveSearch!();
      await performPromise;
    });
  });
});
