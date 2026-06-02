import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { ProfileDisplayNameComponent } from './profile-display-name.component';
import { DataService } from '../../../services/data.service';
import { LoggerService } from '../../../services/logger.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { ProfileHoverCardService } from '../../../services/profile-hover-card.service';
import { SettingsService } from '../../../services/settings.service';
import { LayoutService } from '../../../services/layout.service';
import { IntersectionObserverService } from '../../../services/intersection-observer.service';
import { AccountStateService } from '../../../services/account-state.service';

describe('ProfileDisplayNameComponent', () => {
    let component: ProfileDisplayNameComponent;
    let fixture: ComponentFixture<ProfileDisplayNameComponent>;

    beforeEach(async () => {
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

        const mockUtilitiesService = {
            safeGetHexPubkey: vi.fn().mockReturnValue(null),
            getTruncatedNpub: vi.fn().mockReturnValue('npub1...'),
            parseNip05: vi.fn().mockReturnValue(null),
        };

        const mockHoverCardService = {
            showHoverCard: vi.fn(),
            hideHoverCard: vi.fn(),
            onTouchStart: vi.fn(),
            onTouchMove: vi.fn(),
            onTouchEnd: vi.fn(),
        };

        const mockSettingsService = {
            settings: signal({ imageCacheEnabled: false }),
        };

        const mockLayoutService = {
            openProfile: vi.fn(),
        };

        const mockIntersectionObserverService = {
            observe: vi.fn(),
            unobserve: vi.fn(),
        };

        const mockAccountStateService = {
            getFollowingPetname: vi.fn().mockReturnValue(undefined),
        };

        await TestBed.configureTestingModule({
            imports: [ProfileDisplayNameComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DataService, useValue: mockDataService },
                { provide: LoggerService, useValue: mockLoggerService },
                { provide: UtilitiesService, useValue: mockUtilitiesService },
                { provide: ProfileHoverCardService, useValue: mockHoverCardService },
                { provide: SettingsService, useValue: mockSettingsService },
                { provide: LayoutService, useValue: mockLayoutService },
                { provide: IntersectionObserverService, useValue: mockIntersectionObserverService },
                { provide: AccountStateService, useValue: mockAccountStateService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ProfileDisplayNameComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should use OnPush change detection', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const metadata = (ProfileDisplayNameComponent as any).ɵcmp;
        expect(metadata.onPush).toBe(true);
    });

    it('should render loading state when profile is null', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const el = fixture.nativeElement as HTMLElement;
        const link = el.querySelector('.profile-link');
        expect(link).toBeTruthy();
        expect(link!.textContent!.trim()).toBe('...');
    });

    it('should render display_name when profile has one', async () => {
        component.profile.set({ data: { display_name: 'Alice' } });
        fixture.detectChanges();
        await fixture.whenStable();
        const el = fixture.nativeElement as HTMLElement;
        const link = el.querySelector('.profile-link');
        expect(link!.textContent!.trim()).toBe('Alice');
    });

    it('should render name when profile has no display_name', async () => {
        component.profile.set({ data: { name: 'bob' } });
        fixture.detectChanges();
        await fixture.whenStable();
        const el = fixture.nativeElement as HTMLElement;
        const link = el.querySelector('.profile-link');
        expect(link!.textContent!.trim()).toBe('bob');
    });

    it('should render petname before profile metadata when available', async () => {
        const accountState = TestBed.inject(AccountStateService);
        vi.mocked(accountState.getFollowingPetname).mockReturnValue('Local Alice');
        fixture.componentRef.setInput('pubkey', 'f'.repeat(64));
        component.profile.set({ data: { display_name: 'Alice' } });
        fixture.detectChanges();
        await fixture.whenStable();
        const el = fixture.nativeElement as HTMLElement;
        const link = el.querySelector('.profile-link');
        expect(link!.textContent!.trim()).toBe('Local Alice');
    });

    it('should render truncated npub when profile is empty', async () => {
        component.profile.set({ isEmpty: true });
        fixture.detectChanges();
        await fixture.whenStable();
        const el = fixture.nativeElement as HTMLElement;
        const link = el.querySelector('.profile-link');
        expect(link!.textContent!.trim()).toBe('npub1...');
    });

    it('should render a disabled span when disableLink is true', async () => {
        fixture.componentRef.setInput('disableLink', true);
        fixture.detectChanges();
        await fixture.whenStable();
        const el = fixture.nativeElement as HTMLElement;
        const span = el.querySelector('span.profile-link.disabled');
        expect(span).toBeTruthy();
        const anchor = el.querySelector('a.profile-link');
        expect(anchor).toBeNull();
    });

    it('should render an anchor when disableLink is false', async () => {
        fixture.detectChanges();
        await fixture.whenStable();
        const el = fixture.nativeElement as HTMLElement;
        const anchor = el.querySelector('a.profile-link');
        expect(anchor).toBeTruthy();
        const span = el.querySelector('span.profile-link.disabled');
        expect(span).toBeNull();
    });
});
