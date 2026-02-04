import {
  Component,
  inject,
  signal,
  computed,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  OnInit,
  HostListener,
  input,
  output,
  ChangeDetectionStrategy,
  effect,
} from '@angular/core';
import { CustomDialogRef, CustomDialogService } from '../../services/custom-dialog.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, provideNativeDateAdapter } from '@angular/material/core';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { DomSanitizer } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';

import { NostrService } from '../../services/nostr.service';
import { MediaService } from '../../services/media.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { AccountStateService } from '../../services/account-state.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { ContentComponent } from '../content/content.component';
import { Router } from '@angular/router';
import { nip19, Event as NostrEvent, UnsignedEvent } from 'nostr-tools';
import { LayoutService } from '../../services/layout.service';
import { getEventHash } from 'nostr-tools/pure';
import { AccountRelayService } from '../../services/relays/account-relay';
import { PowService, PowProgress } from '../../services/pow.service';
import { MentionAutocompleteComponent, MentionSelection, MentionAutocompleteConfig } from '../mention-autocomplete/mention-autocomplete.component';
import { MentionInputService, MentionDetectionResult } from '../../services/mention-input.service';
import { UtilitiesService } from '../../services/utilities.service';
import { PublishEventBus, PublishRelayResultEvent } from '../../services/publish-event-bus.service';
import { Subscription } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { AiToolsDialogComponent } from '../ai-tools-dialog/ai-tools-dialog.component';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { MatMenuModule } from '@angular/material/menu';
import { AiService } from '../../services/ai.service';
import { cleanTrackingParametersFromText } from '../../utils/url-cleaner';
import { DataService } from '../../services/data.service';
import { ImagePlaceholderService } from '../../services/image-placeholder.service';
import { NoteEditorDialogData } from '../../interfaces/note-editor';
import { SpeechService } from '../../services/speech.service';
import { PlatformService } from '../../services/platform.service';
import { UserProfileComponent } from '../user-profile/user-profile.component';

// Re-export for backward compatibility
export type { NoteEditorDialogData } from '../../interfaces/note-editor';

interface MediaMetadata {
  url: string;
  mimeType?: string;
  blurhash?: string;
  thumbhash?: string;
  dimensions?: { width: number; height: number };
  alt?: string;
  sha256?: string; // Optional hash as per NIP-94
  image?: string; // Preview image URL (screen capture for videos)
  imageMirrors?: string[]; // Mirror URLs for the preview image
  fallbackUrls?: string[]; // Fallback URLs for the main media file
  thumbnailBlob?: Blob; // Thumbnail blob to be uploaded (temporary, before upload)
}

interface NoteAutoDraft {
  content: string;
  mentions: string[];
  mentionMap?: [string, string][];
  pubkeyToNameMap?: [string, string][];
  showPreview: boolean;
  showAdvancedOptions: boolean;
  expirationEnabled: boolean;
  expirationDate: Date | null;
  expirationTime: string;
  uploadOriginal: boolean;
  addClientTag: boolean;
  lastModified: number;
  // Context data to ensure draft matches current dialog state
  replyToId?: string;
  quoteId?: string;
  // Media Mode
  mediaMetadata?: MediaMetadata[];
  isMediaMode?: boolean;
  title?: string;
}

@Component({
  selector: 'app-note-editor-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatSliderModule,
    ContentComponent,
    MentionAutocompleteComponent,
    MatMenuModule,
    DragDropModule,
    UserProfileComponent,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './note-editor-dialog.component.html',
  styleUrl: './note-editor-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onHostKeyDown($event)',
    '[class.inline-mode]': 'inlineMode()',
    '[class.collapsed]': 'inlineMode() && !isExpanded()',
  },
})
export class NoteEditorDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  // Inline mode inputs/outputs
  /** When true, renders in inline mode (embedded in page) instead of dialog mode */
  inlineMode = input(false);

  /** For inline mode: the event being replied to */
  replyToEvent = input<NostrEvent | null>(null);

  /** Emitted when a reply is successfully published (inline mode) */
  replyPublished = output<NostrEvent>();

  /** Emitted when the editor is cancelled/dismissed (inline mode) */
  cancelled = output<void>();

  // Inline mode state
  isExpanded = signal(false);
  private elementRef = inject(ElementRef);

  dialogRef?: CustomDialogRef<NoteEditorDialogComponent, { published: boolean; event?: NostrEvent }>;
  data: NoteEditorDialogData = {};
  private nostrService = inject(NostrService);
  private accountRelay = inject(AccountRelayService);
  mediaService = inject(MediaService);
  private localStorage = inject(LocalStorageService);
  private localSettings = inject(LocalSettingsService);
  private accountState = inject(AccountStateService);
  private accountLocalState = inject(AccountLocalStateService);
  private snackBar = inject(MatSnackBar);
  private sanitizer = inject(DomSanitizer);
  private router = inject(Router);
  private layout = inject(LayoutService);
  private powService = inject(PowService);
  private mentionInputService = inject(MentionInputService);
  private dataService = inject(DataService);
  private utilities = inject(UtilitiesService);
  private imagePlaceholder = inject(ImagePlaceholderService);
  private publishEventBus = inject(PublishEventBus);
  private publishSubscription?: Subscription;
  private dialog = inject(MatDialog);
  private customDialog = inject(CustomDialogService);
  private aiService = inject(AiService);
  private speechService = inject(SpeechService);
  private platformService = inject(PlatformService);

  @ViewChild('contentTextarea')
  contentTextarea!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild(MentionAutocompleteComponent) mentionAutocomplete?: MentionAutocompleteComponent;

  // Auto-save configuration
  private readonly AUTO_SAVE_INTERVAL = 2000; // Save every 2 seconds
  private autoSaveTimer?: ReturnType<typeof setTimeout>;
  private contentCheckIntervalHandle?: ReturnType<typeof setInterval>;
  private otherChangesIntervalHandle?: ReturnType<typeof setInterval>;

  // Signals for reactive state
  content = signal('');
  mentions = signal<string[]>([]);

  // Maps for mention handling
  private mentionMap = new Map<string, string>(); // @name -> nostr:uri
  private pubkeyToNameMap = new Map<string, string>(); // pubkey -> name

  showPreview = signal(false);
  showAdvancedOptions = signal(false);
  isDragOver = signal(false);
  isUploading = signal(false);
  uploadStatus = signal(''); // Detailed upload status message
  dragCounter = 0;
  isPublishing = signal(false);
  isRecording = signal(false);
  isTranscribing = signal(false);

  // Recording history for undo
  recordingHistory: string[] = [];

  // Computed hashtags from content
  hashtags = computed(() => {
    const content = this.content();
    const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
    const hashtagSet = new Set<string>();

    let match;
    while ((match = hashtagRegex.exec(content)) !== null) {
      hashtagSet.add(match[1].toLowerCase());
    }

    return Array.from(hashtagSet);
  });

  // Guard against double-click publishing
  private publishInitiated = signal(false);

  // Media metadata for imeta tags (NIP-92)
  mediaMetadata = signal<MediaMetadata[]>([]);

  // Media Mode
  title = signal('');
  isMediaMode = signal(false);
  // Media mode is only available for original posts (not replies) when media is attached
  isMediaModeAvailable = computed(() => this.mediaMetadata().length > 0 && !this.isReply());
  isMediaModeEnabled = computed(() => this.isMediaModeAvailable() && this.isMediaMode());

  // Mention autocomplete state
  mentionConfig = signal<MentionAutocompleteConfig | null>(null);
  mentionPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  mentionDetection = signal<MentionDetectionResult | null>(null);

  // Advanced options
  expirationEnabled = signal(false);
  expirationDate = signal<Date | null>(null);
  expirationTime = signal<string>('12:00');
  uploadOriginal = signal(false);
  addClientTag = signal(true); // Default to true, will be set from user preference in constructor

  // Proof of Work options
  powEnabled = signal(false);
  powTargetDifficulty = signal(20); // Default target difficulty
  powProgress = signal<PowProgress>({
    difficulty: 0,
    nonce: 0,
    attempts: 0,
    isRunning: false,
    bestEvent: null,
  });
  powMinedEvent = signal<UnsignedEvent | null>(null);

  // Zap split options (NIP-57 Appendix G)
  zapSplitEnabled = signal(false);
  zapSplitOriginalPercent = signal(90); // Default 90% to original author
  zapSplitQuoterPercent = signal(10); // Default 10% to quoter

  // Debug options
  showEventJson = signal(false);

  // Track initial state for dirty detection
  private initialContent = '';
  private initialMentions: string[] = [];
  private initialMediaMetadata: MediaMetadata[] = [];
  private initialTitle = '';

  // Computed properties
  characterCount = computed(() => this.processContentForPublishing(this.content()).length);

  // Current account pubkey for display
  currentAccountPubkey = computed(() => this.accountState.pubkey());

  // Current account profile for display
  currentAccountProfile = computed(() => {
    const pubkey = this.currentAccountPubkey();
    if (!pubkey) return null;
    return this.accountState.profile();
  });

  // Display name for current account
  currentAccountDisplayName = computed(() => {
    const profile = this.currentAccountProfile();
    const pubkey = this.currentAccountPubkey();

    if (profile?.data?.display_name) {
      return profile.data.display_name;
    } else if (profile?.data?.name) {
      return profile.data.name;
    } else if (pubkey) {
      const npub = nip19.npubEncode(pubkey);
      return `${npub.substring(0, 8)}...${npub.substring(npub.length - 4)}`;
    }
    return 'Unknown';
  });

  // Avatar URL for current account
  currentAccountAvatar = computed(() => {
    const profile = this.currentAccountProfile();
    return profile?.data?.picture || null;
  });

  // Check if user is logged in
  isLoggedIn = computed(() => !!this.currentAccountPubkey());

  // charactersRemaining = computed(() => 280 - this.characterCount());
  // isOverLimit = computed(() => this.characterCount() > 280);
  canPublish = computed(() => {
    const hasContent = this.content().trim().length > 0;
    const notPublishing = !this.isPublishing();
    const notUploading = !this.isUploading();

    // Check expiration validation
    let expirationValid = true;
    if (this.expirationEnabled()) {
      const expirationDateTime = this.getExpirationDateTime();
      expirationValid = expirationDateTime !== null && expirationDateTime > new Date();
    }

    return hasContent && notPublishing && notUploading && expirationValid;
  });

  // Validation for expiration
  expirationValidation = computed(() => {
    if (!this.expirationEnabled()) return { valid: true, message: '' };

    const expirationDateTime = this.getExpirationDateTime();
    if (!expirationDateTime) {
      return { valid: false, message: 'Please select both date and time' };
    }

    if (expirationDateTime <= new Date()) {
      return { valid: false, message: 'Expiration must be in the future' };
    }

    return { valid: true, message: '' };
  });

  // Preview content with URL parsing and formatting
  previewContent = computed((): string => {
    if (!this.showPreview()) return '';

    const content = this.content();

    if (this.isMediaMode()) {
      // In Media Mode, content (description) is used as is (URLs already removed from text area)
      // But we need to simulate the Kind 1 wrapper
      // The wrapper has: content + "\n\nnostr:" + nevent

      const mediaEvent = this.previewMediaEvent();
      if (mediaEvent) {
        const nevent = nip19.neventEncode({
          id: mediaEvent.id,
          author: mediaEvent.pubkey,
          kind: mediaEvent.kind,
        });
        return this.processContentForPublishing(content) + '\n\nnostr:' + nevent;
      }

      return this.processContentForPublishing(content) + '\n\n[Media Story will be attached here]';
    }

    if (!content.trim()) return 'Nothing to preview...';

    return this.processContentForPublishing(content);
  });

  // Computed property for the unsigned media event for preview
  previewMediaEvent = computed((): NostrEvent | null => {
    if (!this.isMediaMode() || this.mediaMetadata().length === 0) return null;

    // 1. Determine Kind
    const kind = this.getMediaEventKind();

    // 2. Prepare Content (remove URLs)
    let content = this.content();
    this.mediaMetadata().forEach(m => {
      const escapedUrl = m.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedUrl, 'g');
      content = content.replace(regex, '').trim();
    });
    content = this.processContentForPublishing(content);

    // 3. Build Media Event Tags
    const mediaTags: string[][] = [];
    // Title
    if (this.title()) {
      mediaTags.push(['title', this.title()]);
    }
    // Imeta
    this.mediaMetadata().forEach(metadata => {
      const imetaTag = this.buildImetaTag(metadata);
      if (imetaTag) {
        mediaTags.push(imetaTag);
      }
    });
    // Hashtags
    this.extractHashtags(content, mediaTags);
    // Mentions
    this.mentions().forEach(pubkey => {
      mediaTags.push(['p', pubkey]);
    });
    // Client
    if (this.addClientTag()) {
      mediaTags.push(['client', 'nostria']);
    }
    // Alt tag
    mediaTags.push(['alt', `Media post: ${this.title() || 'Untitled'}`]);

    // 4. Create Unsigned Media Event
    const pubkey = this.accountState.pubkey() || '';
    const created_at = Math.floor(Date.now() / 1000);

    const unsignedEvent: UnsignedEvent = {
      kind,
      content,
      tags: mediaTags,
      pubkey,
      created_at,
    };

    // 5. Calculate ID
    const id = getEventHash(unsignedEvent);

    return {
      ...unsignedEvent,
      id,
      sig: '', // No signature for preview
    };
  });

  // Map of preloaded events for preview
  previewEventsMap = computed(() => {
    const map = new Map<string, NostrEvent>();
    const mediaEvent = this.previewMediaEvent();
    if (mediaEvent) {
      map.set(mediaEvent.id, mediaEvent);
    }
    return map;
  });

  drop(event: CdkDragDrop<MediaMetadata[]>) {
    const currentMetadata = [...this.mediaMetadata()];
    moveItemInArray(currentMetadata, event.previousIndex, event.currentIndex);
    this.mediaMetadata.set(currentMetadata);
  }

  removeMedia(index: number): void {
    const currentMetadata = [...this.mediaMetadata()];
    const removedMedia = currentMetadata[index];
    currentMetadata.splice(index, 1);
    this.mediaMetadata.set(currentMetadata);

    // Remove the media URL from content if present
    if (removedMedia?.url) {
      let currentContent = this.content();
      const escapedUrl = removedMedia.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Remove the URL (with optional surrounding whitespace/newlines)
      currentContent = currentContent.replace(new RegExp('\\s*' + escapedUrl + '\\s*', 'g'), ' ');
      // Clean up extra whitespace
      currentContent = currentContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();

      this.content.set(currentContent);

      // Update textarea
      if (this.contentTextarea) {
        this.contentTextarea.nativeElement.value = currentContent;
      }
    }

    // If no more media, disable media mode
    if (currentMetadata.length === 0) {
      this.isMediaMode.set(false);
    }

    // Save draft immediately after media removal
    this.saveAutoDraft();
  }

  // Dialog mode indicators
  isReply = computed(() => !!this.data?.replyTo);
  isQuote = computed(() => !!this.data?.quote);

  // Check if a mention is the reply target (cannot be removed)
  isReplyTargetMention(pubkey: string): boolean {
    return this.isReply() && this.data?.replyTo?.pubkey === pubkey;
  }

  // Check if zap split is available (requires quote and logged in user)
  zapSplitAvailable = computed(() => this.isQuote() && !!this.currentAccountPubkey());

  // Date constraints
  minDate = computed(() => new Date());

  // PoW computed properties
  isPowMining = computed(() => this.powProgress().isRunning);
  hasPowResult = computed(() => this.powMinedEvent() !== null);
  powDifficulty = computed(() => this.powProgress().difficulty);
  powAttempts = computed(() => this.powProgress().attempts);
  powProgressPercentage = computed(() => {
    const target = this.powTargetDifficulty();
    const current = this.powProgress().difficulty;
    if (target === 0) return 0;
    return Math.min((current / target) * 100, 100);
  });

  // Check if draft has any changes from initial state
  isDirty = computed(() => {
    const hasContentChange = this.content().trim() !== this.initialContent.trim();
    const hasMentionsChange = JSON.stringify(this.mentions()) !== JSON.stringify(this.initialMentions);
    const hasMediaChange = JSON.stringify(this.mediaMetadata()) !== JSON.stringify(this.initialMediaMetadata);
    const hasTitleChange = this.title().trim() !== this.initialTitle.trim();
    return hasContentChange || hasMentionsChange || hasMediaChange || hasTitleChange;
  });

  // Preview of the event JSON for debugging
  previewEventJson = computed(() => {
    const pubkey = this.accountState.pubkey() || '';
    const created_at = Math.floor(Date.now() / 1000);

    // For media mode, show both the media event and the kind 1 wrapper
    if (this.isMediaModeEnabled()) {
      const mediaEvent = this.previewMediaEvent();
      if (mediaEvent) {
        // Build the kind 1 wrapper event
        const nevent = `nevent1... (will be generated from signed media event)`;
        const kind1Content = `${mediaEvent.content}\n\nnostr:${nevent}`;

        // Kind 1 tags (without imeta)
        const kind1Tags = this.buildTags();
        const filteredKind1Tags = kind1Tags.filter(t => t[0] !== 'imeta');
        filteredKind1Tags.push(['q', '<media_event_id>', '', pubkey]);

        const kind1Event = {
          kind: 1,
          content: kind1Content,
          tags: filteredKind1Tags,
          pubkey,
          created_at,
        };

        return JSON.stringify({
          mediaEvent: {
            kind: mediaEvent.kind,
            content: mediaEvent.content,
            tags: mediaEvent.tags,
            pubkey: mediaEvent.pubkey,
            created_at: mediaEvent.created_at,
          },
          kind1WrapperEvent: kind1Event,
        }, null, 2);
      }
    }

    // Standard kind 1 event
    const content = this.processContentForPublishing(this.content().trim());
    const tags = this.buildTags();

    const unsignedEvent = {
      kind: 1,
      content,
      tags,
      pubkey,
      created_at,
    };

    return JSON.stringify(unsignedEvent, null, 2);
  });

  ngAfterViewInit() {
    // Reset drag counter when component initializes
    this.dragCounter = 0;
    this.isDragOver.set(false);

    // Add paste event listener for clipboard image handling
    this.setupPasteHandler();

    // Auto-focus the textarea (only in dialog mode)
    if (!this.inlineMode()) {
      setTimeout(() => {
        if (this.contentTextarea) {
          this.contentTextarea.nativeElement.focus();
          // Initial auto-resize for any pre-filled content
          this.autoResizeTextarea(this.contentTextarea.nativeElement);
        }
      }, 100);
    }
  }

  // ===============================
  // Inline Mode Methods
  // ===============================

  /**
   * Expand the inline editor (inline mode only)
   */
  expandEditor(): void {
    if (!this.isLoggedIn()) {
      this.snackBar.open('Please log in to reply', 'Close', { duration: 3000 });
      return;
    }
    this.isExpanded.set(true);
    setTimeout(() => {
      this.contentTextarea?.nativeElement?.focus();
    }, 50);
  }

  /**
   * Collapse the inline editor if content is empty (inline mode only)
   */
  collapseEditor(): void {
    if (!this.content().trim() && !this.isPublishing() && !this.isUploading()) {
      this.isExpanded.set(false);
    }
  }

  /**
   * Handle clicks outside the component to collapse editor (inline mode only)
   */
  @HostListener('document:mousedown', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    // Only apply in inline mode when expanded
    if (!this.inlineMode() || !this.isExpanded()) return;

    // Don't collapse if busy or has content
    if (this.isPublishing() || this.isUploading() || this.content().trim()) return;

    const clickedInside = this.elementRef.nativeElement.contains(event.target);
    // Also check if clicking on mention autocomplete (which may be outside component)
    const mentionAutocomplete = document.querySelector('app-mention-autocomplete');
    const clickedOnMentionAutocomplete = mentionAutocomplete?.contains(event.target as Node);

    if (!clickedInside && !clickedOnMentionAutocomplete) {
      this.isExpanded.set(false);
    }
  }

  ngOnDestroy() {
    // Clear auto-save timer on destroy
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    // Clean up auto-save intervals
    if (this.contentCheckIntervalHandle) {
      clearInterval(this.contentCheckIntervalHandle);
    }
    if (this.otherChangesIntervalHandle) {
      clearInterval(this.otherChangesIntervalHandle);
    }

    // Clean up publish subscription
    if (this.publishSubscription) {
      this.publishSubscription.unsubscribe();
    }
  }

  constructor() {
    // Set default value for addClientTag from user's local settings
    this.addClientTag.set(this.localSettings.addClientTag());

    // Load PoW settings from account state
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      const powEnabled = this.accountLocalState.getPowEnabled(pubkey);
      const powDifficulty = this.accountLocalState.getPowTargetDifficulty(pubkey);
      this.powEnabled.set(powEnabled);
      this.powTargetDifficulty.set(powEnabled ? powDifficulty : 0);

      // Load zap split settings from account state
      const zapSplitEnabled = this.accountLocalState.getZapSplitEnabled(pubkey);
      const zapSplitOriginalPercent = this.accountLocalState.getZapSplitOriginalPercent(pubkey);
      const zapSplitQuoterPercent = this.accountLocalState.getZapSplitQuoterPercent(pubkey);
      this.zapSplitEnabled.set(zapSplitEnabled);
      this.zapSplitOriginalPercent.set(zapSplitOriginalPercent);
      this.zapSplitQuoterPercent.set(zapSplitQuoterPercent);
    }

    // Set up auto-save effects
    this.setupAutoSave();

    // CRITICAL: In inline mode, reactively update data when replyToEvent changes
    // This ensures the reply is always sent to the correct event, even when the user
    // navigates to a different event while the same component instance stays alive
    effect(() => {
      if (this.inlineMode()) {
        const event = this.replyToEvent();
        if (event) {
          // Check if the event ID has changed (navigated to different event)
          const currentReplyToId = this.data?.replyTo?.id;
          if (currentReplyToId !== event.id) {
            // Update data to point to the new event
            this.data = {
              replyTo: {
                id: event.id,
                pubkey: event.pubkey,
                event: event,
              }
            };

            // Reset editor state for the new event
            this.content.set('');
            this.mentions.set([event.pubkey]); // Start with the event author mentioned
            this.mentionMap.clear();
            this.pubkeyToNameMap.clear();
            this.mediaMetadata.set([]);
            this.isExpanded.set(false);

            // Fetch the profile name for the new reply target
            this.loadMentionProfileName(event.pubkey);
          }
        }
      }
    });
  }

  ngOnInit() {
    // In inline mode, initial setup is handled by the effect in constructor
    // This ensures reactivity when replyToEvent changes
    if (this.inlineMode() && this.replyToEvent()) {
      const event = this.replyToEvent()!;
      this.data = {
        replyTo: {
          id: event.id,
          pubkey: event.pubkey,
          event: event,
        }
      };
    }

    // Store initial state for dirty detection BEFORE loading draft
    // This captures the truly empty/initial state so isDirty can detect restored drafts
    this.initialContent = this.content();
    this.initialMentions = [...this.mentions()];
    this.initialMediaMetadata = [...this.mediaMetadata()];
    this.initialTitle = this.title();

    // Load auto-saved draft if available (skip for inline mode to keep it simple)
    if (!this.inlineMode()) {
      this.loadAutoDraft();
    }

    // Initialize content with quote if provided
    if (this.data?.quote) {
      const nevent = nip19.neventEncode({
        id: this.data.quote.id,
        author: this.data.quote.pubkey,
        kind: this.data.quote.kind,
      });

      const quoteText = `nostr:${nevent}`;
      const currentContent = this.content();

      // Only add the quote if it doesn't already exist in the content
      if (!currentContent.includes(quoteText)) {
        if (currentContent) {
          this.content.set(currentContent + '\n\n' + quoteText);
        } else {
          this.content.set(quoteText);
        }
      }
    }

    // Initialize content if provided (e.g. from Share Target)
    if (this.data?.content) {
      const currentContent = this.content();
      const newContent = this.data.content.trim();

      // Only add the content if it doesn't already exist in the draft
      // This handles nostr: URIs (naddr, nevent, note, etc.) and regular URLs
      if (!this.contentAlreadyExists(currentContent, newContent)) {
        if (currentContent) {
          this.content.set(currentContent + '\n' + newContent);
        } else {
          this.content.set(newContent);
        }
      }
    }

    // Add reply mentions if this is a reply
    if (this.data?.replyTo) {
      const currentMentions = this.mentions();
      if (!currentMentions.includes(this.data.replyTo.pubkey)) {
        this.mentions.set([...currentMentions, this.data.replyTo.pubkey]);
      }
      // Fetch the profile name for the reply target
      this.loadMentionProfileName(this.data.replyTo.pubkey);
    }

    // Handle shared files
    if (this.data?.files && this.data.files.length > 0) {
      this.uploadFiles(this.data.files);
    }
  }

  private getAutoDraftKey(): string {
    const pubkey = this.accountState.pubkey();
    return `note-auto-draft-${pubkey}`;
  }

  private getContextKey(): string {
    // Create a unique key based on the dialog context
    const replyId = this.data?.replyTo?.id || '';
    const quoteId = this.data?.quote?.id || '';
    return `${replyId}-${quoteId}`;
  }

  private setupAutoSave(): void {
    // Watch for content changes with less aggressive polling
    const contentSignal = this.content;
    let previousContent = contentSignal();

    const checkAndScheduleAutoSave = () => {
      const currentContent = contentSignal();
      if (currentContent !== previousContent && currentContent.trim()) {
        previousContent = currentContent;
        this.scheduleAutoSave();
      }
    };

    // Check for content changes every 2 seconds instead of 500ms
    this.contentCheckIntervalHandle = setInterval(checkAndScheduleAutoSave, 2000);

    // Check other properties less frequently
    const mentionsSignal = this.mentions;
    const expirationEnabledSignal = this.expirationEnabled;
    const expirationTimeSignal = this.expirationTime;
    const mediaMetadataSignal = this.mediaMetadata;
    const isMediaModeSignal = this.isMediaMode;
    const titleSignal = this.title;

    let previousMentions = JSON.stringify(mentionsSignal());
    let previousExpirationEnabled = expirationEnabledSignal();
    let previousExpirationTime = expirationTimeSignal();
    let previousMediaMetadata = JSON.stringify(mediaMetadataSignal());
    let previousIsMediaMode = isMediaModeSignal();
    let previousTitle = titleSignal();

    const checkOtherChanges = () => {
      const currentMentions = JSON.stringify(mentionsSignal());
      const currentExpirationEnabled = expirationEnabledSignal();
      const currentExpirationTime = expirationTimeSignal();
      const currentMediaMetadata = JSON.stringify(mediaMetadataSignal());
      const currentIsMediaMode = isMediaModeSignal();
      const currentTitle = titleSignal();

      if (
        currentMentions !== previousMentions ||
        currentExpirationEnabled !== previousExpirationEnabled ||
        currentExpirationTime !== previousExpirationTime ||
        currentMediaMetadata !== previousMediaMetadata ||
        currentIsMediaMode !== previousIsMediaMode ||
        currentTitle !== previousTitle
      ) {
        previousMentions = currentMentions;
        previousExpirationEnabled = currentExpirationEnabled;
        previousExpirationTime = currentExpirationTime;
        previousMediaMetadata = currentMediaMetadata;
        previousIsMediaMode = currentIsMediaMode;
        previousTitle = currentTitle;

        // Only schedule auto-save if there's content or media
        if (this.content().trim() || this.mediaMetadata().length > 0) {
          this.scheduleAutoSave();
        }
      }
    };

    // Check other changes every 5 seconds
    this.otherChangesIntervalHandle = setInterval(checkOtherChanges, 5000);
  }

  private scheduleAutoSave(): void {
    // Clear existing timer
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    // Only auto-save if there's meaningful content or media
    const content = this.content().trim();
    const hasMedia = this.mediaMetadata().length > 0;

    if (!content && !hasMedia) return;

    // Schedule new auto-save
    this.autoSaveTimer = setTimeout(() => {
      this.saveAutoDraft();
    }, this.AUTO_SAVE_INTERVAL);
  }

  private saveAutoDraft(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const content = this.content().trim();
    const hasMedia = this.mediaMetadata().length > 0;

    if (!content && !hasMedia) return;

    const autoDraft: NoteAutoDraft = {
      content: this.content(),
      mentions: [...this.mentions()],
      mentionMap: Array.from(this.mentionMap.entries()),
      pubkeyToNameMap: Array.from(this.pubkeyToNameMap.entries()),
      showPreview: this.showPreview(),
      showAdvancedOptions: this.showAdvancedOptions(),
      expirationEnabled: this.expirationEnabled(),
      expirationDate: this.expirationDate(),
      expirationTime: this.expirationTime(),
      uploadOriginal: this.uploadOriginal(),
      addClientTag: this.addClientTag(),
      lastModified: Date.now(),
      replyToId: this.data?.replyTo?.id,
      quoteId: this.data?.quote?.id,
      mediaMetadata: this.mediaMetadata(),
      isMediaMode: this.isMediaMode(),
      title: this.title(),
    };

    const key = this.getAutoDraftKey();

    // Check if this is meaningfully different from the last save
    const previousDraft = this.localStorage.getObject<NoteAutoDraft>(key);
    if (previousDraft) {
      const isSimilar =
        previousDraft.content === autoDraft.content &&
        JSON.stringify(previousDraft.mentions) === JSON.stringify(autoDraft.mentions) &&
        JSON.stringify(previousDraft.mediaMetadata) === JSON.stringify(autoDraft.mediaMetadata) &&
        previousDraft.expirationEnabled === autoDraft.expirationEnabled &&
        previousDraft.expirationTime === autoDraft.expirationTime &&
        previousDraft.title === autoDraft.title;

      // If content is very similar, don't save again (prevents spam)
      if (isSimilar) return;
    }

    this.localStorage.setObject(key, autoDraft);

    // Silent auto-save, no notification needed
    console.debug('Note auto-draft saved');
  }

  private loadAutoDraft(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const key = this.getAutoDraftKey();
    const autoDraft = this.localStorage.getObject<NoteAutoDraft>(key);

    if (autoDraft) {
      // Check if draft matches current context
      const currentContext = this.getContextKey();
      const draftContext = `${autoDraft.replyToId || ''}-${autoDraft.quoteId || ''}`;

      if (currentContext !== draftContext) {
        // Context doesn't match, don't load this draft
        return;
      }

      // Check if draft is not too old (2 hours for notes)
      const twoHoursInMs = 2 * 60 * 60 * 1000;
      const isExpired = Date.now() - autoDraft.lastModified > twoHoursInMs;

      const hasContent = autoDraft.content.trim().length > 0;
      const hasMedia = autoDraft.mediaMetadata && autoDraft.mediaMetadata.length > 0;

      if (!isExpired && (hasContent || hasMedia)) {
        // Don't overwrite existing content from quote/reply initialization
        const existingContent = this.content().trim();
        const draftHasMoreContent = autoDraft.content.trim().length > existingContent.length;

        if (draftHasMoreContent || hasMedia) {
          this.content.set(autoDraft.content);
          this.mentions.set([...autoDraft.mentions]);

          if (autoDraft.mentionMap) {
            this.mentionMap = new Map(autoDraft.mentionMap);
          }
          if (autoDraft.pubkeyToNameMap) {
            this.pubkeyToNameMap = new Map(autoDraft.pubkeyToNameMap);
          }

          this.showPreview.set(autoDraft.showPreview);
          this.showAdvancedOptions.set(autoDraft.showAdvancedOptions);
          this.expirationEnabled.set(autoDraft.expirationEnabled);
          this.expirationDate.set(autoDraft.expirationDate);
          this.expirationTime.set(autoDraft.expirationTime);
          this.uploadOriginal.set(autoDraft.uploadOriginal ?? false);
          this.addClientTag.set(autoDraft.addClientTag ?? this.localSettings.addClientTag());

          if (autoDraft.mediaMetadata) {
            this.mediaMetadata.set(autoDraft.mediaMetadata);
          }
          if (autoDraft.isMediaMode !== undefined) {
            this.isMediaMode.set(autoDraft.isMediaMode);
          }
          if (autoDraft.title) {
            this.title.set(autoDraft.title);
          }

          // Show restoration message
          this.snackBar.open('Draft restored', 'Dismiss', {
            duration: 3000,
            panelClass: 'info-snackbar',
          });
        }
      } else if (isExpired) {
        // Remove expired draft
        this.clearAutoDraft();
      }
    }
  }

  private clearAutoDraft(): void {
    const key = this.getAutoDraftKey();
    this.localStorage.removeItem(key);
  }

  async publishNote(): Promise<void> {
    // CRITICAL: Guard against double-click/double-submit
    // Check publishInitiated first to prevent race conditions
    if (this.publishInitiated()) {
      console.warn('[NoteEditorDialog] Publish already initiated, ignoring duplicate call');
      return;
    }

    this.publishInitiated.set(true);

    // Double-check canPublish and isPublishing after setting publishInitiated
    if (!this.canPublish() || this.isPublishing()) {
      this.publishInitiated.set(false);
      return;
    }

    this.isPublishing.set(true);

    try {
      if (this.isMediaModeEnabled()) {
        await this.publishMediaFlow();
      } else {
        await this.publishStandardFlow();
      }
    } catch (error) {
      console.error('Error publishing note:', error);
      this.snackBar.open('Failed to publish note. Please try again.', 'Close', {
        duration: 5000,
      });
    } finally {
      console.log('[NoteEditorDialog] Finally block - resetting isPublishing and publishInitiated');
      this.isPublishing.set(false);
      this.publishInitiated.set(false);
    }
  }

  private async publishStandardFlow(): Promise<void> {
    const content = this.processContentForPublishing(this.content().trim());
    const tags = this.buildTags();
    await this.publishEvent(content, tags);
  }

  private async publishMediaFlow(): Promise<void> {
    // 1. Determine Kind
    const kind = this.getMediaEventKind();

    // 2. Prepare Content (remove URLs)
    let content = this.content();
    this.mediaMetadata().forEach(m => {
      const escapedUrl = m.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedUrl, 'g');
      content = content.replace(regex, '').trim();
    });
    content = this.processContentForPublishing(content);

    // 3. Build Media Event Tags
    const mediaTags: string[][] = [];
    // Title
    if (this.title()) {
      mediaTags.push(['title', this.title()]);
    }
    // Imeta
    this.mediaMetadata().forEach(metadata => {
      const imetaTag = this.buildImetaTag(metadata);
      if (imetaTag) {
        mediaTags.push(imetaTag);
      }
    });
    // Hashtags
    this.extractHashtags(content, mediaTags);
    // Mentions
    this.mentions().forEach(pubkey => {
      mediaTags.push(['p', pubkey]);
    });
    // Client
    if (this.addClientTag()) {
      mediaTags.push(['client', 'nostria']);
    }
    // Alt tag
    mediaTags.push(['alt', `Media post: ${this.title() || 'Untitled'}`]);

    // 4. Create and Sign Media Event
    const mediaEvent = this.nostrService.createEvent(kind, content, mediaTags);

    // 5. Publish Media Event
    const result = await this.nostrService.signAndPublish(mediaEvent);

    if (!result.success || !result.event) {
      throw new Error('Failed to publish media event');
    }

    const signedMediaEvent = result.event;

    // 6. Create Kind 1 Event Wrapper
    const nevent = nip19.neventEncode({
      id: signedMediaEvent.id,
      author: signedMediaEvent.pubkey,
      kind: signedMediaEvent.kind,
    });

    // Kind 1 content: Text + Reference
    const kind1Content = `${content}\n\nnostr:${nevent}`;

    // Kind 1 tags
    const kind1Tags = this.buildTags();
    // Remove imeta tags from Kind 1 (since they are in Kind 20)
    const filteredKind1Tags = kind1Tags.filter(t => t[0] !== 'imeta');

    // Add 'q' tag for the media event
    filteredKind1Tags.push(['q', signedMediaEvent.id, '', signedMediaEvent.pubkey]);

    // 7. Publish Kind 1 Event
    await this.publishEvent(kind1Content, filteredKind1Tags);
  }

  private getMediaEventKind(): number {
    const hasVideo = this.mediaMetadata().some(m => m.mimeType?.startsWith('video/'));
    if (!hasVideo) return 20; // Images

    const verticalVideo = this.mediaMetadata().some(m => {
      if (m.mimeType?.startsWith('video/') && m.dimensions) {
        return m.dimensions.height > m.dimensions.width;
      }
      return false;
    });

    return verticalVideo ? 22 : 21;
  }

  private async publishEvent(contentToPublish: string, tags: string[][]): Promise<void> {
    let eventToSign: UnsignedEvent;

    // If PoW is enabled, ensure we have a mined event
    if (this.powEnabled()) {
      // If we don't have a mined event yet, or content has changed, mine it now
      if (!this.powMinedEvent() || this.powMinedEvent()?.content !== contentToPublish) {
        // Build the base event for mining
        const baseEvent = this.nostrService.createEvent(1, contentToPublish, tags);

        // Start mining
        this.snackBar.open('Mining Proof-of-Work before publishing...', '', { duration: 2000 });

        const result = await this.powService.mineEvent(
          baseEvent,
          this.powTargetDifficulty(),
          (progress: PowProgress) => {
            this.powProgress.set(progress);
          }
        );

        if (result && result.event) {
          this.powMinedEvent.set(result.event);
          eventToSign = result.event;
        } else if (!this.powService.isRunning()) {
          // Mining was stopped or failed
          this.snackBar.open('Proof-of-Work mining was stopped or failed', 'Close', {
            duration: 5000,
          });
          throw new Error('PoW mining stopped');
        } else {
          throw new Error('Failed to mine Proof-of-Work');
        }
      } else {
        // Use existing mined event
        eventToSign = this.powMinedEvent()!;
      }
    } else {
      // PoW is not enabled, create event normally
      eventToSign = this.nostrService.createEvent(1, contentToPublish, tags);
    }

    // Use the centralized publishing service which handles relay distribution
    // This ensures replies, quotes, and mentions are published to all relevant relays

    // Set up a flag to track if dialog has been closed
    let dialogClosed = false;
    let publishedEventId: string | undefined;

    // Subscribe to relay results to close dialog on first success
    this.publishSubscription = this.publishEventBus.on('relay-result').subscribe((event) => {
      if (!dialogClosed && event.type === 'relay-result') {
        const relayEvent = event as PublishRelayResultEvent;

        // Check if this is for our event (match by content since we don't have ID yet)
        // Once we have the event ID, match by that
        const isOurEvent = publishedEventId
          ? relayEvent.event.id === publishedEventId
          : relayEvent.event.content === contentToPublish;

        if (isOurEvent && relayEvent.success) {
          dialogClosed = true;
          publishedEventId = relayEvent.event.id;

          // Clear draft and close dialog immediately after first successful publish
          if (!this.inlineMode()) {
            this.clearAutoDraft();
          }
          this.snackBar.open(this.inlineMode() ? 'Reply published!' : 'Note published successfully!', 'Close', {
            duration: 3000,
          });

          // Close dialog with the signed event
          const signedEvent = relayEvent.event;

          if (this.inlineMode()) {
            // In inline mode: reset state and emit event
            this.content.set('');
            this.mentionMap.clear();
            this.pubkeyToNameMap.clear();
            this.mediaMetadata.set([]);
            this.isExpanded.set(false);
            this.replyPublished.emit(signedEvent);
          } else {
            // In dialog mode: close dialog
            this.dialogRef?.close({ published: true, event: signedEvent });
          }

          // Navigate to the published event
          const nevent = nip19.neventEncode({
            id: signedEvent.id,
            author: signedEvent.pubkey,
            kind: signedEvent.kind,
          });
          this.layout.openGenericEvent(nevent, signedEvent);

          // Unsubscribe after handling
          if (this.publishSubscription) {
            this.publishSubscription.unsubscribe();
            this.publishSubscription = undefined;
          }
        }
      }
    });

    // Start the publish operation (will continue in background even after dialog closes)
    const result = await this.nostrService.signAndPublish(eventToSign);

    console.log('[NoteEditorDialog] Publish result:', {
      success: result.success,
      hasEvent: !!result.event,
      eventId: result.event?.id
    });

    // Store the event ID for matching in the subscription
    if (result.event) {
      publishedEventId = result.event.id;
    }

    // If no relay succeeded at all (dialog would still be open)
    if (!dialogClosed && (!result.success || !result.event)) {
      throw new Error('Failed to publish event');
    }
  }

  private buildTags(): string[][] {
    const tags: string[][] = [];

    // Add reply tags (NIP-10)
    if (this.data?.replyTo) {
      const parentEvent = this.data.replyTo.event;

      if (parentEvent) {
        // Get all existing e and p tags from the parent event
        const existingETags = parentEvent.tags.filter(tag => tag[0] === 'e');
        const existingPTags = parentEvent.tags.filter(tag => tag[0] === 'p');

        // Step 1: Add all existing "e" tags from the parent event
        // When replying further down a thread, only the latest "e" tag should have "reply"
        // All other "e" tags should preserve "root" marker or be unmarked
        existingETags.forEach(eTag => {
          const tagCopy = [...eTag];
          // If this tag has "reply" marker, remove it (make it unmarked)
          // Keep "root" markers as they are
          if (tagCopy[3] === 'reply') {
            tagCopy[3] = ''; // Remove reply marker from intermediate events
          }
          tags.push(tagCopy);
        });

        // Step 2: Add the parent event as a new "e" tag
        // If the parent has no existing "e" tags, this is the first reply, so mark as "root"
        // If the parent has existing "e" tags, this is a reply in a thread, so mark as "reply"
        const marker = existingETags.length === 0 ? 'root' : 'reply';
        // Format: ["e", <event-id>, <relay-url>, <marker>, <pubkey>]
        tags.push(['e', this.data.replyTo.id, '', marker, this.data.replyTo.pubkey]);

        // Step 3: Add all existing "p" tags from the parent event
        existingPTags.forEach(pTag => {
          tags.push([...pTag]); // Copy the entire tag
        });

        // Step 4: Add the author of the parent event as a "p" tag if not already included
        const authorAlreadyIncluded = existingPTags.some(
          tag => tag[1] === this.data.replyTo!.pubkey
        );
        if (!authorAlreadyIncluded) {
          tags.push(['p', this.data.replyTo.pubkey, '']); // Format: ["p", <pubkey>, <relay-url>]
        }
      } else {
        // Fallback to old behavior if no event is provided
        if (this.data.replyTo.rootId) {
          // This is a reply to a reply, so we have both root and reply
          tags.push(['e', this.data.replyTo.rootId, '', 'root']);
          tags.push(['e', this.data.replyTo.id, '', 'reply']);
        } else {
          // This is a direct reply, so the event we're replying to is the root
          tags.push(['e', this.data.replyTo.id, '', 'root']);
        }

        // Add the author as a p tag
        tags.push(['p', this.data.replyTo.pubkey]);
      }
    }

    // Add quote tag (NIP-18)
    if (this.data?.quote) {
      const relay = ''; // TODO: provide relay for the quoted note
      tags.push(['q', this.data.quote.id, relay, this.data.quote.pubkey]);

      // According to NIP-18, also add a p-tag for the quoted author
      // This ensures proper notifications
      const existingPubkeys = tags.filter(tag => tag[0] === 'p').map(tag => tag[1]);
      if (!existingPubkeys.includes(this.data.quote.pubkey)) {
        tags.push(['p', this.data.quote.pubkey]);
      }

      // Add zap split tags if enabled (NIP-57 Appendix G)
      if (this.zapSplitEnabled()) {
        const currentUserPubkey = this.currentAccountPubkey();
        if (currentUserPubkey) {
          // Use percentage values as weights (0-100 range)
          // According to NIP-57 Appendix G, weights can be any positive numbers
          // and will be normalized by recipients when calculating splits
          const originalWeight = this.zapSplitOriginalPercent();
          const quoterWeight = this.zapSplitQuoterPercent();

          // Add zap tag for original author (the person being quoted)
          // Only add if weight is greater than 0 (per NIP-57 spec)
          if (originalWeight > 0) {
            tags.push(['zap', this.data.quote.pubkey, relay, originalWeight.toString()]);
          }

          // Add zap tag for quoter (current user)
          // Only add if weight is greater than 0 (per NIP-57 spec)
          if (quoterWeight > 0) {
            tags.push(['zap', currentUserPubkey, '', quoterWeight.toString()]);
          }
        }
      }
    }

    // Parse NIP-27 references from content and add appropriate tags (NIP-18 for quotes)
    // This is optional according to NIP-27, but recommended for notifications
    const contentToPublish = this.processContentForPublishing(this.content());
    this.extractNip27Tags(contentToPublish, tags);

    // Extract hashtags from content and add as t-tags
    this.extractHashtags(contentToPublish, tags);

    // Add mention tags (avoid duplicates with existing p tags)
    const existingPubkeys = new Set(tags.filter(tag => tag[0] === 'p').map(tag => tag[1]));
    this.mentions().forEach(pubkey => {
      if (!existingPubkeys.has(pubkey)) {
        tags.push(['p', pubkey]);
      }
    });

    // Add expiration tag if enabled
    if (this.expirationEnabled()) {
      const expirationDateTime = this.getExpirationDateTime();
      if (expirationDateTime) {
        const expirationTimestamp = Math.floor(expirationDateTime.getTime() / 1000);
        tags.push(['expiration', expirationTimestamp.toString()]);
      }
    }

    // Add client tag if enabled
    if (this.addClientTag()) {
      tags.push(['client', 'nostria']);
    }

    // Add imeta tags for uploaded media (NIP-92)
    this.mediaMetadata().forEach(metadata => {
      const imetaTag = this.buildImetaTag(metadata);
      if (imetaTag) {
        tags.push(imetaTag);
      }
    });

    return tags;
  }

  /**
   * Build an imeta tag from media metadata (NIP-92)
   * Format: ["imeta", "url <url>", "m <mime-type>", "blurhash <hash>", "dim <widthxheight>", ...]
   */
  private buildImetaTag(metadata: MediaMetadata): string[] | null {
    // Use the centralized utility service for building imeta tags
    return this.utilities.buildImetaTag(metadata);
  }

  /**
   * Extract NIP-27 references from content and add corresponding tags
   * According to NIP-27, adding tags is optional but recommended for notifications
   * According to NIP-18, inline event references (note/nevent/naddr) should use 'q' tags (quotes),
   * NOT 'e' tags which are for thread participation (replies).
   */
  private extractNip27Tags(content: string, tags: string[][]): void {
    // Match all nostr: URIs in content
    const nostrUriPattern = /nostr:(note1|nevent1|npub1|nprofile1|naddr1)([a-zA-Z0-9]+)/g;
    const matches = content.matchAll(nostrUriPattern);

    // Track added quote event IDs (q tags) separately from reply event IDs (e tags)
    const addedQuoteEventIds = new Set(tags.filter(tag => tag[0] === 'q').map(tag => tag[1]));
    const addedPubkeys = new Set(tags.filter(tag => tag[0] === 'p').map(tag => tag[1]));

    for (const match of matches) {
      const fullIdentifier = match[1] + match[2];

      try {
        const decoded = nip19.decode(fullIdentifier);

        switch (decoded.type) {
          case 'note':
            // NIP-18: Add q tag for quote reference (NOT e tag which is for thread participation)
            if (!addedQuoteEventIds.has(decoded.data)) {
              // Format: ["q", "<event-id>", "<relay-url>", "<pubkey>"]
              // We don't have pubkey for note format, so leave it empty
              tags.push(['q', decoded.data, '', '']);
              addedQuoteEventIds.add(decoded.data);
            }
            break;

          case 'nevent':
            // NIP-18: Add q tag for quote reference (NOT e tag which is for thread participation)
            if (!addedQuoteEventIds.has(decoded.data.id)) {
              const relay = decoded.data.relays?.[0] || '';
              const pubkey = decoded.data.author || '';
              // Format: ["q", "<event-id>", "<relay-url>", "<pubkey>"]
              tags.push(['q', decoded.data.id, relay, pubkey]);
              addedQuoteEventIds.add(decoded.data.id);
            }
            // Also add p tag for the author if available (for notifications)
            if (decoded.data.author && !addedPubkeys.has(decoded.data.author)) {
              tags.push(['p', decoded.data.author, '']);
              addedPubkeys.add(decoded.data.author);
            }
            break;

          case 'npub':
            // Add p tag for profile reference
            if (!addedPubkeys.has(decoded.data)) {
              tags.push(['p', decoded.data, '']);
              addedPubkeys.add(decoded.data);
            }
            break;

          case 'nprofile':
            // Add p tag for profile reference
            if (!addedPubkeys.has(decoded.data.pubkey)) {
              tags.push(['p', decoded.data.pubkey, '']);
              addedPubkeys.add(decoded.data.pubkey);
            }
            break;

          case 'naddr': {
            // NIP-18: For addressable events, use q tag with the event address
            const aTagValue = `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`;
            const relay = decoded.data.relays?.[0] || '';
            // Format: ["q", "<event-address>", "<relay-url>", "<pubkey>"]
            tags.push(['q', aTagValue, relay, decoded.data.pubkey]);
            // Also add p tag for the author (for notifications)
            if (!addedPubkeys.has(decoded.data.pubkey)) {
              tags.push(['p', decoded.data.pubkey, '']);
              addedPubkeys.add(decoded.data.pubkey);
            }
            break;
          }
        }
      } catch (error) {
        // Invalid NIP-19 identifier, skip it
        console.warn('Failed to decode NIP-19 identifier:', fullIdentifier, error);
      }
    }
  }

  /**
   * Extract hashtags from content and add as t-tags
   * Hashtags are words prefixed with # (e.g., #nostr, #bitcoin)
   */
  private extractHashtags(content: string, tags: string[][]): void {
    // Match hashtags: # followed by alphanumeric characters and underscores
    // Use word boundary to ensure proper matching
    const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
    const hashtags = new Set<string>();

    let match;
    while ((match = hashtagRegex.exec(content)) !== null) {
      const hashtag = match[1].toLowerCase(); // Store lowercase for consistency
      hashtags.add(hashtag);
    }

    // Add unique hashtags as t-tags
    hashtags.forEach(hashtag => {
      tags.push(['t', hashtag]);
    });
  }

  addMention(pubkey: string): void {
    const currentMentions = this.mentions();
    if (!currentMentions.includes(pubkey)) {
      this.mentions.set([...currentMentions, pubkey]);
    }
  }

  removeMention(pubkey: string): void {
    // Remove from mentions list
    this.mentions.set(this.mentions().filter(p => p !== pubkey));

    // Find and remove the mention text from content
    const name = this.pubkeyToNameMap.get(pubkey);
    if (name) {
      // Build the mention text that was inserted (with @)
      const baseMention = `@${name}`;

      // Find all possible mention formats for this user
      const possibleMentions: string[] = [baseMention];

      // Also check for numbered variants (e.g., @name_1, @name_2)
      let counter = 1;
      while (this.mentionMap.has(`${baseMention}_${counter}`)) {
        possibleMentions.push(`${baseMention}_${counter}`);
        counter++;
      }

      let currentContent = this.content();

      // Remove each mention occurrence from content
      for (const mention of possibleMentions) {
        // Check if this mention exists in the map
        if (this.mentionMap.has(mention)) {
          // Remove the mention text (with optional trailing space)
          const escapedMention = mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          currentContent = currentContent.replace(new RegExp(escapedMention + '\\s?', 'g'), '');
          // Remove from mentionMap
          this.mentionMap.delete(mention);
        }
      }

      // Clean up extra whitespace (but preserve newlines structure)
      currentContent = currentContent.replace(/[ \t]+/g, ' ').replace(/^ +| +$/gm, '').trim();

      this.content.set(currentContent);

      // Update textarea
      if (this.contentTextarea) {
        this.contentTextarea.nativeElement.value = currentContent;
      }

      // Remove from pubkeyToNameMap
      this.pubkeyToNameMap.delete(pubkey);
    }

    // Save draft immediately after mention removal
    this.saveAutoDraft();
  }

  // Mention input handling methods
  onContentInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    const newContent = target.value;
    this.content.set(newContent);

    // Auto-resize the textarea
    this.autoResizeTextarea(target);

    // Check for removed mentions and sync with mentions list
    this.syncMentionsWithContent(newContent);

    // Check for mention trigger
    this.handleMentionInput(newContent, target.selectionStart || 0);
  }

  /**
   * Auto-resize the textarea based on its content.
   * Adjusts the height to fit the content while respecting min/max constraints.
   * Scrollbar will automatically appear when content exceeds max height (via CSS overflow-y: auto).
   */
  private autoResizeTextarea(textarea: HTMLTextAreaElement): void {
    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';

    // Get computed style for min/max height
    const computedStyle = window.getComputedStyle(textarea);
    const minHeight = parseInt(computedStyle.minHeight, 10) || 200;
    const maxHeight = this.inlineMode() ? 200 : 500; // Max height for inline vs dialog mode

    // Calculate the new height based on scrollHeight
    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);

    // Set the new height
    textarea.style.height = `${newHeight}px`;
  }

  /**
   * Sync mentions list with the current content.
   * Removes mentions from the list if their @name text has been deleted from the content.
   */
  private syncMentionsWithContent(currentContent: string): void {
    const mentionsToRemove: string[] = [];

    // Check each pubkey in the mentions list
    for (const pubkey of this.mentions()) {
      // Skip reply target mentions - they should always remain
      if (this.isReplyTargetMention(pubkey)) {
        continue;
      }

      const name = this.pubkeyToNameMap.get(pubkey);
      if (!name) continue;

      // Build the base mention text
      const baseMention = `@${name}`;

      // Check if any variant of this mention exists in the content
      let mentionFound = false;

      // Check base mention
      if (currentContent.includes(baseMention)) {
        mentionFound = true;
      } else {
        // Check for numbered variants (e.g., @name_1, @name_2)
        let counter = 1;
        while (this.mentionMap.has(`${baseMention}_${counter}`)) {
          if (currentContent.includes(`${baseMention}_${counter}`)) {
            mentionFound = true;
            break;
          }
          counter++;
        }
      }

      if (!mentionFound) {
        mentionsToRemove.push(pubkey);
      }
    }

    // Remove mentions that are no longer in the content
    if (mentionsToRemove.length > 0) {
      for (const pubkey of mentionsToRemove) {
        // Remove from mentions list only (don't modify content as user already did that)
        this.mentions.set(this.mentions().filter(p => p !== pubkey));

        // Clean up the maps
        const name = this.pubkeyToNameMap.get(pubkey);
        if (name) {
          const baseMention = `@${name}`;
          this.mentionMap.delete(baseMention);
          // Also clean up numbered variants
          let counter = 1;
          while (this.mentionMap.has(`${baseMention}_${counter}`)) {
            this.mentionMap.delete(`${baseMention}_${counter}`);
            counter++;
          }
          this.pubkeyToNameMap.delete(pubkey);
        }
      }

      // Save draft after mention removal
      this.saveAutoDraft();
    }
  }

  onHostKeyDown(event: KeyboardEvent): void {
    // Alt+Enter (Windows/Linux) or Cmd+Enter (Mac) shortcut to publish note
    if (this.platformService.hasModifierKey(event) && event.key === 'Enter') {
      event.preventDefault();
      if (this.canPublish() && !this.isPublishing()) {
        this.publishNote();
      }
    }

    // Close dialog on Escape if not in mention autocomplete or other overlays
    if (event.key === 'Escape') {
      // Check if mention autocomplete is open
      const mentionConfig = this.mentionConfig();
      if (mentionConfig) {
        // Prevent default behavior and stop propagation
        event.preventDefault();
        event.stopPropagation();

        // Dismiss the mention autocomplete
        this.onMentionDismissed();
      } else {
        // Mention autocomplete is not open, close the dialog
        this.cancel();
      }
    }
  }

  @HostListener('document:keydown', ['$event'])
  handleGlobalKeydown(event: KeyboardEvent) {
    // Alt+D (Windows/Linux) or Cmd+D (Mac) shortcut to toggle dictation
    if (this.platformService.hasModifierKey(event) && (event.key.toLowerCase() === 'd' || event.code === 'KeyD')) {
      event.preventDefault();
      if (!this.isUploading() && !this.isPublishing() && !this.showPreview() && !this.showAdvancedOptions() && !this.isTranscribing()) {
        this.toggleRecording();
      }
    }
  }

  onContentKeyDown(event: KeyboardEvent): void {
    const mentionConfig = this.mentionConfig();

    // If mention autocomplete is open, handle navigation keys
    if (mentionConfig) {
      if (event.key === 'Enter') {
        // Prevent default behavior and stop propagation
        event.preventDefault();
        event.stopPropagation();

        // Manually trigger selection from the autocomplete component
        if (this.mentionAutocomplete) {
          const results = this.mentionAutocomplete.searchResults();
          const focusedIndex = this.mentionAutocomplete.focusedIndex();
          const focusedProfile = results[focusedIndex];

          if (focusedProfile) {
            this.mentionAutocomplete.selectMention(focusedProfile);
          }
        }
        return;
      }

      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        // Prevent default behavior and stop propagation
        event.preventDefault();
        event.stopPropagation();

        // Manually update focus index in autocomplete
        if (this.mentionAutocomplete) {
          const results = this.mentionAutocomplete.searchResults();
          const currentIndex = this.mentionAutocomplete.focusedIndex();

          if (event.key === 'ArrowDown') {
            const newIndex = Math.min(currentIndex + 1, results.length - 1);
            this.mentionAutocomplete.setFocusedIndex(newIndex);
          } else if (event.key === 'ArrowUp') {
            const newIndex = Math.max(currentIndex - 1, 0);
            this.mentionAutocomplete.setFocusedIndex(newIndex);
          }
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.onMentionDismissed();
        return;
      }
    }
  }

  onContentKeyUp(event: KeyboardEvent): void {
    // Ignore navigation keys that are handled in keydown to prevent resetting mention state
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
      return;
    }

    const target = event.target as HTMLTextAreaElement;
    this.handleMentionInput(this.content(), target.selectionStart || 0);
  }

  onContentClick(event: MouseEvent): void {
    const target = event.target as HTMLTextAreaElement;
    this.handleMentionInput(this.content(), target.selectionStart || 0);
  }

  private handleMentionInput(content: string, cursorPosition: number): void {
    const detection = this.mentionInputService.detectMention(content, cursorPosition);
    this.mentionDetection.set(detection);

    if (detection.isTypingMention) {
      // Calculate position for autocomplete dropdown
      const textareaElement = this.contentTextarea?.nativeElement;
      if (textareaElement) {
        const position = this.calculateMentionPosition(textareaElement);
        this.mentionPosition.set(position);

        // Set mention config for autocomplete
        this.mentionConfig.set({
          cursorPosition: detection.cursorPosition,
          query: detection.query,
          mentionStart: detection.mentionStart,
        });
      }
    } else {
      // Hide mention autocomplete
      this.mentionConfig.set(null);
    }
  }

  private calculateMentionPosition(textarea: HTMLTextAreaElement): { top: number; left: number } {
    // Get cursor coordinates relative to the textarea
    const cursorCoords = this.getCaretCoordinates(textarea);

    const textareaRect = textarea.getBoundingClientRect();

    // Calculate absolute position of cursor in viewport
    const cursorTop = textareaRect.top + cursorCoords.top;
    const cursorLeft = textareaRect.left + cursorCoords.left;

    // Position dropdown below the cursor
    const gap = 4; // Small gap below cursor
    const top = cursorTop + cursorCoords.height + gap;
    let left = cursorLeft;

    // Ensure horizontal positioning fits within viewport
    const viewportWidth = window.innerWidth;
    const autocompleteWidth = 420;

    if (left + autocompleteWidth > viewportWidth - 16) {
      left = viewportWidth - autocompleteWidth - 16;
    }

    if (left < 16) {
      left = 16;
    }

    return {
      top: top,
      left: left
    };
  }

  private getCaretCoordinates(element: HTMLTextAreaElement): { top: number; left: number; height: number } {
    // Create a mirror div to calculate caret position
    const div = document.createElement('div');
    const style = getComputedStyle(element);

    // Copy textarea styles to div
    const properties = [
      'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
      'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform',
      'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing'
    ];

    properties.forEach(prop => {
      const key = prop as keyof CSSStyleDeclaration;
      const value = style[key];
      if (typeof value === 'string') {
        div.style.setProperty(prop, value);
      }
    });

    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';

    document.body.appendChild(div);

    const position = element.selectionStart || 0;
    const textBeforeCaret = element.value.substring(0, position);

    div.textContent = textBeforeCaret;

    const span = document.createElement('span');
    span.textContent = element.value.substring(position) || '.';
    div.appendChild(span);

    const coordinates = {
      top: span.offsetTop,
      left: span.offsetLeft,
      height: parseInt(style.lineHeight) || parseInt(style.fontSize) || 20
    };

    document.body.removeChild(div);

    return coordinates;
  }

  onMentionSelected(selection: MentionSelection): void {
    const detection = this.mentionDetection();
    if (!detection) return;

    // Generate display name
    let name = selection.displayName || 'unknown';
    // Sanitize name to avoid issues with regex or confusing characters if needed
    // For now, just ensure it doesn't have newlines
    name = name.replace(/\s+/g, '_');

    let textToInsert = `@${name}`;

    // Handle collisions
    if (this.mentionMap.has(textToInsert) && this.mentionMap.get(textToInsert) !== selection.nprofileUri) {
      let counter = 1;
      while (this.mentionMap.has(`${textToInsert}_${counter}`) && this.mentionMap.get(`${textToInsert}_${counter}`) !== selection.nprofileUri) {
        counter++;
      }
      textToInsert = `${textToInsert}_${counter}`;
    }

    this.mentionMap.set(textToInsert, selection.nprofileUri);
    this.pubkeyToNameMap.set(selection.pubkey, name);

    // Replace the mention in the content
    const replacement = this.mentionInputService.replaceMention(
      detection,
      textToInsert
    );

    // Update content
    this.content.set(replacement.replacementText);

    // Update cursor position
    setTimeout(() => {
      const textarea = this.contentTextarea?.nativeElement;
      if (textarea) {
        textarea.selectionStart = replacement.newCursorPosition;
        textarea.selectionEnd = replacement.newCursorPosition;
        textarea.focus();
      }
    }, 0);

    // Add to mentions list for p tags
    this.addMention(selection.pubkey);

    // Hide autocomplete
    this.mentionConfig.set(null);
  }

  onMentionDismissed(): void {
    this.mentionConfig.set(null);
  }

  cancel(): void {
    if (this.isPublishing()) {
      return;
    }

    // Stop PoW if running
    if (this.isPowMining()) {
      this.stopPow();
    }

    if (this.inlineMode()) {
      // In inline mode: just collapse if empty, otherwise confirm discard
      const content = this.content().trim();
      if (content) {
        if (confirm('Discard your reply?')) {
          this.content.set('');
          this.mentionMap.clear();
          this.pubkeyToNameMap.clear();
          this.mediaMetadata.set([]);
          this.isExpanded.set(false);
          this.cancelled.emit();
        }
      } else {
        this.isExpanded.set(false);
        this.cancelled.emit();
      }
    } else {
      // Check if there's meaningful content before closing
      const content = this.content().trim();
      if (content) {
        // Keep the auto-draft - user might want to continue later
        this.snackBar.open('Note draft saved automatically', 'Dismiss', {
          duration: 3000,
          panelClass: 'info-snackbar',
        });
      } else {
        // No content, clear any existing draft
        this.clearAutoDraft();
      }

      this.dialogRef?.close({ published: false });
    }
  }

  dismissError(): void {
    this.mediaService.clearError();
  }

  // Clear draft - reset all editable fields to initial state
  clearDraft(): void {
    this.content.set(this.initialContent);
    this.mentions.set([...this.initialMentions]);
    this.mentionMap.clear();
    this.pubkeyToNameMap.clear();
    this.mediaMetadata.set([...this.initialMediaMetadata]);
    this.title.set(this.initialTitle);
    this.isMediaMode.set(false);
    this.expirationEnabled.set(false);
    this.expirationDate.set(null);
    this.expirationTime.set('12:00');
    this.showPreview.set(false);
    this.showAdvancedOptions.set(false);
    this.showEventJson.set(false);

    // Clear auto-saved draft from storage
    this.clearAutoDraft();

    // Update the textarea value directly to ensure UI sync
    if (this.contentTextarea) {
      this.contentTextarea.nativeElement.value = this.initialContent;
    }

    this.snackBar.open('Draft cleared', 'Dismiss', {
      duration: 2000,
    });
  }

  // Preview functionality
  togglePreview(): void {
    const wasInPreview = this.showPreview();
    this.showPreview.update(current => !current);
    
    // If coming back from preview, re-trigger textarea auto-resize after it renders
    if (wasInPreview) {
      setTimeout(() => {
        if (this.contentTextarea) {
          this.autoResizeTextarea(this.contentTextarea.nativeElement);
        }
      }, 0);
    }
  }

  // Advanced options functionality
  toggleAdvancedOptions(): void {
    const wasInAdvancedOptions = this.showAdvancedOptions();
    this.showAdvancedOptions.update(current => !current);
    
    // If coming back from advanced options, re-trigger textarea auto-resize after it renders
    if (wasInAdvancedOptions) {
      setTimeout(() => {
        if (this.contentTextarea) {
          this.autoResizeTextarea(this.contentTextarea.nativeElement);
        }
      }, 0);
    }
  }

  onExpirationToggle(enabled: boolean): void {
    this.expirationEnabled.set(enabled);
    if (!enabled) {
      this.expirationDate.set(null);
      this.expirationTime.set('12:00');
    }
  }

  onExpirationDateChange(date: Date | null): void {
    this.expirationDate.set(date);
  }

  onExpirationTimeChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const time = target.value;
    this.expirationTime.set(time);
  }

  private getExpirationDateTime(): Date | null {
    const date = this.expirationDate();
    const time = this.expirationTime();

    if (!date || !time) return null;

    const [hours, minutes] = time.split(':').map(Number);
    const dateTime = new Date(date);
    dateTime.setHours(hours, minutes, 0, 0);

    return dateTime;
  }

  // Format date for display
  formatDate(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleDateString();
  }

  private formatPreviewContent(content: string): string {
    // Escape HTML to prevent XSS
    const escaped = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    // Convert URLs to clickable links
    const withLinks = escaped.replace(
      /(https?:\/\/[^\s]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" class="preview-link">$1</a>'
    );

    // Convert line breaks to <br> tags
    const withLineBreaks = withLinks.replace(/\n/g, '<br>');

    // Convert nostr: references to a special format
    const withNostrRefs = withLineBreaks.replace(
      /nostr:([a-zA-Z0-9]+)/g,
      '<span class="nostr-ref">nostr:$1</span>'
    );

    return withNostrRefs;
  }

  // File upload functionality
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.uploadFiles(Array.from(input.files));
    }
    // Reset the input so the same file can be selected again
    input.value = '';
  }

  openFileDialog(): void {
    if (!this.fileInput?.nativeElement) {
      console.warn('File input not available. Make sure preview and advanced options are closed.');
      return;
    }

    // Check if user has media servers configured
    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    this.fileInput.nativeElement.click();
  }

  private hasConfiguredMediaServers(): boolean {
    return this.mediaService.mediaServers().length > 0;
  }

  private showMediaServerWarning(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'No Media Server Configured',
        message: 'You need to configure a media server before uploading files. Would you like to set one up now?',
        confirmText: 'Setup Media Server',
        cancelText: 'Cancel',
        confirmColor: 'primary',
      },
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        // Navigate to media library servers tab
        this.router.navigate(['/collections/media'], { queryParams: { tab: 'servers' } });
        // Close the note editor dialog
        this.dialogRef?.close({ published: false });
      }
    });
  }

  async openMediaChooser(): Promise<void> {
    // Check if user has media servers configured
    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    // Dynamically import the media chooser dialog
    const { MediaChooserDialogComponent } = await import('../media-chooser-dialog/media-chooser-dialog.component');
    type MediaChooserResult = import('../media-chooser-dialog/media-chooser-dialog.component').MediaChooserResult;

    const dialogRef = this.customDialog.open<typeof MediaChooserDialogComponent.prototype, MediaChooserResult>(MediaChooserDialogComponent, {
      title: 'Choose from Library',
      width: '700px',
      maxWidth: '95vw',
      data: {
        multiple: true,
        mediaType: 'all',
      },
    });

    dialogRef.afterClosed$.subscribe(({ result }) => {
      if (result?.items?.length) {
        // Add selected media items to the editor
        for (const item of result.items) {
          this.addExistingMediaToEditor(item);
        }
      }
    });
  }

  private addExistingMediaToEditor(item: { sha256: string; type: string; url: string; size: number }): void {
    // Add the media URL to the content
    const currentContent = this.content();
    const urlToAdd = item.url;

    // Check if URL is already in content
    if (currentContent.includes(urlToAdd)) {
      this.snackBar.open('This media is already in your note', 'Dismiss', { duration: 3000 });
      return;
    }

    // Add to media metadata for preview/imeta tags
    const currentMetadata = this.mediaMetadata();
    const alreadyAdded = currentMetadata.some(m => m.url === urlToAdd);

    if (!alreadyAdded) {
      this.mediaMetadata.set([
        ...currentMetadata,
        {
          url: urlToAdd,
          mimeType: item.type,
          sha256: item.sha256,
        },
      ]);
    }

    // Append URL to content
    const separator = currentContent.trim() ? '\n\n' : '';
    this.content.set(currentContent + separator + urlToAdd);

    this.snackBar.open('Media added to note', 'Dismiss', { duration: 2000 });
  }

  onDragEnter(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter++;
    if (this.dragCounter === 1) {
      this.isDragOver.set(true);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    // Don't change state here, just prevent default
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter--;
    if (this.dragCounter <= 0) {
      this.dragCounter = 0;
      this.isDragOver.set(false);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter = 0;
    this.isDragOver.set(false);

    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      this.uploadFiles(Array.from(event.dataTransfer.files));
    }
  }

  private async uploadFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;

    // Check if user has media servers configured
    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    this.isUploading.set(true);
    this.uploadStatus.set('Preparing upload...');

    try {
      // Load media service if not already loaded
      await this.mediaService.load();

      const totalFiles = files.length;
      let completedFiles = 0;

      const uploadPromises = files.map(async (file, index) => {
        try {
          const fileLabel = totalFiles > 1 ? ` (${index + 1}/${totalFiles})` : '';
          console.log(`Uploading file: ${file.name}, type: ${file.type}, size: ${file.size}`);

          // Pre-extract thumbnail for videos using the local file
          let thumbnailData:
            | {
              blob: Blob;
              dimensions: { width: number; height: number };
              blurhash: string | undefined;
              thumbhash: string | undefined;
            }
            | undefined;

          // Use the media service to get the correct MIME type
          const fileMimeType = this.mediaService.getFileMimeType(file);

          if (fileMimeType.startsWith('video/')) {
            try {
              this.uploadStatus.set(`Extracting video thumbnail${fileLabel}...`);

              // Create object URL from the local file for thumbnail extraction
              const localVideoUrl = URL.createObjectURL(file);

              // Extract thumbnail from the local video file
              const thumbnailResult = await this.utilities.extractThumbnailFromVideo(localVideoUrl, 1);

              // Generate placeholders (blurhash and/or thumbhash) from the thumbnail
              const thumbnailFile = new File([thumbnailResult.blob], 'thumbnail.jpg', {
                type: 'image/jpeg',
              });
              const placeholderResult = await this.imagePlaceholder.generatePlaceholders(thumbnailFile);

              thumbnailData = {
                blob: thumbnailResult.blob,
                dimensions: thumbnailResult.dimensions,
                blurhash: placeholderResult.blurhash,
                thumbhash: placeholderResult.thumbhash,
              };

              // Clean up the local object URL
              URL.revokeObjectURL(localVideoUrl);
              URL.revokeObjectURL(thumbnailResult.objectUrl);
            } catch (error) {
              console.error('Failed to extract video thumbnail:', error);
              // Continue with upload even if thumbnail extraction fails
            }
          }

          const isVideoUpload = fileMimeType.startsWith('video/');
          const uploadText = isVideoUpload && !this.uploadOriginal() ? 'Uploading and optimizing' : 'Uploading';
          this.uploadStatus.set(`${uploadText}${fileLabel}...`);
          const result = await this.mediaService.uploadFile(
            file,
            this.uploadOriginal(),
            this.mediaService.mediaServers()
          );

          console.log(`Upload result for ${file.name}:`, result);

          if (result.status === 'success' && result.item) {
            if (!this.isMediaMode()) {
              this.insertFileUrl(result.item.url);
            }

            this.uploadStatus.set(`Processing metadata${fileLabel}...`);

            // Extract metadata for imeta tag (NIP-92)
            const metadata = await this.extractMediaMetadata(
              file,
              result.item.url,
              result.item.sha256,
              result.item.mirrors, // Pass mirror URLs for fallback support
              thumbnailData // Pass pre-extracted thumbnail data for videos
            );
            if (metadata) {
              this.mediaMetadata.set([...this.mediaMetadata(), metadata]);
            }

            completedFiles++;
            if (completedFiles < totalFiles) {
              this.uploadStatus.set(`Completed ${completedFiles}/${totalFiles} files...`);
            }

            return { success: true, fileName: file.name };
          } else {
            console.error(`Upload failed for ${file.name}:`, result.message);
            completedFiles++;
            return {
              success: false,
              fileName: file.name,
              error: result.message || 'Upload failed',
            };
          }
        } catch (error) {
          console.error(`Upload error for ${file.name}:`, error);
          completedFiles++;
          return {
            success: false,
            fileName: file.name,
            error: error instanceof Error ? error.message : 'Upload failed',
          };
        }
      });

      const results = await Promise.all(uploadPromises);

      // Show success/error messages
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      if (successful.length > 0) {
        this.snackBar.open(`${successful.length} file(s) uploaded successfully`, 'Close', {
          duration: 3000,
        });
      }

      if (failed.length > 0) {
        // Show detailed error message for each failed file
        const errorMessages = failed
          .map(f => `${f.fileName}: ${f.error}`)
          .join('\n');

        this.snackBar.open(
          `Failed to upload ${failed.length} file(s):\n${errorMessages}`,
          'Close',
          {
            duration: 8000,
            panelClass: 'error-snackbar',
          }
        );
      }
    } catch (error) {
      this.snackBar.open(
        'Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
        'Close',
        {
          duration: 5000,
          panelClass: 'error-snackbar',
        }
      );
    } finally {
      this.isUploading.set(false);
      this.uploadStatus.set('');
    }
  }

  setMediaMode(enabled: boolean): void {
    this.isMediaMode.set(enabled);

    let currentContent = this.content();
    const mediaUrls = this.mediaMetadata().map(m => m.url);

    if (enabled) {
      // Remove URLs
      mediaUrls.forEach(url => {
        // Escape special regex characters in URL
        const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Create global regex
        const regex = new RegExp(escapedUrl, 'g');
        currentContent = currentContent.replace(regex, '').trim();
      });
    } else {
      // Add URLs if missing
      mediaUrls.forEach(url => {
        if (!currentContent.includes(url)) {
          currentContent += (currentContent ? '\n' : '') + url;
        }
      });
    }
    this.content.set(currentContent);
  }

  private insertFileUrl(url: string): void {
    const currentContent = this.content();
    const textarea = this.contentTextarea.nativeElement;
    const cursorPosition = textarea.selectionStart;

    // Insert URL at cursor position with some spacing
    const beforeCursor = currentContent.substring(0, cursorPosition);
    const afterCursor = currentContent.substring(cursorPosition);

    // Add spacing around the URL if needed
    const needsSpaceBefore =
      beforeCursor.length > 0 && !beforeCursor.endsWith(' ') && !beforeCursor.endsWith('\n');
    const needsSpaceAfter =
      afterCursor.length > 0 && !afterCursor.startsWith(' ') && !afterCursor.startsWith('\n');

    const prefix = needsSpaceBefore ? ' ' : '';
    const suffix = needsSpaceAfter ? ' ' : '';

    const newContent = beforeCursor + prefix + url + suffix + afterCursor;
    this.content.set(newContent);

    // Restore cursor position after the inserted URL
    setTimeout(() => {
      const newCursorPosition = cursorPosition + prefix.length + url.length + suffix.length;
      textarea.setSelectionRange(newCursorPosition, newCursorPosition);
      textarea.focus();
    }, 0);
  }

  private setupPasteHandler(): void {
    if (this.contentTextarea) {
      this.contentTextarea.nativeElement.addEventListener('paste', this.handlePaste.bind(this));
    }
  }

  private handlePaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;

    let hasImageFile = false;
    const imageFiles: File[] = [];

    // Check for image files in clipboard
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && this.isImageFile(file)) {
          hasImageFile = true;
          imageFiles.push(file);
        }
      }
    }

    // If we found image files, prevent default behavior and upload them
    if (hasImageFile && imageFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      this.uploadFiles(imageFiles);
      return;
    }

    // Check for NIP-19 identifiers in text and auto-prefix with nostr:
    let text = event.clipboardData?.getData('text/plain');
    if (text) {
      // Check if tracking parameter removal is enabled and clean URLs
      // For performance, only process text up to 10KB (most pastes are much smaller)
      if (this.localSettings.removeTrackingParameters() && text.length < 10000) {
        const cleanedText = cleanTrackingParametersFromText(text);
        if (cleanedText !== text) {
          // Text was modified, prevent default paste and insert cleaned text
          event.preventDefault();
          event.stopPropagation();
          text = cleanedText;
          this.insertCleanedText(text);
          return;
        }
      }

      // Check for NIP-19 identifiers and auto-prefix with nostr:
      if (this.containsNip19Identifier(text)) {
        event.preventDefault();
        event.stopPropagation();
        this.insertTextWithNostrPrefix(text);
        return;
      }
    }

    // If no image files or NIP-19 identifiers, allow normal text pasting
  }

  private isImageFile(file: File): boolean {
    // Check if the file is an image by MIME type
    if (file.type.startsWith('image/')) {
      return true;
    }

    // Additional check by file extension as fallback
    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|avif|heic|heif)$/i;
    return imageExtensions.test(file.name);
  }

  /**
   * Extract media metadata for NIP-92 imeta tags
   * Generates blurhash/thumbhash and dimensions for images
   * For videos: extracts thumbnail, generates placeholders from thumbnail
   * @param file Original file object
   * @param url Uploaded media URL
   * @param sha256 SHA-256 hash of the media
   * @param mirrors Mirror URLs for the media
   * @param thumbnailData Optional pre-extracted thumbnail data for videos
   */
  private async extractMediaMetadata(
    file: File,
    url: string,
    sha256?: string,
    mirrors?: string[],
    thumbnailData?: {
      blob: Blob;
      dimensions: { width: number; height: number };
      blurhash?: string;
      thumbhash?: string;
    }
  ): Promise<MediaMetadata | null> {
    try {
      // Use the media service to get the correct MIME type (handles .mpga, etc.)
      const mimeType = this.mediaService.getFileMimeType(file);

      const metadata: MediaMetadata = {
        url,
        mimeType,
        sha256, // Include SHA-256 hash if provided
        fallbackUrls: mirrors && mirrors.length > 0 ? mirrors : undefined, // Add mirror URLs as fallbacks
      };

      // Handle images - use imagePlaceholder service for both blurhash and thumbhash
      if (mimeType.startsWith('image/')) {
        const placeholders = await this.imagePlaceholder.generatePlaceholders(file);
        metadata.blurhash = placeholders.blurhash;
        metadata.thumbhash = placeholders.thumbhash;
        metadata.dimensions = placeholders.dimensions;
        // Add mirrors as fallback URLs
        if (mirrors && mirrors.length > 0) {
          metadata.fallbackUrls = mirrors;
        }
        return metadata;
      }

      // Handle videos - use pre-extracted thumbnail data if available
      if (mimeType.startsWith('video/') && thumbnailData) {
        try {
          // Upload the thumbnail blob to get a permanent URL
          const thumbnailFile = new File([thumbnailData.blob], 'thumbnail.jpg', {
            type: 'image/jpeg',
          });

          const uploadResult = await this.mediaService.uploadFile(
            thumbnailFile,
            false, // Don't upload original for thumbnails
            this.mediaService.mediaServers()
          );

          if (uploadResult.status === 'success' && uploadResult.item) {
            // Use 'image' field for preview capture (NIP-94)
            metadata.image = uploadResult.item.url;
            metadata.blurhash = thumbnailData.blurhash;
            metadata.thumbhash = thumbnailData.thumbhash;
            metadata.dimensions = thumbnailData.dimensions;

            // Add thumbnail mirrors if available
            if (uploadResult.item.mirrors && uploadResult.item.mirrors.length > 0) {
              metadata.imageMirrors = uploadResult.item.mirrors;
            }
          } else {
            console.warn('Failed to upload video thumbnail:', uploadResult.message);
          }
        } catch (error) {
          console.error('Failed to upload video thumbnail:', error);
          // Continue without thumbnail - basic metadata is still useful
        }
      }

      return metadata;
    } catch (error) {
      console.error('Failed to extract media metadata:', error);
      // Return basic metadata even if processing fails
      return {
        url,
        mimeType: this.mediaService.getFileMimeType(file),
        fallbackUrls: mirrors && mirrors.length > 0 ? mirrors : undefined,
      };
    }
  }

  /**
   * Check if text contains NIP-19 identifiers that need nostr: prefix
   * Matches: note1, nevent1, npub1, nprofile1, naddr1, nsec1
   */
  private containsNip19Identifier(text: string): boolean {
    const nip19Pattern = /\b(note1|nevent1|npub1|nprofile1|naddr1|nsec1)[a-zA-Z0-9]+\b/;
    return nip19Pattern.test(text);
  }

  /**
   * Check if the new content already exists in the current draft content.
   * Handles nostr: URIs (naddr, nevent, note, npub, nprofile) and regular URLs.
   * For nostr: URIs, extracts the identifier and checks if it's present anywhere in the draft.
   */
  private contentAlreadyExists(currentContent: string, newContent: string): boolean {
    if (!currentContent || !newContent) {
      return false;
    }

    // Direct check - if the exact content already exists
    if (currentContent.includes(newContent)) {
      return true;
    }

    // Extract nostr: URIs from new content and check if they exist in current content
    const nostrUriPattern = /nostr:(note1|nevent1|npub1|nprofile1|naddr1)[a-zA-Z0-9]+/g;
    const nostrUris = newContent.match(nostrUriPattern);

    if (nostrUris) {
      for (const uri of nostrUris) {
        if (currentContent.includes(uri)) {
          return true;
        }
        // Also check without the nostr: prefix (in case it was added differently)
        const identifier = uri.replace('nostr:', '');
        if (currentContent.includes(identifier)) {
          return true;
        }
      }
    }

    // Check for bare NIP-19 identifiers (without nostr: prefix) and see if they exist with prefix
    const bareNip19Pattern = /\b(note1|nevent1|npub1|nprofile1|naddr1)([a-zA-Z0-9]+)\b/g;
    const bareIdentifiers = newContent.match(bareNip19Pattern);

    if (bareIdentifiers) {
      for (const identifier of bareIdentifiers) {
        if (currentContent.includes(identifier) || currentContent.includes(`nostr:${identifier}`)) {
          return true;
        }
      }
    }

    // Check for regular URLs
    const urlPattern = /https?:\/\/[^\s]+/g;
    const urls = newContent.match(urlPattern);

    if (urls) {
      for (const url of urls) {
        if (currentContent.includes(url)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Insert text with NIP-19 identifiers automatically prefixed with nostr:
   * According to NIP-27, all references should be in the format nostr:<identifier>
   */
  private insertTextWithNostrPrefix(text: string): void {
    const textarea = this.contentTextarea.nativeElement;
    const cursorPosition = textarea.selectionStart || 0;
    const currentContent = this.content();

    // Replace NIP-19 identifiers with nostr: prefix if not already present
    // This regex matches NIP-19 identifiers that don't already have nostr: prefix
    // and are not part of a URL (preceded by /)
    const processedText = text.replace(
      /(?<!nostr:)(?<!\/)(\b(note1|nevent1|npub1|nprofile1|naddr1|nsec1)([a-zA-Z0-9]+)\b)/g,
      'nostr:$1'
    );

    // Insert the processed text at cursor position
    const newContent =
      currentContent.substring(0, cursorPosition) +
      processedText +
      currentContent.substring(cursorPosition);

    this.content.set(newContent);

    // Restore cursor position after the inserted text
    setTimeout(() => {
      const newCursorPosition = cursorPosition + processedText.length;
      textarea.setSelectionRange(newCursorPosition, newCursorPosition);
      textarea.focus();
    }, 0);
  }

  /**
   * Insert cleaned text (with tracking parameters removed)
   */
  private insertCleanedText(text: string): void {
    const textarea = this.contentTextarea.nativeElement;
    const cursorPosition = textarea.selectionStart || 0;
    const currentContent = this.content();

    // Insert the cleaned text at cursor position
    const newContent =
      currentContent.substring(0, cursorPosition) +
      text +
      currentContent.substring(cursorPosition);

    this.content.set(newContent);

    // Restore cursor position after the inserted text
    setTimeout(() => {
      const newCursorPosition = cursorPosition + text.length;
      textarea.setSelectionRange(newCursorPosition, newCursorPosition);
      textarea.focus();
    }, 0);
  }

  // Proof of Work methods
  onPowDifficultySliderChange(value: number): void {
    this.powTargetDifficulty.set(value);
    const enabled = value > 0;
    this.powEnabled.set(enabled);

    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setPowEnabled(pubkey, enabled);
      if (enabled) {
        this.accountLocalState.setPowTargetDifficulty(pubkey, value);
      }
    }

    if (!enabled) {
      this.stopPow();
      this.powMinedEvent.set(null);
      this.powService.reset();
    }
  }

  async startPow(): Promise<void> {
    if (!this.content().trim()) {
      this.snackBar.open('Please enter some content first', 'Close', { duration: 3000 });
      return;
    }

    try {
      // Build the base event
      const tags = this.buildTags();
      const contentToPublish = this.processContentForPublishing(this.content().trim());
      const baseEvent = this.nostrService.createEvent(1, contentToPublish, tags);

      // Start mining
      this.snackBar.open('Starting Proof-of-Work mining...', 'Close', { duration: 2000 });

      const result = await this.powService.mineEvent(
        baseEvent,
        this.powTargetDifficulty(),
        (progress: PowProgress) => {
          this.powProgress.set(progress);
        }
      );

      if (result && result.event) {
        this.powMinedEvent.set(result.event);
        this.snackBar.open(
          `Mining complete! Achieved difficulty: ${result.difficulty} bits (${result.attempts.toLocaleString()} attempts)`,
          'Close',
          { duration: 5000 }
        );
      } else if (!this.powService.isRunning()) {
        // Mining was stopped by user
        const bestEvent = this.powProgress().bestEvent;
        if (bestEvent) {
          this.powMinedEvent.set(bestEvent);
          this.snackBar.open(
            `Mining stopped. Best difficulty: ${this.powProgress().difficulty} bits`,
            'Close',
            { duration: 5000 }
          );
        }
      }
    } catch (error) {
      console.error('Error during PoW mining:', error);
      this.snackBar.open('Error during Proof-of-Work mining', 'Close', { duration: 5000 });
    }
  }

  stopPow(): void {
    this.powService.stop();
    const bestEvent = this.powProgress().bestEvent;
    if (bestEvent) {
      this.powMinedEvent.set(bestEvent);
      this.snackBar.open(
        `Mining stopped. Best difficulty: ${this.powProgress().difficulty} bits`,
        'Close',
        { duration: 3000 }
      );
    }
  }

  resetPow(): void {
    this.powService.reset();
    this.powMinedEvent.set(null);
    this.powProgress.set({
      difficulty: 0,
      nonce: 0,
      attempts: 0,
      isRunning: false,
      bestEvent: null,
    });
  }

  // Zap split methods
  onZapSplitToggle(enabled: boolean): void {
    this.zapSplitEnabled.set(enabled);
    // Persist to account state
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setZapSplitEnabled(pubkey, enabled);
    }
  }

  onZapSplitOriginalChange(value: number): void {
    this.updateZapSplitPercentages(value, 'original');
  }

  onZapSplitQuoterChange(value: number): void {
    this.updateZapSplitPercentages(value, 'quoter');
  }

  private updateZapSplitPercentages(value: number, changedSlider: 'original' | 'quoter'): void {
    // Ensure the total is always 100%
    const complement = 100 - value;

    if (changedSlider === 'original') {
      this.zapSplitOriginalPercent.set(value);
      this.zapSplitQuoterPercent.set(complement);
    } else {
      this.zapSplitQuoterPercent.set(value);
      this.zapSplitOriginalPercent.set(complement);
    }

    // Persist to account state
    const pubkey = this.accountState.pubkey();
    if (pubkey) {
      this.accountLocalState.setZapSplitOriginalPercent(pubkey, this.zapSplitOriginalPercent());
      this.accountLocalState.setZapSplitQuoterPercent(pubkey, this.zapSplitQuoterPercent());
    }
  }

  openAiDialog(action: 'generate' | 'translate' | 'sentiment' = 'generate') {
    const dialogRef = this.dialog.open(AiToolsDialogComponent, {
      data: { content: this.content(), initialAction: action },
      width: '500px'
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.content.set(result);
      }
    });
  }

  async toggleRecording() {
    if (this.isRecording()) {
      this.speechService.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  async startRecording() {
    // Save current content for undo
    this.recordingHistory.push(this.content());

    await this.speechService.startRecording({
      silenceDuration: 3000,
      onRecordingStateChange: (isRecording) => {
        this.isRecording.set(isRecording);
      },
      onTranscribingStateChange: (isTranscribing) => {
        this.isTranscribing.set(isTranscribing);
      },
      onTranscription: (text) => {
        const currentContent = this.content();
        const newContent = currentContent ? currentContent + ' ' + text : text;
        this.content.set(newContent);
        this.adjustTextareaHeight();
      }
    });
  }

  stopRecording() {
    this.speechService.stopRecording();
  }

  undoLastRecording() {
    const prevContent = this.recordingHistory.pop();
    if (prevContent !== undefined) {
      this.content.set(prevContent);
      this.adjustTextareaHeight();
    }
  }

  adjustTextareaHeight(): void {
    if (this.contentTextarea) {
      const textarea = this.contentTextarea.nativeElement;
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
    }
  }

  private processContentForPublishing(content: string): string {
    let processed = content;

    // Sort entries by key length descending to handle prefixes correctly
    const sortedEntries = Array.from(this.mentionMap.entries()).sort((a, b) => b[0].length - a[0].length);

    for (const [name, uri] of sortedEntries) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedName, 'g');
      processed = processed.replace(regex, uri);
    }
    return processed;
  }

  getMentionDisplayName(pubkey: string): string {
    const name = this.pubkeyToNameMap.get(pubkey);
    if (name) return name;
    return pubkey.slice(0, 16) + '...';
  }

  /**
   * Load profile name for a pubkey and add it to the pubkeyToNameMap
   * Used for displaying proper names in the "Mentioning:" section
   */
  private async loadMentionProfileName(pubkey: string): Promise<void> {
    // Skip if already loaded
    if (this.pubkeyToNameMap.has(pubkey)) return;

    try {
      const profile = await this.dataService.getProfile(pubkey);
      if (profile?.data) {
        const name = profile.data.display_name || profile.data.name || profile.data.username;
        if (name) {
          this.pubkeyToNameMap.set(pubkey, name);
          // Trigger change detection by re-setting mentions
          this.mentions.set([...this.mentions()]);
        }
      }
    } catch (error) {
      console.error('Failed to load profile name for mention:', error);
    }
  }
}
