import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { PublishDialogComponent, PublishDialogData } from './publish-dialog.component';
import { NostrService } from '../../services/nostr.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { DiscoveryRelayService } from '../../services/relays/discovery-relay';
import { UserRelaysService } from '../../services/relays/user-relays';
import { UtilitiesService } from '../../services/utilities.service';
import { LoggerService } from '../../services/logger.service';

describe('PublishDialogComponent', () => {
  let component: PublishDialogComponent;
  let fixture: ComponentFixture<PublishDialogComponent>;

  const mockDialogRef = {
    close: jasmine.createSpy('close'),
  };

  const mockDialogData: PublishDialogData = {
    event: {
      id: 'test-id',
      pubkey: 'test-pubkey',
      created_at: Math.floor(Date.now() / 1000),
      kind: 1,
      tags: [],
      content: 'test content',
      sig: 'test-sig',
    },
  };

  const mockNostrService = {
    signEvent: jasmine.createSpy('signEvent'),
  };

  const mockAccountRelayService = {
    getRelayUrls: jasmine.createSpy('getRelayUrls').and.returnValue([]),
    publishToRelay: jasmine.createSpy('publishToRelay'),
  };

  const mockDiscoveryRelayService = {
    getUserRelayUrls: jasmine.createSpy('getUserRelayUrls').and.resolveTo([]),
  };

  const mockUserRelaysService = {
    getUserRelaysForPublishing: jasmine.createSpy('getUserRelaysForPublishing').and.resolveTo([]),
  };

  const mockUtilitiesService = {
    normalizeRelayUrl: jasmine.createSpy('normalizeRelayUrl').and.callFake((url: string) => url),
    getUniqueNormalizedRelayUrls: jasmine.createSpy('getUniqueNormalizedRelayUrls').and.callFake((urls: string[]) => [...new Set(urls)]),
  };

  const mockLoggerService = {
    debug: jasmine.createSpy('debug'),
    error: jasmine.createSpy('error'),
    info: jasmine.createSpy('info'),
    warn: jasmine.createSpy('warn'),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublishDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MatDialogRef, useValue: mockDialogRef },
        { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
        { provide: NostrService, useValue: mockNostrService },
        { provide: AccountRelayService, useValue: mockAccountRelayService },
        { provide: DiscoveryRelayService, useValue: mockDiscoveryRelayService },
        { provide: UserRelaysService, useValue: mockUserRelaysService },
        { provide: UtilitiesService, useValue: mockUtilitiesService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PublishDialogComponent);
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
      expect(el!.classList.contains('result-status')).toBeTrue();
      expect(el!.classList.contains('status-pending')).toBeTrue();
      expect(el!.classList.contains('status-success')).toBeFalse();
      expect(el!.classList.contains('status-error')).toBeFalse();
    });

    it('should apply status-success class for success results', async () => {
      component.publishResults.set([
        { url: 'wss://relay.example.com', status: 'success', message: 'Published successfully' },
      ]);
      fixture.detectChanges();
      await fixture.whenStable();

      const el = (fixture.nativeElement as HTMLElement).querySelector('.result-status');
      expect(el).toBeTruthy();
      expect(el!.classList.contains('result-status')).toBeTrue();
      expect(el!.classList.contains('status-success')).toBeTrue();
      expect(el!.classList.contains('status-pending')).toBeFalse();
      expect(el!.classList.contains('status-error')).toBeFalse();
    });

    it('should apply status-error class for error results', async () => {
      component.publishResults.set([
        { url: 'wss://relay.example.com', status: 'error', message: 'Connection failed' },
      ]);
      fixture.detectChanges();
      await fixture.whenStable();

      const el = (fixture.nativeElement as HTMLElement).querySelector('.result-status');
      expect(el).toBeTruthy();
      expect(el!.classList.contains('result-status')).toBeTrue();
      expect(el!.classList.contains('status-error')).toBeTrue();
      expect(el!.classList.contains('status-pending')).toBeFalse();
      expect(el!.classList.contains('status-success')).toBeFalse();
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

      expect(elements[0].classList.contains('status-success')).toBeTrue();
      expect(elements[1].classList.contains('status-error')).toBeTrue();
      expect(elements[2].classList.contains('status-pending')).toBeTrue();
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
