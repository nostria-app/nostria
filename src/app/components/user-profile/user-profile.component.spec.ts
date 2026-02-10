import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { UserProfileComponent } from './user-profile.component';
import { NostrService } from '../../services/nostr.service';
import { DataService } from '../../services/data.service';
import { LoggerService } from '../../services/logger.service';
import { LayoutService } from '../../services/layout.service';
import { UtilitiesService } from '../../services/utilities.service';
import { SettingsService } from '../../services/settings.service';
import { SharedRelayService } from '../../services/relays/shared-relay';
import { ImageCacheService } from '../../services/image-cache.service';
import { ProfileHoverCardService } from '../../services/profile-hover-card.service';
import { TrustService } from '../../services/trust.service';
import { IntersectionObserverService } from '../../services/intersection-observer.service';
import { ViewMode } from '../../interfaces';

describe('UserProfileComponent', () => {
  let component: UserProfileComponent;
  let fixture: ComponentFixture<UserProfileComponent>;

  beforeEach(async () => {
    const mockNostrService = {};

    const mockDataService = {
      getProfile: jasmine.createSpy('getProfile').and.resolveTo(null),
      getCachedProfile: jasmine.createSpy('getCachedProfile').and.returnValue(null),
    };

    const mockLoggerService = {
      debug: jasmine.createSpy('debug'),
      error: jasmine.createSpy('error'),
      time: jasmine.createSpy('time'),
      timeEnd: jasmine.createSpy('timeEnd'),
    };

    const mockLayoutService = {
      openProfile: jasmine.createSpy('openProfile'),
      isScrolling: signal(false),
    };

    const mockUtilitiesService = {
      isValidHexPubkey: jasmine.createSpy('isValidHexPubkey').and.returnValue(false),
      getPubkeyFromNpub: jasmine.createSpy('getPubkeyFromNpub').and.returnValue(''),
      getNpubFromPubkey: jasmine.createSpy('getNpubFromPubkey').and.returnValue(''),
      parseNip05: jasmine.createSpy('parseNip05').and.returnValue(null),
    };

    const mockSettingsService = {
      settings: signal({ imageCacheEnabled: false }),
    };

    const mockSharedRelayService = {};

    const mockImageCacheService = {
      getOptimizedImageUrl: jasmine.createSpy('getOptimizedImageUrl').and.callFake((url: string) => url),
    };

    const mockHoverCardService = {
      showHoverCard: jasmine.createSpy('showHoverCard'),
      hideHoverCard: jasmine.createSpy('hideHoverCard'),
      onTouchStart: jasmine.createSpy('onTouchStart'),
      onTouchMove: jasmine.createSpy('onTouchMove'),
      onTouchEnd: jasmine.createSpy('onTouchEnd'),
    };

    const mockTrustService = {
      isEnabled: signal(false),
    };

    const mockIntersectionObserverService = {
      observe: jasmine.createSpy('observe'),
      unobserve: jasmine.createSpy('unobserve'),
    };

    await TestBed.configureTestingModule({
      imports: [UserProfileComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: NostrService, useValue: mockNostrService },
        { provide: DataService, useValue: mockDataService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: LayoutService, useValue: mockLayoutService },
        { provide: UtilitiesService, useValue: mockUtilitiesService },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: SharedRelayService, useValue: mockSharedRelayService },
        { provide: ImageCacheService, useValue: mockImageCacheService },
        { provide: ProfileHoverCardService, useValue: mockHoverCardService },
        { provide: TrustService, useValue: mockTrustService },
        { provide: IntersectionObserverService, useValue: mockIntersectionObserverService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserProfileComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('root div class bindings', () => {
    it('should have user-profile class and default view class on root div', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      const rootDiv = (fixture.nativeElement as HTMLElement).querySelector('.user-profile');
      expect(rootDiv).toBeTruthy();
    });

    it('should apply list view class by default', async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      const rootDiv = (fixture.nativeElement as HTMLElement).querySelector('.user-profile');
      expect(rootDiv!.classList.contains('list')).toBeTrue();
    });

    it('should apply grid view class when view is grid', async () => {
      fixture.componentRef.setInput('view', 'grid' as ViewMode);
      fixture.detectChanges();
      await fixture.whenStable();
      const rootDiv = (fixture.nativeElement as HTMLElement).querySelector('.user-profile');
      expect(rootDiv!.classList.contains('grid')).toBeTrue();
      expect(rootDiv!.classList.contains('list')).toBeFalse();
    });

    it('should apply large view class when view is large', async () => {
      fixture.componentRef.setInput('view', 'large' as ViewMode);
      fixture.detectChanges();
      await fixture.whenStable();
      const rootDiv = (fixture.nativeElement as HTMLElement).querySelector('.user-profile');
      expect(rootDiv!.classList.contains('large')).toBeTrue();
    });

    it('should apply chip view class when view is chip', async () => {
      fixture.componentRef.setInput('view', 'chip' as ViewMode);
      fixture.detectChanges();
      await fixture.whenStable();
      const rootDiv = (fixture.nativeElement as HTMLElement).querySelector('.user-profile');
      expect(rootDiv!.classList.contains('chip')).toBeTrue();
    });
  });

  describe('mat-icon class bindings for default avatar', () => {
    it('should have default-user-avatar class on fallback icon', async () => {
      // Set profile to empty (no picture) so fallback icon shows
      component.profile.set({ data: {} });
      component.imageLoadError.set(false);
      fixture.detectChanges();
      await fixture.whenStable();
      const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon.default-user-avatar');
      expect(icon).toBeTruthy();
    });

    it('should apply not-found-avatar class when profile is not found', async () => {
      component.profile.set({ isEmpty: true });
      component.imageLoadError.set(false);
      fixture.detectChanges();
      await fixture.whenStable();
      const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon.default-user-avatar');
      expect(icon).toBeTruthy();
      expect(icon!.classList.contains('not-found-avatar')).toBeTrue();
    });

    it('should apply error-avatar class when image load fails', async () => {
      component.profile.set({ data: {} });
      component.imageLoadError.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon.default-user-avatar');
      expect(icon).toBeTruthy();
      expect(icon!.classList.contains('error-avatar')).toBeTrue();
    });

    it('should not apply not-found-avatar when profile has data', async () => {
      component.profile.set({ data: {} });
      component.imageLoadError.set(false);
      fixture.detectChanges();
      await fixture.whenStable();
      const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon.default-user-avatar');
      expect(icon).toBeTruthy();
      expect(icon!.classList.contains('not-found-avatar')).toBeFalse();
    });

    it('should not apply error-avatar when image has not errored', async () => {
      component.profile.set({ data: {} });
      component.imageLoadError.set(false);
      fixture.detectChanges();
      await fixture.whenStable();
      const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon.default-user-avatar');
      expect(icon).toBeTruthy();
      expect(icon!.classList.contains('error-avatar')).toBeFalse();
    });

    it('should apply both not-found-avatar and error-avatar when both conditions are true', async () => {
      component.profile.set({ isEmpty: true });
      component.imageLoadError.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon.default-user-avatar');
      expect(icon).toBeTruthy();
      expect(icon!.classList.contains('not-found-avatar')).toBeTrue();
      expect(icon!.classList.contains('error-avatar')).toBeTrue();
    });
  });

  describe('mat-icon in name view', () => {
    it('should apply class bindings correctly in name view', async () => {
      fixture.componentRef.setInput('view', 'name' as ViewMode);
      component.profile.set({ isEmpty: true });
      component.imageLoadError.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon.default-user-avatar');
      expect(icon).toBeTruthy();
      expect(icon!.classList.contains('not-found-avatar')).toBeTrue();
      expect(icon!.classList.contains('error-avatar')).toBeTrue();
    });
  });

  describe('mat-icon in tiny view', () => {
    it('should apply class bindings correctly in tiny view', async () => {
      fixture.componentRef.setInput('view', 'tiny' as ViewMode);
      component.profile.set({ data: {} });
      component.imageLoadError.set(true);
      fixture.detectChanges();
      await fixture.whenStable();
      const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon.default-user-avatar');
      expect(icon).toBeTruthy();
      expect(icon!.classList.contains('error-avatar')).toBeTrue();
      expect(icon!.classList.contains('not-found-avatar')).toBeFalse();
    });
  });

  describe('mat-icon in chip view', () => {
    it('should apply class bindings correctly in chip view', async () => {
      fixture.componentRef.setInput('view', 'chip' as ViewMode);
      component.profile.set({ isEmpty: true });
      component.imageLoadError.set(false);
      fixture.detectChanges();
      await fixture.whenStable();
      const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon.default-user-avatar');
      expect(icon).toBeTruthy();
      expect(icon!.classList.contains('not-found-avatar')).toBeTrue();
      expect(icon!.classList.contains('error-avatar')).toBeFalse();
    });
  });

  describe('mat-icon in avatar view', () => {
    it('should apply class bindings correctly in avatar view', async () => {
      fixture.componentRef.setInput('view', 'avatar' as ViewMode);
      component.profile.set({ data: {} });
      component.imageLoadError.set(false);
      fixture.detectChanges();
      await fixture.whenStable();
      const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon.default-user-avatar');
      expect(icon).toBeTruthy();
      expect(icon!.classList.contains('not-found-avatar')).toBeFalse();
      expect(icon!.classList.contains('error-avatar')).toBeFalse();
    });
  });
});
