import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { DomSanitizer } from '@angular/platform-browser';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { RelaysComponent } from './relays.component';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { LayoutService } from '../../../services/layout.service';
import { DatabaseService } from '../../../services/database.service';
import { NotificationService } from '../../../services/notification.service';
import { ApplicationService } from '../../../services/application.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { AccountStateService } from '../../../services/account-state.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { DiscoveryRelayService } from '../../../services/relays/discovery-relay';
import { DataService } from '../../../services/data.service';
import { RelaysService } from '../../../services/relays/relays';
import { EventRepublishService } from '../../../services/event-republish.service';
import { RelayAuthService } from '../../../services/relays/relay-auth.service';
import { PanelActionsService } from '../../../services/panel-actions.service';
import { RightPanelService } from '../../../services/right-panel.service';
import { CustomDialogService } from '../../../services/custom-dialog.service';
import { IgnoredRelayAuditService } from '../../../services/ignored-relay-audit.service';
import { RegionService } from '../../../services/region.service';

describe('RelaysComponent', () => {
  let component: RelaysComponent;
  let fixture: ComponentFixture<RelaysComponent>;

  beforeEach(async () => {
    const mockAccountRelay = {
      relaysSignal: signal([]),
      relaysModifiedSignal: signal([]),
      getRelayUrls: () => [],
      publish: vi.fn().mockResolvedValue(undefined),
      addRelay: vi.fn(),
    };

    const mockDiscoveryRelay = {
      relaysSignal: signal([]),
      getRelayUrls: () => [],
      addRelay: vi.fn(),
      setDiscoveryRelays: vi.fn(),
    };

    const mockRelaysService = {
      observedRelaysSignal: signal([]),
      getRelayPerformanceScore: (url: string) => 75,
      loadObservedRelays: () => Promise.resolve(),
      clearAllStats: () => { },
      removeRelay: () => { },
    };

    const mockRelayAuth = {
      hasAuthFailed: () => false,
      requiresAuth: () => false,
    };

    const mockAccountState = {
      pubkey: signal('aa'.repeat(32)),
    };

    const mockRightPanel = {
      goBack: vi.fn().mockName("RightPanelService.goBack"),
      open: vi.fn().mockName("RightPanelService.open"),
      hasContent: signal(false)
    };

    const mockPanelActions = {
      setPageTitle: vi.fn().mockName("PanelActionsService.setPageTitle"),
      clearPageTitle: vi.fn().mockName("PanelActionsService.clearPageTitle")
    };

    await TestBed.configureTestingModule({
      imports: [RelaysComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: NostrService,
          useValue: {
            createTags: (name: string, values: string[]) => values.map(value => [name, value]),
            signEvent: vi.fn().mockResolvedValue({ id: 'signed' }),
          },
        },
        { provide: LoggerService, useValue: { info: () => { }, debug: () => { }, warn: () => { }, error: () => { } } },
        { provide: MatSnackBar, useValue: { open: () => { } } },
        { provide: MatDialog, useValue: { open: () => { } } },
        { provide: LayoutService, useValue: {} },
        {
          provide: DatabaseService,
          useValue: {
            getEventByPubkeyAndKind: () => Promise.resolve(null),
            saveEvent: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationService, useValue: {} },
        { provide: ApplicationService, useValue: { isBrowser: signal(false) } },
        { provide: DomSanitizer, useValue: {} },
        { provide: IgnoredRelayAuditService, useValue: { isExcludedAuditDomain: () => false, recordIgnoredRelayUsage: () => {} } },
        { provide: RegionService, useValue: { rewriteAppRelayUrl: (url: string) => url } },
        UtilitiesService,
        { provide: AccountStateService, useValue: mockAccountState },
        { provide: AccountRelayService, useValue: mockAccountRelay },
        { provide: DiscoveryRelayService, useValue: mockDiscoveryRelay },
        { provide: DataService, useValue: {} },
        { provide: RelaysService, useValue: mockRelaysService },
        { provide: EventRepublishService, useValue: {} },
        { provide: RelayAuthService, useValue: mockRelayAuth },
        { provide: PanelActionsService, useValue: mockPanelActions },
        { provide: RightPanelService, useValue: mockRightPanel },
        { provide: CustomDialogService, useValue: { open: () => ({ afterClosed$: { subscribe: () => { } } }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RelaysComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('addMessageRelay', () => {
    it('rejects URLs that are not ws:// or wss://', async () => {
      const snackBar = TestBed.inject(MatSnackBar);
      const open = vi.spyOn(snackBar, 'open');

      component.newMessageRelayUrl.set('https://relay.example.com');
      await component.addMessageRelay();

      expect(open).toHaveBeenCalledWith(
        'Please enter a valid relay URL starting with wss:// or ws://',
        'Close',
        expect.objectContaining({ duration: 3000 })
      );
    });

    it('still adds a wss:// message relay', async () => {
      const snackBar = TestBed.inject(MatSnackBar);
      const open = vi.spyOn(snackBar, 'open');

      component.newMessageRelayUrl.set('wss://relay.primal.net/');
      await component.addMessageRelay();

      expect(component.messageRelays()).toEqual(['wss://relay.primal.net/']);
      expect(open).toHaveBeenCalledWith('Message relay added', 'Close', expect.objectContaining({ duration: 3000 }));
    });

    it('adds a Yggdrasil ws:// URL without rewriting it to wss://', async () => {
      const snackBar = TestBed.inject(MatSnackBar);
      const open = vi.spyOn(snackBar, 'open');
      const yggdrasil = 'ws://[31b:6f20:c7f2:3ddf::3221]';

      component.newMessageRelayUrl.set(yggdrasil);
      await component.addMessageRelay();

      expect(component.messageRelays()).toEqual(['ws://[31b:6f20:c7f2:3ddf::3221]/']);
      expect(open).toHaveBeenCalledWith('Message relay added', 'Close', expect.objectContaining({ duration: 3000 }));
    });

    it('rejects clearnet ws:// hosts', async () => {
      const snackBar = TestBed.inject(MatSnackBar);
      const open = vi.spyOn(snackBar, 'open');

      component.newMessageRelayUrl.set('ws://evil.example.com');
      await component.addMessageRelay();

      expect(component.messageRelays()).toEqual([]);
      expect(open).toHaveBeenCalledWith(
        'Please enter a valid relay URL starting with wss:// or ws://',
        'Close',
        expect.objectContaining({ duration: 3000 })
      );
    });
  });

  describe('addRelay', () => {
    it('rejects clearnet ws:// and does not persist it', async () => {
      const snackBar = TestBed.inject(MatSnackBar);
      const open = vi.spyOn(snackBar, 'open');
      const dialog = TestBed.inject(MatDialog);
      const dialogOpen = vi.spyOn(dialog, 'open');
      const accountRelay = TestBed.inject(AccountRelayService);

      component.newRelayUrl.set('ws://evil.example.com');
      await component.addRelay();

      expect(accountRelay.addRelay).not.toHaveBeenCalled();
      expect(dialogOpen).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith(
        'Please enter a valid relay URL starting with wss://',
        'Close',
        expect.objectContaining({ duration: 3000 })
      );
    });

    it('does not persist overlay ws:// on the account list', async () => {
      const dialog = TestBed.inject(MatDialog);
      const dialogOpen = vi.spyOn(dialog, 'open');
      const accountRelay = TestBed.inject(AccountRelayService);

      component.newRelayUrl.set('ws://[31b:6f20:c7f2:3ddf::3221]');
      await component.addRelay();

      expect(accountRelay.addRelay).not.toHaveBeenCalled();
      expect(dialogOpen).not.toHaveBeenCalled();
    });
  });

  describe('addBootstrapRelay', () => {
    it('rejects clearnet ws:// and does not persist it', () => {
      const snackBar = TestBed.inject(MatSnackBar);
      const open = vi.spyOn(snackBar, 'open');
      const discoveryRelay = TestBed.inject(DiscoveryRelayService);

      component.newBootstrapUrl.set('ws://evil.example.com');
      component.addBootstrapRelay();

      expect(discoveryRelay.addRelay).not.toHaveBeenCalled();
      expect(discoveryRelay.setDiscoveryRelays).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith(
        'Please enter a valid relay URL starting with wss://',
        'Close',
        expect.objectContaining({ duration: 3000 })
      );
    });

    it('does not persist overlay ws:// on the discovery list', () => {
      const discoveryRelay = TestBed.inject(DiscoveryRelayService);

      component.newBootstrapUrl.set('ws://[31b:6f20:c7f2:3ddf::3221]');
      component.addBootstrapRelay();

      expect(discoveryRelay.addRelay).not.toHaveBeenCalled();
      expect(discoveryRelay.setDiscoveryRelays).not.toHaveBeenCalled();
    });
  });

  describe('formatRelayUrl', () => {
    it('keeps ws:// so overlay entries stay distinguishable from wss://', () => {
      expect(component.formatRelayUrl('ws://[31b:6f20:c7f2:3ddf::3221]/')).toBe(
        'ws://[31b:6f20:c7f2:3ddf::3221]/'
      );
      expect(component.formatRelayUrl('wss://relay.primal.net/')).toBe('relay.primal.net/');
    });
  });

  describe('getPerformanceClass', () => {
    it('should return performance-excellent for score >= 80', () => {
      expect(component.getPerformanceClass(80)).toBe('performance-excellent');
      expect(component.getPerformanceClass(100)).toBe('performance-excellent');
    });

    it('should return performance-good for score >= 60 and < 80', () => {
      expect(component.getPerformanceClass(60)).toBe('performance-good');
      expect(component.getPerformanceClass(79)).toBe('performance-good');
    });

    it('should return performance-fair for score >= 40 and < 60', () => {
      expect(component.getPerformanceClass(40)).toBe('performance-fair');
      expect(component.getPerformanceClass(59)).toBe('performance-fair');
    });

    it('should return performance-poor for score < 40', () => {
      expect(component.getPerformanceClass(0)).toBe('performance-poor');
      expect(component.getPerformanceClass(39)).toBe('performance-poor');
    });
  });
});
