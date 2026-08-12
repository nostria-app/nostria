import type { Mock } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { EventHeaderComponent } from './header.component';
import { AccountStateService } from '../../../services/account-state.service';
import { UtilitiesService } from '../../../services/utilities.service';
import { UserRelaysService } from '../../../services/relays/user-relays';
import { DataService } from '../../../services/data.service';
import { DeleteEventService } from '../../../services/delete-event.service';
import { EventService } from '../../../services/event';
import { LayoutService } from '../../../services/layout.service';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { LoggerService } from '../../../services/logger.service';
import { NostrService } from '../../../services/nostr.service';
import { PowService } from '../../../services/pow.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { kinds } from 'nostr-tools';

describe('EventHeaderComponent', () => {
  let component: EventHeaderComponent;
  let fixture: ComponentFixture<EventHeaderComponent>;
  let mockAccountState: {
    pubkey: ReturnType<typeof signal<string>>;
    account: ReturnType<typeof signal<{
      pubkey: string;
      source: string;
      hasActivated: boolean;
    } | null>>;
  };
  let mockUtilities: {
    getEventExpiration: Mock;
    getRelativeTime: Mock;
  };

  const fixedNowMs = Date.UTC(2026, 2, 9, 12, 0, 0);
  const fixedNowSeconds = Math.floor(fixedNowMs / 1000);

  const mockEvent = {
    id: 'b'.repeat(64),
    pubkey: 'a'.repeat(64),
    created_at: fixedNowSeconds - (11 * 60 * 60),
    kind: kinds.ShortTextNote,
    tags: [],
    content: 'Hello, world!',
    sig: 'test-sig',
  };

  beforeEach(async () => {
    vi.spyOn(Date, 'now').mockReturnValue(fixedNowMs);

    mockAccountState = {
      pubkey: signal('other-pubkey'),
      account: signal<{
        pubkey: string;
        source: string;
        hasActivated: boolean;
      } | null>(null),
    };
    mockUtilities = {
      getEventExpiration: vi.fn().mockReturnValue(null),
      getRelativeTime: vi.fn().mockReturnValue('11 hours ago'),
    };

    await TestBed.configureTestingModule({
      imports: [EventHeaderComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideAnimationsAsync(),
        { provide: AccountStateService, useValue: mockAccountState },
        { provide: UtilitiesService, useValue: mockUtilities },
        { provide: LayoutService, useValue: {} },
        { provide: DataService, useValue: { toRecord: vi.fn().mockReturnValue(null) } },
        { provide: NostrService, useValue: {} },
        { provide: EventService, useValue: {} },
        { provide: LoggerService, useValue: { error: vi.fn() } },
        { provide: PowService, useValue: { countLeadingZeroBits: vi.fn().mockReturnValue(0) } },
        { provide: LocalSettingsService, useValue: { showClientTag: signal(false) } },
        { provide: DeleteEventService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: MatSnackBar, useValue: {} },
        {
          provide: UserRelaysService,
          useValue: {
            getRelaysForPubkey: vi.fn().mockReturnValue([]),
            ensureRelaysForPubkey: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    });
    TestBed.overrideComponent(EventHeaderComponent, { set: { template: '' } });
    await TestBed.compileComponents();

    fixture = TestBed.createComponent(EventHeaderComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('event', mockEvent);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should detect own event when pubkeys match', () => {
    mockAccountState.pubkey.set(mockEvent.pubkey);
    expect(component.isOurEvent()).toBe(true);
  });

  it('should not detect own event when pubkeys differ', () => {
    mockAccountState.pubkey.set('other-pubkey');
    expect(component.isOurEvent()).toBe(false);
  });

  it('should generate nevent string', () => {
    const nevent = component.nevent();
    expect(nevent).toBeTruthy();
    expect(typeof nevent).toBe('string');
  });

  it('should generate event URL for short text note', () => {
    const url = component.eventUrl();
    expect(url).toContain('/e/');
  });

  it('should generate event URL for article', () => {
    const articleEvent = { ...mockEvent, kind: 30023 };
    fixture.componentRef.setInput('event', articleEvent);
    fixture.detectChanges();
    const url = component.eventUrl();
    expect(url).toContain('/a/');
  });

  it('should show published age when the event has no expiration', () => {
    expect(component.publishedLabel()).toBe('11 hours ago');
    expect(component.expirationLabel()).toBe('');
  });

  it('should show expiration as a second line when the event has a future expiration', () => {
    const expirationTimestamp = fixedNowSeconds + (3 * 60 * 60);
    mockUtilities.getEventExpiration.mockReturnValue(expirationTimestamp);

    expect(component.publishedLabel()).toBe('11 hours ago');
    expect(component.expirationLabel()).toBe('Expires in 3 hours');
  });
});
