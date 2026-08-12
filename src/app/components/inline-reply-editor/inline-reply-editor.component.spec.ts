import { ComponentFixture, TestBed } from '@angular/core/testing';
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
import { EventService } from '../../services/event';
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
        isHandset: signal(false),
        keyboardMobileNavHidden: signal(false),
        hideMobileNav: signal(false),
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

    const mockEventService = {
        buildCommentEvent: vi.fn(),
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
                { provide: EventService, useValue: mockEventService },
                { provide: CustomDialogService, useValue: mockCustomDialogService },
                { provide: MatDialog, useValue: mockMatDialog },
                { provide: MatSnackBar, useValue: mockSnackBar },
                { provide: Router, useValue: mockRouter },
                { provide: ImagePlaceholderService, useValue: mockImagePlaceholder },
                { provide: UtilitiesService, useValue: mockUtilitiesService },
                { provide: LocalSettingsService, useValue: mockLocalSettings },
            ],
        });
        TestBed.overrideComponent(InlineReplyEditorComponent, { set: { template: '' } });
        await TestBed.compileComponents();

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
});
