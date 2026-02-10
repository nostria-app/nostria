import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
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

describe('RelaysComponent', () => {
  let component: RelaysComponent;
  let fixture: ComponentFixture<RelaysComponent>;

  beforeEach(async () => {
    const mockAccountRelay = {
      relaysSignal: signal([]),
      relaysModifiedSignal: signal([]),
      getRelayUrls: () => [],
    };

    const mockDiscoveryRelay = {
      relaysSignal: signal([]),
      getRelayUrls: () => [],
    };

    const mockRelaysService = {
      observedRelaysSignal: signal([]),
      getRelayPerformanceScore: (url: string) => 75,
      loadObservedRelays: () => Promise.resolve(),
      clearAllStats: () => {},
      removeRelay: () => {},
    };

    const mockRelayAuth = {
      hasAuthFailed: () => false,
      requiresAuth: () => false,
    };

    const mockAccountState = {
      pubkey: signal(''),
    };

    const mockRightPanel = jasmine.createSpyObj('RightPanelService', ['goBack', 'open'], {
      hasContent: signal(false),
    });

    const mockPanelActions = jasmine.createSpyObj('PanelActionsService', ['setPageTitle', 'clearPageTitle']);

    await TestBed.configureTestingModule({
      imports: [RelaysComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: NostrService, useValue: {} },
        { provide: LoggerService, useValue: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} } },
        { provide: MatSnackBar, useValue: { open: () => {} } },
        { provide: MatDialog, useValue: { open: () => {} } },
        { provide: LayoutService, useValue: {} },
        { provide: DatabaseService, useValue: { getEventByPubkeyAndKind: () => Promise.resolve(null) } },
        { provide: NotificationService, useValue: {} },
        { provide: ApplicationService, useValue: {} },
        { provide: UtilitiesService, useValue: { getRelayUrlsFromFollowing: () => [], normalizeRelayUrls: (urls: string[]) => urls, normalizeRelayUrl: (url: string) => url, formatRelativeTime: () => '' } },
        { provide: AccountStateService, useValue: mockAccountState },
        { provide: AccountRelayService, useValue: mockAccountRelay },
        { provide: DiscoveryRelayService, useValue: mockDiscoveryRelay },
        { provide: DataService, useValue: {} },
        { provide: RelaysService, useValue: mockRelaysService },
        { provide: EventRepublishService, useValue: {} },
        { provide: RelayAuthService, useValue: mockRelayAuth },
        { provide: PanelActionsService, useValue: mockPanelActions },
        { provide: RightPanelService, useValue: mockRightPanel },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RelaysComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
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
