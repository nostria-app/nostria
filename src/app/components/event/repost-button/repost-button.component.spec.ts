import type { Mock } from "vitest";
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { RepostButtonComponent } from './repost-button.component';
import { AccountStateService } from '../../../services/account-state.service';
import { EventService } from '../../../services/event';
import { RepostService } from '../../../services/repost.service';
import { LayoutService } from '../../../services/layout.service';
import type { NostrRecord } from '../../../interfaces';

const mockEvent = {
    id: 'test-event-id',
    pubkey: 'test-pubkey',
    created_at: 1700000000,
    kind: 1,
    tags: [],
    content: 'test content',
    sig: 'test-sig',
};

const mockRepost: NostrRecord = {
    event: {
        id: 'repost-id',
        pubkey: 'current-user-pubkey',
        created_at: 1700000001,
        kind: 6,
        tags: [],
        content: '',
        sig: 'repost-sig',
    },
    data: null,
};

describe('RepostButtonComponent', () => {
    let component: RepostButtonComponent;
    let fixture: ComponentFixture<RepostButtonComponent>;
    let mockAccountState: {
        pubkey: ReturnType<typeof signal<string>>;
        account: ReturnType<typeof signal<{
            pubkey: string;
            source: string;
            hasActivated: boolean;
        } | null>>;
    };
    let mockEventService: {
        loadReposts: Mock;
        createNote: Mock;
    };
    let mockRepostService: {
        repostNote: Mock;
        deleteRepost: Mock;
    };
    let mockLayoutService: {
        showLoginDialog: Mock;
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
            loadReposts: vi.fn().mockReturnValue(Promise.resolve([])),
            createNote: vi.fn().mockReturnValue(Promise.resolve()),
        };

        mockRepostService = {
            repostNote: vi.fn().mockReturnValue(Promise.resolve(true)),
            deleteRepost: vi.fn().mockReturnValue(Promise.resolve(true)),
        };

        mockLayoutService = {
            showLoginDialog: vi.fn().mockReturnValue(Promise.resolve()),
        };

        await TestBed.configureTestingModule({
            imports: [RepostButtonComponent],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                { provide: AccountStateService, useValue: mockAccountState },
                { provide: EventService, useValue: mockEventService },
                { provide: RepostService, useValue: mockRepostService },
                { provide: LayoutService, useValue: mockLayoutService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(RepostButtonComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('event', mockEvent);
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('active class binding', () => {
        it('should not have active class when user has not reposted', () => {
            fixture.detectChanges();
            const button = fixture.nativeElement.querySelector('button');
            expect(button.classList.contains('active')).toBe(false);
        });

        it('should have active class when user has reposted', () => {
            component.reposts.set([mockRepost]);
            fixture.detectChanges();
            const button = fixture.nativeElement.querySelector('button');
            expect(button.classList.contains('active')).toBe(true);
        });

        it('should remove active class when repost is removed', () => {
            component.reposts.set([mockRepost]);
            fixture.detectChanges();
            const button = fixture.nativeElement.querySelector('button');
            expect(button.classList.contains('active')).toBe(true);

            component.reposts.set([]);
            fixture.detectChanges();
            expect(button.classList.contains('active')).toBe(false);
        });
    });

    describe('repostByCurrentAccount', () => {
        it('should return undefined when no reposts exist', () => {
            expect(component.repostByCurrentAccount()).toBeUndefined();
        });

        it('should return the repost by the current user', () => {
            component.reposts.set([mockRepost]);
            expect(component.repostByCurrentAccount()).toBe(mockRepost);
        });

        it('should return undefined when reposts exist but not from the current user', () => {
            const otherRepost: NostrRecord = {
                event: { ...mockRepost.event, pubkey: 'other-pubkey' },
                data: null,
            };
            component.reposts.set([otherRepost]);
            expect(component.repostByCurrentAccount()).toBeUndefined();
        });
    });

    describe('createRepost', () => {
        it('should show login dialog when no user is logged in', async () => {
            mockAccountState.pubkey.set('');
            await component.createRepost();
            expect(mockLayoutService.showLoginDialog).toHaveBeenCalled();
            expect(mockRepostService.repostNote).not.toHaveBeenCalled();
        });

        it('should show login dialog for preview accounts', async () => {
            mockAccountState.account.set({
                pubkey: 'current-user-pubkey',
                source: 'preview',
                hasActivated: true,
            });
            await component.createRepost();
            expect(mockLayoutService.showLoginDialog).toHaveBeenCalled();
            expect(mockRepostService.repostNote).not.toHaveBeenCalled();
        });

        it('should call repostNote and reload reposts for authenticated users', async () => {
            await component.createRepost();
            expect(mockRepostService.repostNote).toHaveBeenCalledWith(mockEvent);
            expect(mockEventService.loadReposts).toHaveBeenCalledWith(mockEvent.id, mockEvent.kind, 'current-user-pubkey', true);
        });
    });

    describe('deleteRepost', () => {
        it('should show login dialog when no user is logged in', async () => {
            mockAccountState.pubkey.set('');
            await component.deleteRepost();
            expect(mockLayoutService.showLoginDialog).toHaveBeenCalled();
            expect(mockRepostService.deleteRepost).not.toHaveBeenCalled();
        });

        it('should do nothing if no repost by current user exists', async () => {
            await component.deleteRepost();
            expect(mockRepostService.deleteRepost).not.toHaveBeenCalled();
        });

        it('should call deleteRepost when user has a repost', async () => {
            component.reposts.set([mockRepost]);
            await component.deleteRepost();
            expect(mockRepostService.deleteRepost).toHaveBeenCalledWith(mockRepost.event);
            expect(mockEventService.loadReposts).toHaveBeenCalledWith(mockEvent.id, mockEvent.kind, 'current-user-pubkey', true);
        });
    });

    describe('createQuote', () => {
        it('should show login dialog when no user is logged in', async () => {
            mockAccountState.pubkey.set('');
            await component.createQuote();
            expect(mockLayoutService.showLoginDialog).toHaveBeenCalled();
            expect(mockEventService.createNote).not.toHaveBeenCalled();
        });

        it('should call createNote with quote data for authenticated users', async () => {
            await component.createQuote();
            expect(mockEventService.createNote).toHaveBeenCalledWith({
                quote: {
                    id: mockEvent.id,
                    pubkey: mockEvent.pubkey,
                    kind: mockEvent.kind,
                },
            });
        });
    });

    describe('loading state', () => {
        it('should disable button while loading reposts', () => {
            component.isLoadingReposts.set(true);
            fixture.detectChanges();
            const button = fixture.nativeElement.querySelector('button');
            expect(button.disabled).toBe(true);
        });

        it('should enable button when not loading', () => {
            component.isLoadingReposts.set(false);
            fixture.detectChanges();
            const button = fixture.nativeElement.querySelector('button');
            expect(button.disabled).toBe(false);
        });
    });

    describe('repostsFromParent', () => {
        it('should use parent reposts when provided', async () => {
            fixture.componentRef.setInput('repostsFromParent', [mockRepost]);
            fixture.detectChanges();
            await fixture.whenStable();
            expect(component.reposts()).toEqual([mockRepost]);
        });
    });
});
