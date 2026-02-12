import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { EventHeaderComponent } from './header.component';
import { AccountStateService } from '../../../services/account-state.service';
import { kinds } from 'nostr-tools';

describe('EventHeaderComponent', () => {
  let component: EventHeaderComponent;
  let fixture: ComponentFixture<EventHeaderComponent>;
  let mockAccountState: {
    pubkey: ReturnType<typeof signal<string>>;
    account: ReturnType<typeof signal<{ pubkey: string; source: string; hasActivated: boolean } | null>>;
  };

  const mockEvent = {
    id: 'test-event-id',
    pubkey: 'test-pubkey',
    created_at: Math.floor(Date.now() / 1000),
    kind: kinds.ShortTextNote,
    tags: [],
    content: 'Hello, world!',
    sig: 'test-sig',
  };

  beforeEach(async () => {
    mockAccountState = {
      pubkey: signal('other-pubkey'),
      account: signal<{ pubkey: string; source: string; hasActivated: boolean } | null>(null),
    };

    await TestBed.configureTestingModule({
      imports: [EventHeaderComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideAnimationsAsync(),
        { provide: AccountStateService, useValue: mockAccountState },
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
    expect(component.isOurEvent()).toBeTrue();
  });

  it('should not detect own event when pubkeys differ', () => {
    mockAccountState.pubkey.set('other-pubkey');
    expect(component.isOurEvent()).toBeFalse();
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
});
