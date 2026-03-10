import type { Mock } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { EventHeaderComponent } from './header.component';
import { AccountStateService } from '../../../services/account-state.service';
import { UtilitiesService } from '../../../services/utilities.service';
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
    id: 'test-event-id',
    pubkey: 'test-pubkey',
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
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventHeaderComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('event', mockEvent);
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should detect own event when pubkeys match', () => {
    mockAccountState.pubkey.set('test-pubkey');
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
    fixture.detectChanges();

    const dateLink = fixture.nativeElement.querySelector('.date-link') as HTMLAnchorElement;

    expect(dateLink.textContent?.trim()).toBe('11 hours ago');
    expect(fixture.nativeElement.querySelector('.expiration-label')).toBeNull();
  });

  it('should show expiration as a second line when the event has a future expiration', () => {
    const expirationTimestamp = fixedNowSeconds + (3 * 60 * 60);
    mockUtilities.getEventExpiration.mockReturnValue(expirationTimestamp);

    fixture.detectChanges();

    const dateLink = fixture.nativeElement.querySelector('.date-link') as HTMLAnchorElement;
    const expirationLabel = fixture.nativeElement.querySelector('.expiration-label') as HTMLElement;

    expect(dateLink.textContent?.trim()).toBe('11 hours ago');
    expect(expirationLabel.textContent?.trim()).toBe('Expires in 3 hours');
  });
});
