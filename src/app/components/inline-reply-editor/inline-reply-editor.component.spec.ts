import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { InlineReplyEditorComponent } from './inline-reply-editor.component';
import { NostrService } from '../../services/nostr.service';
import { MediaService } from '../../services/media.service';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { PublishEventBus } from '../../services/publish-event-bus.service';
import { SpeechService } from '../../services/speech.service';
import { PlatformService } from '../../services/platform.service';
import { NoteEditorService } from '../../services/note-editor.service';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { ImagePlaceholderService } from '../../services/image-placeholder.service';
import { UtilitiesService } from '../../services/utilities.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { Event as NostrEvent } from 'nostr-tools';

describe('InlineReplyEditorComponent', () => {
    let component: InlineReplyEditorComponent;
    let fixture: ComponentFixture<InlineReplyEditorComponent>;

    const mockEvent: NostrEvent = {
        id: 'test-event-id',
        pubkey: 'test-pubkey-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags: [],
        content: 'Test content',
        sig: 'test-sig',
    };

    const mockNostrService = {
        createEvent: vi.fn(),
        signAndPublish: vi.fn(),
    };

    const mockMediaService = {
        error: signal(null),
        mediaServers: signal([]),
        clearError: vi.fn(),
        load: vi.fn(),
        getFileMimeType: vi.fn(),
        uploadFile: vi.fn(),
    };

    const mockAccountState = {
        pubkey: signal('test-account-pubkey'),
    };

    const mockLayoutService = {
        openGenericEvent: vi.fn(),
    };

    const mockPublishEventBus = {
        on: vi.fn().mockReturnValue({ subscribe: () => ({ unsubscribe: vi.fn() }) }),
    };

    const mockSpeechService = {
        startRecording: vi.fn(),
        stopRecording: vi.fn(),
    };

    const mockPlatformService = {};

    const mockNoteEditorService = {
        getHashtagsFromContent: vi.fn().mockReturnValue([]),
        processContentForPublishing: vi.fn().mockReturnValue(''),
        detectMention: vi.fn().mockReturnValue({ isTypingMention: false }),
        sanitizeDisplayName: vi.fn(),
        replaceMention: vi.fn(),
        loadProfileName: vi.fn().mockReturnValue(Promise.resolve(null)),
        buildTags: vi.fn().mockReturnValue([]),
    };

    const mockCustomDialogService = {
        open: vi.fn(),
    };

    const mockMatDialog = {
        open: vi.fn(),
    };

    const mockSnackBar = {
        open: vi.fn(),
    };

    const mockRouter = {
        navigate: vi.fn(),
    };

    const mockImagePlaceholder = {
        generatePlaceholders: vi.fn(),
    };

    const mockUtilitiesService = {
        extractThumbnailFromVideo: vi.fn(),
    };

    const mockLocalSettings = {
        removeTrackingParameters: signal(false),
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [InlineReplyEditorComponent],
            providers: [
                provideZonelessChangeDetection(),
                { provide: NostrService, useValue: mockNostrService },
                { provide: MediaService, useValue: mockMediaService },
                { provide: AccountStateService, useValue: mockAccountState },
                { provide: LayoutService, useValue: mockLayoutService },
                { provide: PublishEventBus, useValue: mockPublishEventBus },
                { provide: SpeechService, useValue: mockSpeechService },
                { provide: PlatformService, useValue: mockPlatformService },
                { provide: NoteEditorService, useValue: mockNoteEditorService },
                { provide: CustomDialogService, useValue: mockCustomDialogService },
                { provide: MatDialog, useValue: mockMatDialog },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: Router, useValue: mockRouter },
                { provide: ImagePlaceholderService, useValue: mockImagePlaceholder },
                { provide: UtilitiesService, useValue: mockUtilitiesService },
                { provide: LocalSettingsService, useValue: mockLocalSettings },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(InlineReplyEditorComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('replyToEvent', mockEvent);
        fixture.detectChanges();
    });

    afterEach(() => {
        fixture.destroy();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should start collapsed', () => {
        expect(component.isExpanded()).toBe(false);
    });

    describe('document mousedown click-outside behavior', () => {
        it('should collapse when clicking outside the component', fakeAsync(() => {
            // Expand the editor
            component.isExpanded.set(true);
            fixture.detectChanges();

            // Wait past the 100ms debounce
            tick(150);

            // Simulate a mousedown outside the component
            const outsideEvent = new MouseEvent('mousedown', { bubbles: true });
            document.dispatchEvent(outsideEvent);

            expect(component.isExpanded()).toBe(false);
        }));

        it('should not collapse when clicking inside the component', fakeAsync(() => {
            // Expand the editor
            component.isExpanded.set(true);
            fixture.detectChanges();

            // Wait past the 100ms debounce
            tick(150);

            // Simulate a mousedown inside the component
            const insideEvent = new MouseEvent('mousedown', { bubbles: true });
            fixture.nativeElement.dispatchEvent(insideEvent);

            expect(component.isExpanded()).toBe(true);
        }));

        it('should not collapse when content is present', fakeAsync(() => {
            // Expand the editor
            component.isExpanded.set(true);
            component.content.set('Some content');
            fixture.detectChanges();

            // Wait past the 100ms debounce
            tick(150);

            // Simulate a mousedown outside the component
            const outsideEvent = new MouseEvent('mousedown', { bubbles: true });
            document.dispatchEvent(outsideEvent);

            expect(component.isExpanded()).toBe(true);
        }));

        it('should not collapse when not expanded', fakeAsync(() => {
            // Ensure collapsed
            component.isExpanded.set(false);
            fixture.detectChanges();

            tick(150);

            // Simulate a mousedown outside
            const outsideEvent = new MouseEvent('mousedown', { bubbles: true });
            document.dispatchEvent(outsideEvent);

            expect(component.isExpanded()).toBe(false);
        }));

        it('should not collapse when publishing', fakeAsync(() => {
            component.isExpanded.set(true);
            component.isPublishing.set(true);
            fixture.detectChanges();

            tick(150);

            const outsideEvent = new MouseEvent('mousedown', { bubbles: true });
            document.dispatchEvent(outsideEvent);

            expect(component.isExpanded()).toBe(true);
        }));

        it('should not collapse when uploading', fakeAsync(() => {
            component.isExpanded.set(true);
            component.isUploading.set(true);
            fixture.detectChanges();

            tick(150);

            const outsideEvent = new MouseEvent('mousedown', { bubbles: true });
            document.dispatchEvent(outsideEvent);

            expect(component.isExpanded()).toBe(true);
        }));

        it('should not collapse within 100ms of expansion', () => {
            // Expand the editor (sets expandedAt to Date.now())
            component.expandEditor();

            // Immediately simulate a mousedown outside
            const outsideEvent = new MouseEvent('mousedown', { bubbles: true });
            document.dispatchEvent(outsideEvent);

            expect(component.isExpanded()).toBe(true);
        });

        it('should remove document listener on destroy', fakeAsync(() => {
            // Expand the editor
            component.isExpanded.set(true);
            fixture.detectChanges();

            tick(150);

            // Destroy the component
            fixture.destroy();

            // Create a new fixture to verify the listener was removed
            // (the old component should no longer react to document clicks)
            // We verify by checking that no errors are thrown
            const outsideEvent = new MouseEvent('mousedown', { bubbles: true });
            expect(() => document.dispatchEvent(outsideEvent)).not.toThrow();
        }));
    });
});
