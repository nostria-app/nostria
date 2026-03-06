import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ReportDialogComponent, ReportDialogData } from './report-dialog.component';
import { ReportingService } from '../../services/reporting.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { DiscoveryRelayService } from '../../services/relays/discovery-relay';
import { NostrService } from '../../services/nostr.service';
import { LayoutService } from '../../services/layout.service';
import { AccountStateService } from '../../services/account-state.service';
import { PublishService } from '../../services/publish.service';
import { LoggerService } from '../../services/logger.service';

describe('ReportDialogComponent', () => {
    let component: ReportDialogComponent;
    let fixture: ComponentFixture<ReportDialogComponent>;

    const mockDialogRef = {
        close: vi.fn(),
    };

    const mockDialogData: ReportDialogData = {
        target: {
            type: 'user',
            pubkey: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        },
        userDisplayName: 'Test User',
    };

    const mockReportingService = {
        getReportTypeOptions: vi.fn().mockReturnValue([
            { value: 'spam', label: 'Spam', description: 'Spam content' },
        ]),
        createReportEvent: vi.fn(),
        notifyReportPublished: vi.fn(),
        createFreshMuteListEvent: vi.fn().mockResolvedValue(null),
    };

    const mockAccountRelayService = {
        getRelayUrls: vi.fn().mockReturnValue([]),
        publishToRelay: vi.fn(),
    };

    const mockDiscoveryRelayService = {
        getUserRelayUrls: vi.fn().mockResolvedValue([]),
    };

    const mockNostrService = {
        signEvent: vi.fn(),
    };

    const mockSnackBar = {
        open: vi.fn(),
    };

    const mockLayoutService = {};

    const mockAccountStateService = {};

    const mockPublishService = {
        signAndPublishAuto: vi.fn(),
    };

    const mockLoggerService = {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [ReportDialogComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
                { provide: ReportingService, useValue: mockReportingService },
                { provide: AccountRelayService, useValue: mockAccountRelayService },
                { provide: DiscoveryRelayService, useValue: mockDiscoveryRelayService },
                { provide: NostrService, useValue: mockNostrService },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: LayoutService, useValue: mockLayoutService },
                { provide: AccountStateService, useValue: mockAccountStateService },
                { provide: PublishService, useValue: mockPublishService },
                { provide: LoggerService, useValue: mockLoggerService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ReportDialogComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        fixture.detectChanges();
        expect(component).toBeTruthy();
    });

    describe('result status class bindings', () => {
        it('should apply status-pending class for pending results', async () => {
            component.publishResults.set([
                { url: 'wss://relay.example.com', status: 'pending' },
            ]);
            fixture.detectChanges();
            await fixture.whenStable();

            const el = (fixture.nativeElement as HTMLElement).querySelector('.result-status');
            expect(el).toBeTruthy();
            expect(el!.classList.contains('result-status')).toBe(true);
            expect(el!.classList.contains('status-pending')).toBe(true);
            expect(el!.classList.contains('status-success')).toBe(false);
            expect(el!.classList.contains('status-error')).toBe(false);
        });

        it('should apply status-success class for success results', async () => {
            component.publishResults.set([
                { url: 'wss://relay.example.com', status: 'success', message: 'Published successfully' },
            ]);
            fixture.detectChanges();
            await fixture.whenStable();

            const el = (fixture.nativeElement as HTMLElement).querySelector('.result-status');
            expect(el).toBeTruthy();
            expect(el!.classList.contains('result-status')).toBe(true);
            expect(el!.classList.contains('status-success')).toBe(true);
            expect(el!.classList.contains('status-pending')).toBe(false);
            expect(el!.classList.contains('status-error')).toBe(false);
        });

        it('should apply status-error class for error results', async () => {
            component.publishResults.set([
                { url: 'wss://relay.example.com', status: 'error', message: 'Connection failed' },
            ]);
            fixture.detectChanges();
            await fixture.whenStable();

            const el = (fixture.nativeElement as HTMLElement).querySelector('.result-status');
            expect(el).toBeTruthy();
            expect(el!.classList.contains('result-status')).toBe(true);
            expect(el!.classList.contains('status-error')).toBe(true);
            expect(el!.classList.contains('status-pending')).toBe(false);
            expect(el!.classList.contains('status-success')).toBe(false);
        });

        it('should apply correct classes to multiple results with different statuses', async () => {
            component.publishResults.set([
                { url: 'wss://relay1.example.com', status: 'success', message: 'OK' },
                { url: 'wss://relay2.example.com', status: 'error', message: 'Failed' },
                { url: 'wss://relay3.example.com', status: 'pending' },
            ]);
            fixture.detectChanges();
            await fixture.whenStable();

            const elements = (fixture.nativeElement as HTMLElement).querySelectorAll('.result-status');
            expect(elements.length).toBe(3);

            expect(elements[0].classList.contains('status-success')).toBe(true);
            expect(elements[1].classList.contains('status-error')).toBe(true);
            expect(elements[2].classList.contains('status-pending')).toBe(true);
        });
    });

    describe('publish results rendering', () => {
        it('should not show publish results when empty', async () => {
            component.publishResults.set([]);
            fixture.detectChanges();
            await fixture.whenStable();

            const el = (fixture.nativeElement as HTMLElement).querySelector('.publish-results');
            expect(el).toBeNull();
        });

        it('should show publish results section when results exist', async () => {
            component.publishResults.set([
                { url: 'wss://relay.example.com', status: 'pending' },
            ]);
            fixture.detectChanges();
            await fixture.whenStable();

            const el = (fixture.nativeElement as HTMLElement).querySelector('.publish-results');
            expect(el).toBeTruthy();
        });

        it('should display relay URL in results', async () => {
            component.publishResults.set([
                { url: 'wss://relay.example.com', status: 'success', message: 'OK' },
            ]);
            fixture.detectChanges();
            await fixture.whenStable();

            const urlEl = (fixture.nativeElement as HTMLElement).querySelector('.result-content .relay-url');
            expect(urlEl).toBeTruthy();
            expect(urlEl!.textContent).toContain('wss://relay.example.com');
        });
    });
});
