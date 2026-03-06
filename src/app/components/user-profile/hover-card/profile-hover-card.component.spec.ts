import type { Mock } from "vitest";
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ProfileHoverCardComponent } from './profile-hover-card.component';
import { DataService } from '../../../services/data.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { SettingsService } from '../../../services/settings.service';
import { ImageCacheService } from '../../../services/image-cache.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ReportingService } from '../../../services/reporting.service';
import { LayoutService } from '../../../services/layout.service';
import { DatabaseService } from '../../../services/database.service';
import { UserDataService } from '../../../services/user-data.service';
import { TrustService } from '../../../services/trust.service';
import { FavoritesService } from '../../../services/favorites.service';
import { PublishService } from '../../../services/publish.service';
import { NostrService } from '../../../services/nostr.service';
import { FollowSetsService } from '../../../services/follow-sets.service';
import { ProfileHoverCardService } from '../../../services/profile-hover-card.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

// Test wrapper to provide pubkey input
@Component({
    selector: 'app-test-host',
    template: '<app-profile-hover-card [pubkey]="pubkey" />',
    imports: [ProfileHoverCardComponent],
})
class TestHostComponent {
    pubkey = 'a'.repeat(64);
}

describe('ProfileHoverCardComponent', () => {
    let hostFixture: ComponentFixture<TestHostComponent>;
    let hoverCardEl: HTMLElement;
    let mockHoverCardService: {
        closeHoverCard: Mock;
        hideHoverCard: Mock;
    };

    function createComponent() {
        const mockSettingsService = {
            settings: signal({ imageCacheEnabled: false }),
        };

        const mockDataService = {
            getProfile: vi.fn().mockReturnValue(Promise.resolve(null)),
        };

        const mockUtilitiesService = {
            truncateString: vi.fn().mockImplementation((s: string) => s),
            truncateContent: vi.fn().mockImplementation((s: string) => s),
            getRelativeTime: vi.fn().mockReturnValue('1h ago'),
            parseNip05: vi.fn().mockReturnValue(null),
        };

        const mockAccountStateService = {
            followingList: signal([] as string[]),
            account: signal(null),
        };

        const mockTrustService = {
            isEnabled: signal(false),
            fetchMetrics: vi.fn().mockReturnValue(Promise.resolve(null)),
        };

        const mockFavoritesService = {
            isFavorite: vi.fn().mockReturnValue(false),
            toggleFavorite: vi.fn().mockReturnValue(true),
        };

        const mockFollowSetsService = {
            followSets: signal([]),
            getFollowSetByDTag: vi.fn().mockReturnValue(null),
        };

        mockHoverCardService = {
            closeHoverCard: vi.fn(),
            hideHoverCard: vi.fn(),
        };

        const mockLayoutService = {
            openProfile: vi.fn(),
            showLoginDialog: vi.fn().mockReturnValue(Promise.resolve()),
            toast: vi.fn(),
        };

        const mockDatabaseService = {
            getEventByPubkeyAndKind: vi.fn().mockReturnValue(Promise.resolve(null)),
        };

        const mockUserDataService = {
            getEventByPubkeyAndKind: vi.fn().mockReturnValue(Promise.resolve(null)),
        };

        TestBed.configureTestingModule({
            imports: [TestHostComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: DataService, useValue: mockDataService },
                { provide: UtilitiesService, useValue: mockUtilitiesService },
                { provide: SettingsService, useValue: mockSettingsService },
                { provide: ImageCacheService, useValue: { getOptimizedImageUrl: (url: string) => url } },
                { provide: AccountStateService, useValue: mockAccountStateService },
                { provide: ReportingService, useValue: {} },
                { provide: LayoutService, useValue: mockLayoutService },
                { provide: DatabaseService, useValue: mockDatabaseService },
                { provide: UserDataService, useValue: mockUserDataService },
                { provide: TrustService, useValue: mockTrustService },
                { provide: FavoritesService, useValue: mockFavoritesService },
                { provide: PublishService, useValue: {} },
                { provide: NostrService, useValue: {} },
                { provide: FollowSetsService, useValue: mockFollowSetsService },
                { provide: ProfileHoverCardService, useValue: mockHoverCardService },
                { provide: MatDialog, useValue: { open: vi.fn() } },
                { provide: MatSnackBar, useValue: { open: vi.fn() } },
            ],
        });

        hostFixture = TestBed.createComponent(TestHostComponent);
        hostFixture.detectChanges();
        hoverCardEl = hostFixture.nativeElement.querySelector('app-profile-hover-card');
    }

    it('should create', () => {
        createComponent();
        expect(hoverCardEl).toBeTruthy();
    });

    it('should use OnPush change detection', () => {
        createComponent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const metadata = (ProfileHoverCardComponent as any).ɵcmp;
        expect(metadata.onPush).toBe(true);
    });

    it('should close hover card when a link element is clicked', fakeAsync(() => {
        createComponent();

        const link = document.createElement('a');
        link.href = '/test';
        hoverCardEl.appendChild(link);

        link.click();
        tick(150);

        expect(mockHoverCardService.closeHoverCard).toHaveBeenCalled();
    }));

    it('should close hover card when a button element is clicked', fakeAsync(() => {
        createComponent();

        const button = document.createElement('button');
        button.textContent = 'Test Button';
        hoverCardEl.appendChild(button);

        button.click();
        tick(150);

        expect(mockHoverCardService.closeHoverCard).toHaveBeenCalled();
    }));

    it('should close hover card when an element inside a link is clicked', fakeAsync(() => {
        createComponent();

        const link = document.createElement('a');
        link.href = '/test';
        const span = document.createElement('span');
        span.textContent = 'Click me';
        link.appendChild(span);
        hoverCardEl.appendChild(link);

        span.click();
        tick(150);

        expect(mockHoverCardService.closeHoverCard).toHaveBeenCalled();
    }));

    it('should close hover card when an element inside a button is clicked', fakeAsync(() => {
        createComponent();

        const button = document.createElement('button');
        const icon = document.createElement('mat-icon');
        icon.textContent = 'person_add';
        button.appendChild(icon);
        hoverCardEl.appendChild(button);

        icon.click();
        tick(150);

        expect(mockHoverCardService.closeHoverCard).toHaveBeenCalled();
    }));

    it('should not close hover card when the menu button is clicked', fakeAsync(() => {
        createComponent();

        const menuButton = document.createElement('button');
        menuButton.classList.add('menu-button');
        hoverCardEl.appendChild(menuButton);

        menuButton.click();
        tick(150);

        expect(mockHoverCardService.closeHoverCard).not.toHaveBeenCalled();
    }));

    it('should not close hover card when a non-interactive element is clicked', fakeAsync(() => {
        createComponent();

        const div = document.createElement('div');
        div.textContent = 'Just text';
        hoverCardEl.appendChild(div);

        div.click();
        tick(150);

        expect(mockHoverCardService.closeHoverCard).not.toHaveBeenCalled();
    }));

    it('should not close hover card when an element inside menu-button is clicked', fakeAsync(() => {
        createComponent();

        const menuButton = document.createElement('button');
        menuButton.classList.add('menu-button');
        const icon = document.createElement('mat-icon');
        icon.textContent = 'more_horiz';
        menuButton.appendChild(icon);
        hoverCardEl.appendChild(menuButton);

        icon.click();
        tick(150);

        expect(mockHoverCardService.closeHoverCard).not.toHaveBeenCalled();
    }));
});
