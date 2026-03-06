import type { MockedObject } from "vitest";
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
            getProfile: vi.fn().mockResolvedValue(null),
            getCachedProfile: vi.fn().mockReturnValue(null),
        };

        const mockLoggerService = {
            debug: vi.fn(),
            error: vi.fn(),
            time: vi.fn(),
            timeEnd: vi.fn(),
        };

        const mockLayoutService = {
            openProfile: vi.fn(),
            isScrolling: signal(false),
        };

        const mockUtilitiesService = {
            isValidHexPubkey: vi.fn().mockReturnValue(false),
            getPubkeyFromNpub: vi.fn().mockReturnValue(''),
            getNpubFromPubkey: vi.fn().mockReturnValue(''),
            parseNip05: vi.fn().mockReturnValue(null),
        };

        const mockSettingsService = {
            settings: signal({ imageCacheEnabled: false }),
        };

        const mockSharedRelayService = {};

        const mockImageCacheService = {
            getOptimizedImageUrl: vi.fn().mockImplementation((url: string) => url),
        };

        const mockHoverCardService = {
            showHoverCard: vi.fn(),
            hideHoverCard: vi.fn(),
            onTouchStart: vi.fn(),
            onTouchMove: vi.fn(),
            onTouchEnd: vi.fn(),
        };

        const mockTrustService = {
            isEnabled: signal(false),
        };

        const mockIntersectionObserverService = {
            observe: vi.fn(),
            unobserve: vi.fn(),
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

    it('should use OnPush change detection', () => {
        const ref = fixture.componentRef;
        expect(ref.changeDetectorRef).toBeTruthy();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const metadata = (UserProfileComponent as any).ɵcmp;
        // OnPush = 1 in Angular's internal representation
        expect(metadata.onPush).toBe(true);
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
            expect(rootDiv!.classList.contains('list')).toBe(true);
        });

        it('should apply grid view class when view is grid', async () => {
            fixture.componentRef.setInput('view', 'grid' as ViewMode);
            fixture.detectChanges();
            await fixture.whenStable();
            const rootDiv = (fixture.nativeElement as HTMLElement).querySelector('.user-profile');
            expect(rootDiv!.classList.contains('grid')).toBe(true);
            expect(rootDiv!.classList.contains('list')).toBe(false);
        });

        it('should apply large view class when view is large', async () => {
            fixture.componentRef.setInput('view', 'large' as ViewMode);
            fixture.detectChanges();
            await fixture.whenStable();
            const rootDiv = (fixture.nativeElement as HTMLElement).querySelector('.user-profile');
            expect(rootDiv!.classList.contains('large')).toBe(true);
        });

        it('should apply chip view class when view is chip', async () => {
            fixture.componentRef.setInput('view', 'chip' as ViewMode);
            fixture.detectChanges();
            await fixture.whenStable();
            const rootDiv = (fixture.nativeElement as HTMLElement).querySelector('.user-profile');
            expect(rootDiv!.classList.contains('chip')).toBe(true);
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
            expect(icon!.classList.contains('not-found-avatar')).toBe(true);
        });

        it('should apply error-avatar class when image load fails', async () => {
            component.profile.set({ data: {} });
            component.imageLoadError.set(true);
            fixture.detectChanges();
            await fixture.whenStable();
            const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon.default-user-avatar');
            expect(icon).toBeTruthy();
            expect(icon!.classList.contains('error-avatar')).toBe(true);
        });

        it('should not apply not-found-avatar when profile has data', async () => {
            component.profile.set({ data: {} });
            component.imageLoadError.set(false);
            fixture.detectChanges();
            await fixture.whenStable();
            const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon.default-user-avatar');
            expect(icon).toBeTruthy();
            expect(icon!.classList.contains('not-found-avatar')).toBe(false);
        });

        it('should not apply error-avatar when image has not errored', async () => {
            component.profile.set({ data: {} });
            component.imageLoadError.set(false);
            fixture.detectChanges();
            await fixture.whenStable();
            const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon.default-user-avatar');
            expect(icon).toBeTruthy();
            expect(icon!.classList.contains('error-avatar')).toBe(false);
        });

        it('should apply both not-found-avatar and error-avatar when both conditions are true', async () => {
            component.profile.set({ isEmpty: true });
            component.imageLoadError.set(true);
            fixture.detectChanges();
            await fixture.whenStable();
            const icon = (fixture.nativeElement as HTMLElement).querySelector('mat-icon.default-user-avatar');
            expect(icon).toBeTruthy();
            expect(icon!.classList.contains('not-found-avatar')).toBe(true);
            expect(icon!.classList.contains('error-avatar')).toBe(true);
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
            expect(icon!.classList.contains('not-found-avatar')).toBe(true);
            expect(icon!.classList.contains('error-avatar')).toBe(true);
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
            expect(icon!.classList.contains('error-avatar')).toBe(true);
            expect(icon!.classList.contains('not-found-avatar')).toBe(false);
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
            expect(icon!.classList.contains('not-found-avatar')).toBe(true);
            expect(icon!.classList.contains('error-avatar')).toBe(false);
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
            expect(icon!.classList.contains('not-found-avatar')).toBe(false);
            expect(icon!.classList.contains('error-avatar')).toBe(false);
        });
    });

    describe('hover card behavior', () => {
        let mockHoverCardService: MockedObject<ProfileHoverCardService>;

        beforeEach(() => {
            mockHoverCardService = TestBed.inject(ProfileHoverCardService) as MockedObject<ProfileHoverCardService>;
        });

        it('should call showHoverCard on mouse enter when disableHoverCard is false', () => {
            fixture.componentRef.setInput('pubkey', 'testpubkey123');
            fixture.componentRef.setInput('disableHoverCard', false);
            fixture.detectChanges();

            const mockElement = document.createElement('div');
            const mockEvent = new MouseEvent('mouseenter');
            component.onMouseEnter(mockEvent, mockElement);

            expect(mockHoverCardService.showHoverCard).toHaveBeenCalledWith(mockElement, 'testpubkey123');
        });

        it('should not call showHoverCard on mouse enter when disableHoverCard is true', () => {
            fixture.componentRef.setInput('pubkey', 'testpubkey123');
            fixture.componentRef.setInput('disableHoverCard', true);
            fixture.detectChanges();

            const mockElement = document.createElement('div');
            const mockEvent = new MouseEvent('mouseenter');
            component.onMouseEnter(mockEvent, mockElement);

            expect(mockHoverCardService.showHoverCard).not.toHaveBeenCalled();
        });

        it('should call onTouchStart on touch when disableHoverCard is false', () => {
            fixture.componentRef.setInput('pubkey', 'testpubkey123');
            fixture.componentRef.setInput('disableHoverCard', false);
            fixture.detectChanges();

            const mockElement = document.createElement('div');
            const mockEvent = new TouchEvent('touchstart', {
                touches: [{ clientX: 0, clientY: 0 } as Touch],
            });
            component.onTouchStart(mockEvent, mockElement);

            expect(mockHoverCardService.onTouchStart).toHaveBeenCalledWith(mockEvent, mockElement, 'testpubkey123');
        });

        it('should not call onTouchStart on touch when disableHoverCard is true', () => {
            fixture.componentRef.setInput('pubkey', 'testpubkey123');
            fixture.componentRef.setInput('disableHoverCard', true);
            fixture.detectChanges();

            const mockElement = document.createElement('div');
            const mockEvent = new TouchEvent('touchstart', {
                touches: [{ clientX: 0, clientY: 0 } as Touch],
            });
            component.onTouchStart(mockEvent, mockElement);

            expect(mockHoverCardService.onTouchStart).not.toHaveBeenCalled();
        });

        it('should not show hover card for tiny view regardless of disableHoverCard', () => {
            fixture.componentRef.setInput('view', 'tiny' as ViewMode);
            fixture.componentRef.setInput('pubkey', 'testpubkey123');
            fixture.componentRef.setInput('disableHoverCard', false);
            fixture.detectChanges();

            const mockElement = document.createElement('div');
            const mockEvent = new MouseEvent('mouseenter');
            component.onMouseEnter(mockEvent, mockElement);

            expect(mockHoverCardService.showHoverCard).not.toHaveBeenCalled();
        });

        it('should not show hover card for name view regardless of disableHoverCard', () => {
            fixture.componentRef.setInput('view', 'name' as ViewMode);
            fixture.componentRef.setInput('pubkey', 'testpubkey123');
            fixture.componentRef.setInput('disableHoverCard', false);
            fixture.detectChanges();

            const mockElement = document.createElement('div');
            const mockEvent = new MouseEvent('mouseenter');
            component.onMouseEnter(mockEvent, mockElement);

            expect(mockHoverCardService.showHoverCard).not.toHaveBeenCalled();
        });

        it('should not show hover card for chip view regardless of disableHoverCard', () => {
            fixture.componentRef.setInput('view', 'chip' as ViewMode);
            fixture.componentRef.setInput('pubkey', 'testpubkey123');
            fixture.componentRef.setInput('disableHoverCard', false);
            fixture.detectChanges();

            const mockElement = document.createElement('div');
            const mockEvent = new MouseEvent('mouseenter');
            component.onMouseEnter(mockEvent, mockElement);

            expect(mockHoverCardService.showHoverCard).not.toHaveBeenCalled();
        });
    });
});
