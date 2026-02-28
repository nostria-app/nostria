import type { Mock } from "vitest";
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { ReplyButtonComponent } from './reply-button.component';
import { AccountStateService } from '../../../services/account-state.service';
import { EventService } from '../../../services/event';
import { LayoutService } from '../../../services/layout.service';
import { kinds } from 'nostr-tools';

describe('ReplyButtonComponent', () => {
    let component: ReplyButtonComponent;
    let fixture: ComponentFixture<ReplyButtonComponent>;
    let mockAccountState: {
        pubkey: ReturnType<typeof signal<string>>;
        account: ReturnType<typeof signal<{
            pubkey: string;
            source: string;
            hasActivated: boolean;
        } | null>>;
    };
    let mockEventService: {
        getEventTags: Mock;
        createNote: Mock;
        createComment: Mock;
    };
    let mockLayoutService: {
        showLoginDialog: Mock;
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
            pubkey: signal('current-user-pubkey'),
            account: signal<{
                pubkey: string;
                source: string;
                hasActivated: boolean;
            } | null>({
                pubkey: 'current-user-pubkey',
                source: 'nsec',
                hasActivated: true,
            }),
        };

        mockEventService = {
            getEventTags: vi.fn().mockReturnValue({ rootId: null }),
            createNote: vi.fn(),
            createComment: vi.fn(),
        };

        mockLayoutService = {
            showLoginDialog: vi.fn().mockReturnValue(Promise.resolve()),
        };

        await TestBed.configureTestingModule({
            imports: [ReplyButtonComponent],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                { provide: AccountStateService, useValue: mockAccountState },
                { provide: EventService, useValue: mockEventService },
                { provide: LayoutService, useValue: mockLayoutService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ReplyButtonComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('event', mockEvent);
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should detect reply for short text notes', () => {
        expect(component.isReply()).toBe(true);
    });

    it('should not detect reply for non-short-text-note kinds', () => {
        const articleEvent = { ...mockEvent, kind: 30023 };
        fixture.componentRef.setInput('event', articleEvent);
        fixture.detectChanges();
        expect(component.isReply()).toBe(false);
    });

    it('should show login dialog when no user is logged in', async () => {
        mockAccountState.pubkey.set('');
        await component.onClick();
        expect(mockLayoutService.showLoginDialog).toHaveBeenCalled();
        expect(mockEventService.createNote).not.toHaveBeenCalled();
    });

    it('should show login dialog for preview accounts', async () => {
        mockAccountState.account.set({
            pubkey: 'current-user-pubkey',
            source: 'preview',
            hasActivated: true,
        });
        await component.onClick();
        expect(mockLayoutService.showLoginDialog).toHaveBeenCalled();
        expect(mockEventService.createNote).not.toHaveBeenCalled();
    });

    it('should create a reply note for short text notes', async () => {
        await component.onClick();
        expect(mockEventService.createNote).toHaveBeenCalledWith({
            replyTo: {
                id: mockEvent.id,
                pubkey: mockEvent.pubkey,
                rootId: null,
                event: mockEvent,
            },
        });
    });

    it('should create a comment for non-short-text-note kinds', async () => {
        const articleEvent = { ...mockEvent, kind: 30023 };
        fixture.componentRef.setInput('event', articleEvent);
        fixture.detectChanges();
        await component.onClick();
        expect(mockEventService.createComment).toHaveBeenCalledWith(articleEvent);
    });
});
