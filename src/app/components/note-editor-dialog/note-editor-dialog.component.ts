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
  DestroyRef,
  afterNextRender,
  input,
  output,
  ChangeDetectionStrategy,
  effect,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { CustomDialogRef, CustomDialogService } from '../../services/custom-dialog.service';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
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
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { DomSanitizer } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';

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
import { SlashCommandMenuComponent, SlashCommandConfig, SlashCommandOption } from '../slash-command-menu/slash-command-menu.component';
import { MentionInputService, MentionDetectionResult } from '../../services/mention-input.service';
import { UtilitiesService } from '../../services/utilities.service';
import { PublishEventBus, PublishRelayResultEvent } from '../../services/publish-event-bus.service';
import { Subscription } from 'rxjs';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { AiService } from '../../services/ai.service';
import { AiToolsDialogComponent } from '../ai-tools-dialog/ai-tools-dialog.component';
import { cleanTrackingParametersFromText } from '../../utils/url-cleaner';
import { DataService } from '../../services/data.service';
import { ImagePlaceholderService } from '../../services/image-placeholder.service';
import { NoteEditorDialogData } from '../../interfaces/note-editor';
import { SpeechService } from '../../services/speech.service';
import { PlatformService } from '../../services/platform.service';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { HapticsService } from '../../services/haptics.service';
import { SettingsService } from '../../services/settings.service';
import { XDualPostService, XPostMediaItem } from '../../services/x-dual-post.service';
import { MediaProcessingService } from '../../services/media-processing.service';
import {
  DEFAULT_MEDIA_UPLOAD_SETTINGS,
  getMediaOptimizationDescription,
  getMediaOptimizationOption,
  getMediaUploadSettingsForOptimization,
  getVideoOptimizationProfileBadgeLabel,
  getVideoOptimizationProfileLabel,
  MEDIA_OPTIMIZATION_OPTIONS,
  MediaUploadMode,
  shouldUploadOriginal,
  VIDEO_OPTIMIZATION_PROFILE_OPTIONS,
  usesLocalCompression as usesLocalCompressionMode,
  type MediaOptimizationOptionValue,
  type MediaUploadSettings,
  type VideoOptimizationProfile,
} from '../../interfaces/media-upload';
import { MaterialCustomDialogComponent } from '../material-custom-dialog/material-custom-dialog.component';

// Re-export for backward compatibility
export type { NoteEditorDialogData } from '../../interfaces/note-editor';

interface NoteEditorDialogResult {
  published: boolean;
  event?: NostrEvent;
}

interface EditableContentElement extends HTMLDivElement {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  setSelectionRange(start: number, end: number): void;
  __nostriaEditorBridge?: boolean;
}

interface EditorSelectionRange {
  start: number;
  end: number;
}

interface EditorMediaSegment {
  type: 'text' | 'media' | 'event';
  value: string;
  media?: MediaMetadata;
  referencePreview?: ComposerReferencePreview;
}

const INLINE_MEDIA_DRAG_TYPE = 'application/x-nostria-inline-media';

interface MediaMetadata {
  id?: string;
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
  previewUrl?: string; // Local preview URL for pending images
  placeholderToken?: string; // Placeholder inserted into the editor until publish
  pendingUpload?: boolean;
  fileName?: string;
  originalSize?: number;
  processedSize?: number;
  optimizedSize?: number;
  videoOptimizationProfile?: VideoOptimizationProfile;
  localFile?: File;
  sourceFile?: File;
  uploadOriginal?: boolean;
  warningMessage?: string;
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
  uploadOriginal?: boolean;
  uploadMode?: MediaUploadMode;
  compressionStrength?: number;
  videoOptimizationProfile?: VideoOptimizationProfile;
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

interface XPostValidation {
  valid: boolean;
  message: string;
}

interface PreparedXPost {
  id: string;
  url: string;
}

interface SentimentAnalysisResult {
  label: string;
  score: number;
}

interface SentimentHeaderState {
  kind: 'loading' | 'result' | 'error';
  icon: string;
  text: string;
  score?: number;
}

interface ComposerMentionPreview {
  mention: string;
  pubkey: string;
  displayName: string;
}

interface ComposerMediaPreview {
  id: string;
  url: string;
  thumbnailUrl: string;
  mimeType?: string;
  pending: boolean;
  label: string;
}

interface ComposerReferencePreview {
  id: string;
  type: 'event' | 'profile' | 'address' | 'link';
  value: string;
  label: string;
  secondaryLabel?: string;
}

@Component({
  selector: 'app-note-editor-dialog',
  imports: [
    NgTemplateOutlet,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatCheckboxModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatSliderModule,
    ContentComponent,
    MentionAutocompleteComponent,
    SlashCommandMenuComponent,
    MatMenuModule,
    UserProfileComponent,
    MaterialCustomDialogComponent,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './note-editor-dialog.component.html',
  styleUrl: './note-editor-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onHostKeyDown($event)',
    '[class.inline-mode]': 'inlineMode()',
    '[class.collapsed]': 'inlineMode() && !isExpanded()',
    '[class.keyboard-compact-mode]': 'isKeyboardCompactMode()',
  },
})
export class NoteEditorDialogComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly xHeaderIconUrl = '/logos/clients/x.png';
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
  private materialDialogRef = inject(MatDialogRef<NoteEditorDialogComponent, NoteEditorDialogResult>, { optional: true });
  private materialDialogData = inject<NoteEditorDialogData | null>(MAT_DIALOG_DATA, { optional: true });

  dialogRef?: CustomDialogRef<NoteEditorDialogComponent, NoteEditorDialogResult>
    | MatDialogRef<NoteEditorDialogComponent, NoteEditorDialogResult>;
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
  layout = inject(LayoutService);
  private powService = inject(PowService);
  private mentionInputService = inject(MentionInputService);
  private dataService = inject(DataService);
  private utilities = inject(UtilitiesService);
  private imagePlaceholder = inject(ImagePlaceholderService);
  private publishEventBus = inject(PublishEventBus);
  private mediaProcessing = inject(MediaProcessingService);
  private publishSubscription?: Subscription;
  private pendingMediaOptimizationRunId = 0;
  private pendingVideoProfileMenuTimeout: ReturnType<typeof setTimeout> | null = null;
  private suppressThumbnailClickUntil = 0;
  private readonly VIDEO_PROFILE_MENU_HOLD_DELAY = 450;
  private readonly handleViewportResize = (): void => {
    const textarea = this.contentTextarea?.nativeElement;
    const isFocusedCompactTextarea = this.platformService.isIOS()
      && this.isCompactDialogLayout()
      && !!textarea
      && typeof document !== 'undefined'
      && document.activeElement === textarea;

    if (isFocusedCompactTextarea) {
      if (this.viewportResizeTimeout !== null) {
        clearTimeout(this.viewportResizeTimeout);
      }

      this.viewportResizeTimeout = setTimeout(() => {
        this.viewportResizeTimeout = null;
        requestAnimationFrame(() => {
          this.updateKeyboardCompactMode();
          this.scheduleTextareaRefresh(undefined, false, false, false, false);
        });
      }, 80);
      return;
    }

    this.updateKeyboardCompactMode();
    this.scheduleTextareaRefresh();
  };
  private dialog = inject(MatDialog);
  private customDialog = inject(CustomDialogService);
  private aiService = inject(AiService);
  private speechService = inject(SpeechService);
  private platformService = inject(PlatformService);
  private haptics = inject(HapticsService);
  private syncedSettings = inject(SettingsService);
  xDualPost = inject(XDualPostService);
  private destroyRef = inject(DestroyRef);

  private shouldNavigateAfterPublish(): boolean {
    if (this.data?.navigateOnPublish === false) {
      return false;
    }

    // Don't navigate away when posting a reply — the thread view's
    // publishEventBus subscription will add the reply in-place.
    if (this.data?.replyTo) {
      return false;
    }

    return true;
  }

  @ViewChild('contentTextarea')
  contentTextarea!: ElementRef<EditableContentElement>;
  @ViewChild('contentField') contentField?: ElementRef<HTMLElement>;
  @ViewChild('noteEditorLayout') noteEditorLayout?: ElementRef<HTMLElement>;
  @ViewChild('dialogContentWrapper') dialogContentWrapper?: ElementRef<HTMLElement>;
  @ViewChild('composerActions') composerActions?: ElementRef<HTMLElement>;
  @ViewChild('backFromPreviewBtn', { read: ElementRef }) backFromPreviewBtn?: ElementRef<HTMLElement>;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('videoProfileMenuTrigger', { read: MatMenuTrigger }) videoProfileMenuTrigger?: MatMenuTrigger;
  @ViewChild(MentionAutocompleteComponent) mentionAutocomplete?: MentionAutocompleteComponent;
  @ViewChild(SlashCommandMenuComponent) slashCommandMenu?: SlashCommandMenuComponent;

  // Auto-save configuration
  private readonly AUTO_SAVE_INTERVAL = 2000; // Save every 2 seconds
  private autoSaveTimer?: ReturnType<typeof setTimeout>;
  private contentCheckIntervalHandle?: ReturnType<typeof setInterval>;
  private otherChangesIntervalHandle?: ReturnType<typeof setInterval>;
  private textareaRefreshFrame: number | null = null;
  private viewportResizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingMenuOpenTimeout: ReturnType<typeof setTimeout> | null = null;
  private viewportHeightBaseline = 0;
  private editorBridgeReady = signal(false);
  private draggedInlineMediaToken: string | null = null;

  // Signals for reactive state
  content = signal('');
  mentions = signal<string[]>([]);

  // Maps for mention handling
  private mentionMap = new Map<string, string>(); // @name -> nostr:uri
  private pubkeyToNameMap = new Map<string, string>(); // pubkey -> name

  showPreview = signal(false);
  showAdvancedOptions = signal(false);
  useNewEditorExperience = computed(() => this.localSettings.noteEditorNewExperience());
  isContentFocused = signal(false);
  isKeyboardCompactMode = signal(false);
  private lastCursorPosition: number | null = null;
  private pendingMediaInsertionAnchors = new Map<string, number>();
  isDragOver = signal(false);
  isUploading = signal(false);
  uploadStatus = signal(''); // Detailed upload status message
  dragCounter = 0;
  isPublishing = signal(false);
  isRecording = signal(false);
  isTranscribing = signal(false);
  isSentimentAnalyzing = signal(false);
  sentimentResult = signal<SentimentAnalysisResult | null>(null);
  sentimentError = signal('');
  private sentimentRequestedText = signal('');
  private sentimentResultText = signal('');

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
  private xPostingChoiceInitialized = false;

  // Media metadata for imeta tags (NIP-92)
  mediaMetadata = signal<MediaMetadata[]>([]);
  hasPendingMedia = computed(() => this.mediaMetadata().some(media => media.pendingUpload));
  hasPendingVideoMedia = computed(() =>
    this.mediaMetadata().some(media => media.pendingUpload && media.mimeType?.startsWith('video/'))
  );

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

  // Slash command menu state
  slashCommandConfig = signal<SlashCommandConfig | null>(null);
  slashCommandPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });

  // Advanced options
  expirationEnabled = signal(false);
  expirationDate = signal<Date | null>(null);
  expirationTime = signal<string>('12:00');
  readonly mediaOptimizationOptions = MEDIA_OPTIMIZATION_OPTIONS;
  readonly videoOptimizationProfileOptions = VIDEO_OPTIMIZATION_PROFILE_OPTIONS;
  mediaUploadMode = signal<MediaUploadMode>(DEFAULT_MEDIA_UPLOAD_SETTINGS.mode);
  compressionStrength = signal<number>(DEFAULT_MEDIA_UPLOAD_SETTINGS.compressionStrength);
  videoOptimizationProfile = signal<VideoOptimizationProfile>(DEFAULT_MEDIA_UPLOAD_SETTINGS.videoOptimizationProfile ?? 'default');
  videoProfileMenuPosition = signal<{ x: number; y: number }>({ x: 0, y: 0 });
  videoProfileMenuMediaId = signal<string | null>(null);
  uploadOriginal = computed(() => shouldUploadOriginal(this.mediaUploadMode()));
  usesLocalCompression = computed(() => usesLocalCompressionMode(this.mediaUploadMode()));
  selectedMediaOptimization = computed(() =>
    getMediaOptimizationOption(this.mediaUploadMode(), this.compressionStrength())
  );
  selectedMediaOptimizationDescription = computed(() =>
    getMediaOptimizationDescription(this.mediaUploadMode(), this.compressionStrength(), this.videoOptimizationProfile())
  );
  addClientTag = signal(true); // Default to true, will be set from user preference in constructor
  postToX = signal(false);

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
    const xPostValid = this.xPostValidation().valid;

    // Check expiration validation
    let expirationValid = true;
    if (this.expirationEnabled()) {
      const expirationDateTime = this.getExpirationDateTime();
      expirationValid = expirationDateTime !== null && expirationDateTime > new Date();
    }

    return hasContent && notPublishing && notUploading && expirationValid && xPostValid;
  });

  sentimentHeaderState = computed<SentimentHeaderState | null>(() => {
    const currentContent = this.content().trim();
    if (!currentContent) {
      return null;
    }

    if (this.isSentimentAnalyzing() && this.sentimentRequestedText() === currentContent) {
      return {
        kind: 'loading',
        icon: 'hourglass_empty',
        text: 'Analyzing sentiment...',
      };
    }

    if (this.sentimentError() && this.sentimentResultText() === currentContent) {
      return {
        kind: 'error',
        icon: 'error',
        text: this.sentimentError(),
      };
    }

    const result = this.sentimentResult();
    if (!result || this.sentimentResultText() !== currentContent) {
      return null;
    }

    const label = this.formatSentimentLabel(result.label);
    const score = Math.round(result.score * 100);

    return {
      kind: 'result',
      icon: result.label === 'NEGATIVE' ? 'sentiment_dissatisfied' : 'sentiment_satisfied',
      text: `${label} ${score}%`,
      score,
    };
  });

  xPostValidation = computed<XPostValidation>(() => {
    if (!this.postToX()) {
      return { valid: true, message: '' };
    }

    if (!this.xPremiumEligible()) {
      return {
        valid: false,
        message: 'Post to X is available for Premium+ accounts only.',
      };
    }

    if (this.isEdit()) {
      return {
        valid: false,
        message: 'Editing existing notes cannot be mirrored to X yet.',
      };
    }

    if (this.hasReplyTarget()) {
      return {
        valid: false,
        message: 'Replies are not posted to X. Only original posts can use Post to X.',
      };
    }

    if (this.xStatusLoading()) {
      return {
        valid: false,
        message: 'Checking X connection...',
      };
    }

    if (!this.xDualPost.status().connected) {
      return {
        valid: false,
        message: 'Connect your X account before enabling Post to X.',
      };
    }

    const mediaItems = this.getXMediaItems();
    if (mediaItems.length === 0) {
      return { valid: true, message: '' };
    }

    const imageCount = mediaItems.filter(item => item.mimeType?.startsWith('image/') && item.mimeType !== 'image/gif').length;
    const videoOrGifCount = mediaItems.filter(item => item.mimeType?.startsWith('video/') || item.mimeType === 'image/gif').length;

    if (imageCount > 0 && videoOrGifCount > 0) {
      return {
        valid: false,
        message: 'Post to X supports either up to 4 images or 1 video/GIF, but not both in the same post.',
      };
    }

    if (imageCount > 4) {
      return {
        valid: false,
        message: 'Post to X supports up to 4 images per post.',
      };
    }

    if (videoOrGifCount > 1) {
      return {
        valid: false,
        message: 'Post to X supports only 1 video or GIF per post.',
      };
    }

    return { valid: true, message: '' };
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

    return this.buildPreviewContent(true);
  });

  composerMentionPreviews = computed<ComposerMentionPreview[]>(() => {
    const currentContent = this.content();
    const previews: ComposerMentionPreview[] = [];

    for (const [mention, uri] of this.mentionMap.entries()) {
      if (!currentContent.includes(mention)) {
        continue;
      }

      const pubkey = this.extractPubkeyFromMentionUri(uri);
      if (!pubkey) {
        continue;
      }

      previews.push({
        mention,
        pubkey,
        displayName: this.getMentionDisplayName(pubkey),
      });
    }

    return previews;
  });

  composerMediaPreviews = computed<ComposerMediaPreview[]>(() => this.mediaMetadata().map((media, index) => ({
    id: media.id || media.placeholderToken || media.url || `media-${index}`,
    url: media.url,
    thumbnailUrl: this.getMediaThumbnailUrl(media),
    mimeType: media.mimeType,
    pending: !!media.pendingUpload,
    label: media.fileName
      || (media.mimeType?.startsWith('video/') ? 'Video attachment' : 'Image attachment'),
  })));

  composerReferencePreviews = computed<ComposerReferencePreview[]>(() => {
    const preview = this.buildPreviewContent(false);
    if (!preview.trim()) {
      return [];
    }

    const matches = preview.match(/(?:nostr:)?(?:npub|nprofile|note|nevent|naddr)1[a-zA-Z0-9]+|https?:\/\/[^\s]+/g) || [];
    const seen = new Set<string>();
    const references: ComposerReferencePreview[] = [];

    for (const match of matches) {
      if (seen.has(match) || this.isComposerMentionReference(match) || this.isComposerMediaReference(match)) {
        continue;
      }

      const previewItem = this.buildComposerReferencePreview(match);
      if (!previewItem) {
        continue;
      }

      if (this.useNewEditorExperience() && previewItem.type === 'event') {
        continue;
      }

      seen.add(match);
      references.push(previewItem);
    }

    return references;
  });

  showInlineEmbeds = computed(() => {
    if (this.showPreview() || this.showAdvancedOptions()) {
      return false;
    }

    if (this.composerMediaPreviews().length > 0) {
      return this.composerMentionPreviews().length > 0;
    }

    return this.composerMentionPreviews().length > 0
      || this.composerReferencePreviews().length > 0;
  });

  private buildPreviewContent(includeEmptyPlaceholder: boolean): string {
    const content = this.resolvePendingMediaReferences(this.content(), true);

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

    if (!content.trim()) return includeEmptyPlaceholder ? 'Nothing to preview...' : '';

    return this.processContentForPublishing(content);
  }

  private extractPubkeyFromMentionUri(uri: string): string | null {
    const normalized = uri.startsWith('nostr:') ? uri.slice(6) : uri;

    try {
      const decoded = nip19.decode(normalized);
      if (decoded.type === 'npub') {
        return decoded.data as string;
      }

      if (decoded.type === 'nprofile') {
        return (decoded.data as { pubkey: string }).pubkey;
      }
    } catch {
      // Ignore invalid mention URIs in preview extraction
    }

    return null;
  }

  private isComposerMentionReference(reference: string): boolean {
    return Array.from(this.mentionMap.values()).some(uri => uri === reference || `nostr:${uri.replace(/^nostr:/, '')}` === reference);
  }

  private isComposerMediaReference(reference: string): boolean {
    return this.mediaMetadata().some(media => {
      const previewUrl = this.getPendingMediaPreviewReference(media);
      return media.url === reference
        || media.previewUrl === reference
        || previewUrl === reference
        || this.getMediaThumbnailUrl(media) === reference;
    });
  }

  private buildComposerReferencePreview(reference: string): ComposerReferencePreview | null {
    if (reference.startsWith('http://') || reference.startsWith('https://')) {
      try {
        const url = new URL(reference);
        return {
          id: reference,
          type: 'link',
          value: reference,
          label: url.hostname,
          secondaryLabel: url.pathname === '/' ? undefined : url.pathname,
        };
      } catch {
        return {
          id: reference,
          type: 'link',
          value: reference,
          label: reference,
        };
      }
    }

    const normalized = reference.startsWith('nostr:') ? reference.slice(6) : reference;

    try {
      const decoded = nip19.decode(normalized);
      if (decoded.type === 'note' || decoded.type === 'nevent') {
        const eventId = decoded.type === 'note' ? decoded.data as string : (decoded.data as { id: string }).id;
        return {
          id: reference,
          type: 'event',
          value: reference,
          label: 'Embedded event',
          secondaryLabel: `${eventId.slice(0, 10)}...`,
        };
      }

      if (decoded.type === 'npub' || decoded.type === 'nprofile') {
        const pubkey = decoded.type === 'npub' ? decoded.data as string : (decoded.data as { pubkey: string }).pubkey;
        return {
          id: reference,
          type: 'profile',
          value: reference,
          label: this.getMentionDisplayName(pubkey),
          secondaryLabel: 'Profile mention',
        };
      }

      if (decoded.type === 'naddr') {
        const address = decoded.data as { identifier: string; kind: number };
        return {
          id: reference,
          type: 'address',
          value: reference,
          label: address.identifier || 'Address reference',
          secondaryLabel: `Kind ${address.kind}`,
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  // Computed property for the unsigned media event for preview
  previewMediaEvent = computed((): NostrEvent | null => {
    if (!this.isMediaMode() || this.mediaMetadata().length === 0) return null;

    // 1. Determine Kind
    const kind = this.getMediaEventKind();

    // 2. Prepare Content (remove URLs)
    let content = this.content();
    this.mediaMetadata().forEach(m => {
      const reference = this.getMediaContentReference(m);
      const escapedUrl = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    this.mediaMetadata().filter(metadata => !metadata.pendingUpload).forEach(metadata => {
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

  removeMedia(index: number): void {
    const currentMetadata = [...this.mediaMetadata()];
    const removedMedia = currentMetadata[index];
    currentMetadata.splice(index, 1);
    this.mediaMetadata.set(currentMetadata);

    this.removeMediaReferenceFromContent(this.getMediaContentReference(removedMedia));
    this.revokeMediaPreviewUrls(removedMedia);

    // If no more media, disable media mode
    if (currentMetadata.length === 0) {
      this.isMediaMode.set(false);
    }

    // Save draft immediately after media removal
    this.saveAutoDraft();
  }

  onMediaThumbnailPointerDown(index: number, event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    const media = this.mediaMetadata()[index];
    if (!this.canOpenVideoOptimizationMenu(media)) {
      return;
    }

    this.clearPendingVideoProfileMenuOpen();
    const anchor = this.getContextMenuAnchor(event.currentTarget as HTMLElement | null, event.clientX, event.clientY);

    this.pendingVideoProfileMenuTimeout = setTimeout(() => {
      this.pendingVideoProfileMenuTimeout = null;
      this.suppressThumbnailClickUntil = Date.now() + 300;
      this.openVideoOptimizationMenu(media, anchor.x, anchor.y);
    }, this.VIDEO_PROFILE_MENU_HOLD_DELAY);
  }

  onMediaThumbnailPointerUp(): void {
    this.clearPendingVideoProfileMenuOpen();
  }

  onMediaThumbnailContextMenu(index: number, event: MouseEvent): void {
    const media = this.mediaMetadata()[index];
    if (!this.canOpenVideoOptimizationMenu(media)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.clearPendingVideoProfileMenuOpen();
    this.suppressThumbnailClickUntil = Date.now() + 300;
    this.openVideoOptimizationMenu(media, event.clientX, event.clientY);
  }

  onMediaThumbnailKeyDown(index: number, event: KeyboardEvent): void {
    const media = this.mediaMetadata()[index];
    if (!this.canOpenVideoOptimizationMenu(media)) {
      return;
    }

    const shouldOpenMenu = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    if (!shouldOpenMenu) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const anchor = this.getContextMenuAnchor(event.currentTarget as HTMLElement | null, 0, 0);
    this.openVideoOptimizationMenu(media, anchor.x, anchor.y);
  }

  reinsertPendingMediaReference(media: MediaMetadata): void {
    if (!media.pendingUpload) {
      return;
    }

    const reference = this.getMediaContentReference(media);
    if (!reference || this.content().includes(reference)) {
      return;
    }

    const { start } = this.insertFileUrl(reference);
    if (media.placeholderToken) {
      this.pendingMediaInsertionAnchors.set(media.placeholderToken, start);
    }
    this.saveAutoDraft();
  }

  async onMediaThumbnailClick(index: number, event?: MouseEvent): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();

    if (Date.now() < this.suppressThumbnailClickUntil) {
      return;
    }

    this.clearPendingVideoProfileMenuOpen();

    const media = this.mediaMetadata()[index];
    if (!media) {
      return;
    }

    if (this.shouldReinsertPendingMediaReference(media)) {
      this.reinsertPendingMediaReference(media);
      return;
    }

    const previewableMedia = this.mediaMetadata()
      .map((item, itemIndex) => ({ item, itemIndex }))
      .filter(({ item }) => !!item.url);

    const selectedIndex = previewableMedia.findIndex(entry => entry.itemIndex === index);
    if (selectedIndex === -1) {
      return;
    }

    const { MediaPreviewDialogComponent } = await import('../media-preview-dialog/media-preview.component');

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaItems: previewableMedia.map(({ item }) => ({
          url: item.url,
          type: item.mimeType?.startsWith('video/') ? 'video' : 'image',
          title: item.alt || item.fileName,
        })),
        initialIndex: selectedIndex,
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  // Dialog mode indicators
  isReply = computed(() => !!this.data?.replyTo);
  isQuote = computed(() => !!this.data?.quote);
  /** NIP-41: Check if we're editing an existing note */
  isEdit = computed(() => !!this.data?.editEvent);
  hasReplyTarget = computed(() => !!this.data?.replyTo || !!this.replyToEvent());
  canTogglePostToX = computed(() => this.xPremiumEligible() && !this.isEdit() && !this.hasReplyTarget());
  replyPreviewEvent = computed(() => this.data?.replyTo?.event ?? this.replyToEvent() ?? null);
  replyPreviewPubkey = computed(() => this.replyPreviewEvent()?.pubkey || this.data?.replyTo?.pubkey || '');
  replyPreviewText = computed(() => {
    const event = this.replyPreviewEvent();
    if (!event) {
      return '';
    }

    const normalized = event.content
      .replace(/\r\n/g, '\n')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (normalized.length <= 140) {
      return normalized;
    }

    return `${normalized.slice(0, 137).trim()}…`;
  });
  replyPreviewFallbackText = computed(() => {
    if (!this.replyPreviewEvent()) {
      return 'Preview unavailable for this note.';
    }

    return 'This note has no text content.';
  });
  xPremiumEligible = computed(() => {
    const subscription = this.accountState.subscription();
    const hasXPostingEntitlement = subscription?.entitlements?.features?.some(feature => feature.key === 'DUAL_POST_X_10') ?? false;
    const isNotExpired = !subscription?.expires || Date.now() < subscription.expires;
    return !!subscription && hasXPostingEntitlement && isNotExpired;
  });

  // Check if a mention is the reply target (cannot be removed)
  isReplyTargetMention(pubkey: string): boolean {
    return this.isReply() && this.data?.replyTo?.pubkey === pubkey;
  }

  // Show only user-added mentions in the chip list (hide automatic reply target mention)
  visibleMentions = computed(() => this.mentions().filter(pubkey => !this.isReplyTargetMention(pubkey)));

  // Check if zap split is available (requires quote and logged in user)
  zapSplitAvailable = computed(() => this.isQuote() && !!this.currentAccountPubkey());

  // Date constraints
  minDate = computed(() => new Date());

  // PoW computed properties
  isPowMining = computed(() => this.powProgress().isRunning);
  xStatusReady = computed(() => this.xDualPost.loaded() && !this.xDualPost.loading());
  xPostingAvailable = computed(() => this.xStatusReady() && this.xPremiumEligible() && this.xDualPost.status().connected && !this.isEdit() && !this.hasReplyTarget());
  xStatusLoading = computed(() => this.xDualPost.loading());
  xHeaderIndicatorVisible = computed(() => this.xPostingAvailable());
  dialogTitle = computed(() => {
    if (this.data.dialogTitle) {
      return this.data.dialogTitle;
    }

    if (this.isEdit()) {
      return 'Edit Note';
    }

    if (this.isReply()) {
      return 'Reply to Note';
    }

    if (this.isQuote()) {
      return 'Quote Note';
    }

    return 'Create Note';
  });
  dialogHeaderIcon = computed(() => this.data.dialogHeaderIcon || 'edit_square');
  showShellHeader = computed(() => !this.isKeyboardCompactMode());
  showXHeaderAction = computed(() => !this.inlineMode() && this.xHeaderIndicatorVisible() && this.postToX());
  xHeaderActionTooltip = computed(() => {
    if (!this.showXHeaderAction()) {
      return '';
    }

    const username = this.xDualPost.status().username;
    return username
      ? `Post to X is on. Publishing as @${username}. Click to turn off.`
      : 'Post to X is on. Click to turn off.';
  });
  xHeaderActionAriaLabel = computed(() => this.postToX() ? 'Turn off Post to X' : 'Turn on Post to X');
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
    const hasMediaChange = this.serializeMediaMetadata(this.mediaMetadata()) !== this.serializeMediaMetadata(this.initialMediaMetadata);
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

    // NIP-41: For edit mode, show kind 1010 event with 'e' tag
    if (this.isEdit()) {
      const editEvent = this.data?.editEvent;
      const content = this.processContentForPublishing(this.content().trim());

      // Build edit event tags
      const tags: string[][] = [
        ['e', editEvent?.id || '<original_event_id>'],
      ];

      // Add hashtags from content
      this.extractHashtags(content, tags);

      // Extract NIP-27 tags (p tags for nostr:nprofile/npub, q tags for quotes)
      this.extractNip27Tags(content, tags);

      // Add mentions from the mentions signal (with deduplication)
      this.mentions().forEach(mentionPubkey => {
        const alreadyAdded = tags.some(t => t[0] === 'p' && t[1] === mentionPubkey);
        if (!alreadyAdded) {
          tags.push(['p', mentionPubkey]);
        }
      });

      const unsignedEvent = {
        kind: 1010,
        content,
        tags,
        pubkey,
        created_at,
      };

      return JSON.stringify(unsignedEvent, null, 2);
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

    this.setupContentEditorBridge();

    window.addEventListener('resize', this.handleViewportResize);
    window.visualViewport?.addEventListener('resize', this.handleViewportResize);

    // Auto-focus the textarea (only in dialog mode)
    if (!this.inlineMode()) {
      setTimeout(() => {
        if (this.contentTextarea) {
          this.contentTextarea.nativeElement.focus();
          this.updateKeyboardCompactMode();
          this.scheduleTextareaRefresh();
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
  private onDocumentClick = (event: MouseEvent): void => {
    // Only apply in inline mode when expanded
    if (!this.inlineMode() || !this.isExpanded()) return;

    // Don't collapse if busy or has content
    if (this.isPublishing() || this.isUploading() || this.content().trim()) return;

    const clickedInside = this.elementRef.nativeElement.contains(event.target);
    // Also check if clicking on mention autocomplete or slash command menu (which may be outside component)
    const mentionAutocomplete = document.querySelector('app-mention-autocomplete');
    const clickedOnMentionAutocomplete = mentionAutocomplete?.contains(event.target as Node);
    const slashCommandMenu = document.querySelector('app-slash-command-menu');
    const clickedOnSlashCommandMenu = slashCommandMenu?.contains(event.target as Node);

    if (!clickedInside && !clickedOnMentionAutocomplete && !clickedOnSlashCommandMenu) {
      this.isExpanded.set(false);
    }
  };

  ngOnDestroy() {
    this.editorBridgeReady.set(false);

    if (this.textareaRefreshFrame !== null) {
      cancelAnimationFrame(this.textareaRefreshFrame);
      this.textareaRefreshFrame = null;
    }

    if (this.viewportResizeTimeout !== null) {
      clearTimeout(this.viewportResizeTimeout);
      this.viewportResizeTimeout = null;
    }

    if (this.pendingMenuOpenTimeout !== null) {
      clearTimeout(this.pendingMenuOpenTimeout);
      this.pendingMenuOpenTimeout = null;
    }

    this.clearPendingVideoProfileMenuOpen();

    window.removeEventListener('resize', this.handleViewportResize);
    window.visualViewport?.removeEventListener('resize', this.handleViewportResize);

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

    this.mediaMetadata().forEach(media => this.revokeMediaPreviewUrls(media));
  }

  constructor() {
    // Set default value for addClientTag from user's local settings
    this.addClientTag.set(this.localSettings.addClientTag());

    effect(() => {
      const isConnected = this.xDualPost.status().connected;
      const defaultXPosting = this.syncedSettings.settings().postToXByDefault ?? false;
      const isReply = this.hasReplyTarget();

      if (!this.xPremiumEligible() || this.isEdit() || isReply) {
        this.postToX.set(false);
        this.xPostingChoiceInitialized = false;
        return;
      }

      if (defaultXPosting && !this.xPostingChoiceInitialized && !this.xStatusReady()) {
        this.xDualPost.ensureStatusLoaded();
        return;
      }

      if (!this.xStatusReady()) {
        return;
      }

      if (!isConnected) {
        this.postToX.set(false);
        this.xPostingChoiceInitialized = false;
        return;
      }

      if (!this.xPostingChoiceInitialized) {
        this.postToX.set(defaultXPosting);
        this.xPostingChoiceInitialized = true;
      }
    });

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
            this.mediaMetadata().forEach(media => this.revokeMediaPreviewUrls(media));
            this.mediaMetadata.set([]);
            this.isExpanded.set(false);

            // Fetch the profile name for the new reply target
            this.loadMentionProfileName(event.pubkey);
          }
        }
      }
    });
    // Register document-level event listeners (SSR-safe)
    afterNextRender(() => {
      document.addEventListener('mousedown', this.onDocumentClick);
      document.addEventListener('keydown', this.handleGlobalKeydown);

      this.destroyRef.onDestroy(() => {
        document.removeEventListener('mousedown', this.onDocumentClick);
        document.removeEventListener('keydown', this.handleGlobalKeydown);
      });
    });
  }

  ngOnInit() {
    this.dialogRef ??= this.materialDialogRef ?? undefined;

    if (!this.inlineMode() && this.materialDialogData) {
      this.data = {
        ...this.materialDialogData,
        ...this.data,
      };
    }

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
      // Include relay hints so other clients can find the quoted event.
      // Use relays passed with the quote data, or fall back to the first account relay.
      let relayHints: string[] = this.data.quote.relays?.length
        ? this.data.quote.relays
        : [];
      if (relayHints.length === 0) {
        const accountRelays = this.accountRelay.getRelayUrls();
        if (accountRelays.length > 0) {
          relayHints = [accountRelays[0]];
        }
      }

      const quoteReference = this.buildQuoteReference(this.data.quote, relayHints);
      const quoteText = `nostr:${quoteReference}`;
      const currentContent = this.content();

      // Only add the quote if it doesn't already exist in the content
      if (!currentContent.includes(quoteText)) {
        if (currentContent) {
          this.content.set(currentContent + '\n\n' + quoteText);
        } else {
          this.content.set(quoteText);
        }
      }

      // Pre-populate expiration if the quoted event has an active expiration (NIP-40)
      if (this.data.quote.expiration && this.data.quote.expiration > Math.floor(Date.now() / 1000)) {
        const expirationDate = new Date(this.data.quote.expiration * 1000);
        this.expirationEnabled.set(true);
        this.expirationDate.set(expirationDate);
        const hours = expirationDate.getHours().toString().padStart(2, '0');
        const minutes = expirationDate.getMinutes().toString().padStart(2, '0');
        this.expirationTime.set(`${hours}:${minutes}`);
      }
    }

    // Initialize content if provided (e.g. from Share Target or Edit)
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

    // NIP-41: When editing, parse nostr: references to extract pubkeys for p tags
    // This ensures existing mentions in the original note are preserved in the edit event
    if (this.isEdit()) {
      this.parseNostrReferencesFromContent(this.content());
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
    let previousMediaMetadata = this.serializeMediaMetadata(mediaMetadataSignal());
    let previousIsMediaMode = isMediaModeSignal();
    let previousTitle = titleSignal();

    const checkOtherChanges = () => {
      const currentMentions = JSON.stringify(mentionsSignal());
      const currentExpirationEnabled = expirationEnabledSignal();
      const currentExpirationTime = expirationTimeSignal();
      const currentMediaMetadata = this.serializeMediaMetadata(mediaMetadataSignal());
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
        if (this.getDraftContent().trim() || this.getDraftMediaMetadata().length > 0) {
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
    const content = this.getDraftContent().trim();
    const hasMedia = this.getDraftMediaMetadata().length > 0;

    if (!content && !hasMedia) return;

    // Schedule new auto-save
    this.autoSaveTimer = setTimeout(() => {
      this.saveAutoDraft();
    }, this.AUTO_SAVE_INTERVAL);
  }

  private saveAutoDraft(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const draftContent = this.getDraftContent();
    const content = draftContent.trim();
    const draftMediaMetadata = this.getDraftMediaMetadata();
    const hasMedia = draftMediaMetadata.length > 0;

    if (!content && !hasMedia) return;

    const autoDraft: NoteAutoDraft = {
      content: draftContent,
      mentions: [...this.mentions()],
      mentionMap: Array.from(this.mentionMap.entries()),
      pubkeyToNameMap: Array.from(this.pubkeyToNameMap.entries()),
      showPreview: this.showPreview(),
      showAdvancedOptions: false,
      expirationEnabled: this.expirationEnabled(),
      expirationDate: this.expirationDate(),
      expirationTime: this.expirationTime(),
      uploadMode: this.mediaUploadMode(),
      compressionStrength: this.compressionStrength(),
      videoOptimizationProfile: this.videoOptimizationProfile(),
      uploadOriginal: this.uploadOriginal(),
      addClientTag: this.addClientTag(),
      lastModified: Date.now(),
      replyToId: this.data?.replyTo?.id,
      quoteId: this.data?.quote?.id,
      mediaMetadata: draftMediaMetadata,
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
        this.serializeMediaMetadata(previousDraft.mediaMetadata ?? []) === this.serializeMediaMetadata(autoDraft.mediaMetadata ?? []) &&
        previousDraft.expirationEnabled === autoDraft.expirationEnabled &&
        previousDraft.expirationTime === autoDraft.expirationTime &&
        previousDraft.uploadMode === autoDraft.uploadMode &&
        previousDraft.compressionStrength === autoDraft.compressionStrength &&
        previousDraft.videoOptimizationProfile === autoDraft.videoOptimizationProfile &&
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
          this.showAdvancedOptions.set(false);
          this.expirationEnabled.set(autoDraft.expirationEnabled);
          this.expirationDate.set(autoDraft.expirationDate);
          this.expirationTime.set(autoDraft.expirationTime);
          const restoredUploadMode = autoDraft.uploadMode ?? (autoDraft.uploadOriginal ? 'original' : 'local');
          this.mediaUploadMode.set(restoredUploadMode === 'server' ? 'local' : restoredUploadMode);
          this.compressionStrength.set(
            autoDraft.compressionStrength ?? DEFAULT_MEDIA_UPLOAD_SETTINGS.compressionStrength
          );
          this.videoOptimizationProfile.set(DEFAULT_MEDIA_UPLOAD_SETTINGS.videoOptimizationProfile ?? 'default');
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

          // Show restoration message after initial render settles
          setTimeout(() => {
            this.snackBar.open('Draft restored', 'Dismiss', {
              duration: 3000,
              panelClass: 'info-snackbar',
            });
          }, 0);
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
    const xPostValidation = this.xPostValidation();
    if (!xPostValidation.valid) {
      this.snackBar.open(xPostValidation.message, 'Close', {
        duration: 5000,
      });
      return;
    }

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
      const uploadedPendingMedia = await this.uploadPendingMediaBeforePublish();
      if (!uploadedPendingMedia) {
        return;
      }

      if (this.isEdit()) {
        await this.publishEditFlow();
      } else if (this.isMediaModeEnabled()) {
        await this.publishMediaFlow();
      } else {
        await this.publishStandardFlow();
      }
    } catch (error) {
      console.error('Error publishing note:', error);
      const message = error instanceof Error ? error.message : 'Failed to publish note. Please try again.';
      this.snackBar.open(message, 'Close', {
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
    await this.publishEvent(content, tags, content, this.getXMediaItems());
  }

  private async publishMediaFlow(): Promise<void> {
    // 1. Determine Kind
    const kind = this.getMediaEventKind();

    // 2. Prepare Content (remove URLs)
    let content = this.content();
    this.mediaMetadata().forEach(m => {
      const reference = this.getMediaContentReference(m);
      const escapedUrl = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    await this.publishEvent(kind1Content, filteredKind1Tags, content, this.getXMediaItems());
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

  /**
   * NIP-41: Publish an edit event (kind 1010) for an existing kind:1 note
   * The edit event has an 'e' tag pointing to the original event ID
   */
  private async publishEditFlow(): Promise<void> {
    const editEvent = this.data?.editEvent;
    if (!editEvent) {
      throw new Error('No event to edit');
    }

    const content = this.processContentForPublishing(this.content().trim());

    // Build tags for the edit event
    // Must include 'e' tag referencing the original event ID
    const tags: string[][] = [
      ['e', editEvent.id],
    ];

    // Add hashtags from content
    this.extractHashtags(content, tags);

    // Extract NIP-27 tags (p tags for nostr:nprofile/npub, q tags for quotes)
    this.extractNip27Tags(content, tags);

    // Add mentions from the mentions signal (these may overlap with NIP-27 extracted ones,
    // but extractNip27Tags already handles deduplication via addedPubkeys set)
    this.mentions().forEach(pubkey => {
      // Check if already added by extractNip27Tags
      const alreadyAdded = tags.some(t => t[0] === 'p' && t[1] === pubkey);
      if (!alreadyAdded) {
        tags.push(['p', pubkey]);
      }
    });

    // Create and publish the kind:1010 edit event
    const unsignedEvent = this.nostrService.createEvent(1010, content, tags);

    // Set up dialog close handling similar to publishEvent
    let dialogClosed = false;
    let publishedEventId: string | undefined;

    this.publishSubscription = this.publishEventBus.on('relay-result').subscribe((event) => {
      if (!dialogClosed && event.type === 'relay-result') {
        const relayEvent = event as PublishRelayResultEvent;

        const isOurEvent = publishedEventId
          ? relayEvent.event.id === publishedEventId
          : relayEvent.event.content === content;

        if (isOurEvent && relayEvent.success) {
          dialogClosed = true;
          publishedEventId = relayEvent.event.id;

          if (!this.inlineMode()) {
            this.clearAutoDraft();
          }
          this.snackBar.open('Note edited successfully!', 'Close', {
            duration: 3000,
          });

          const signedEvent = relayEvent.event;

          if (this.inlineMode()) {
            this.content.set('');
            this.mentionMap.clear();
            this.pubkeyToNameMap.clear();
            this.mediaMetadata().forEach(media => this.revokeMediaPreviewUrls(media));
            this.mediaMetadata.set([]);
            this.isExpanded.set(false);
            this.replyPublished.emit(signedEvent);
          } else {
            this.dialogRef?.close({ published: true, event: signedEvent });
          }

          if (this.shouldNavigateAfterPublish()) {
            // Navigate to the original event (not the edit event)
            const nevent = nip19.neventEncode({
              id: editEvent.id,
              author: editEvent.pubkey,
              kind: editEvent.kind,
            });
            this.layout.openGenericEvent(nevent, editEvent);
          }

          if (this.publishSubscription) {
            this.publishSubscription.unsubscribe();
            this.publishSubscription = undefined;
          }
        }
      }
    });

    const result = await this.nostrService.signAndPublish(unsignedEvent);

    console.log('[NoteEditorDialog] Edit publish result:', {
      success: result.success,
      hasEvent: !!result.event,
      eventId: result.event?.id
    });

    if (result.event) {
      publishedEventId = result.event.id;
    }

    if (!dialogClosed && (!result.success || !result.event)) {
      throw new Error('Failed to publish edit event');
    }
  }

  private async publishEvent(contentToPublish: string, tags: string[][], xText?: string, xMedia: XPostMediaItem[] = []): Promise<void> {
    let preparedXPost: PreparedXPost | undefined;
    const finalTags = tags.map(tag => [...tag]);

    if (xText?.trim() && this.postToX() && this.xDualPost.status().connected) {
      preparedXPost = await this.prepareXPost(xText, xMedia);
      this.appendXProxyTag(finalTags, preparedXPost.url);
    }

    let eventToSign: UnsignedEvent;

    // If PoW is enabled, ensure we have a mined event
    if (this.powEnabled()) {
      // If we don't have a mined event yet, or content has changed, mine it now
      if (!this.powMinedEvent() || this.powMinedEvent()?.content !== contentToPublish) {
        // Build the base event for mining
        const baseEvent = this.nostrService.createEvent(1, contentToPublish, finalTags);

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
      eventToSign = this.nostrService.createEvent(1, contentToPublish, finalTags);
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
          const signedEvent = relayEvent.event;

          this.haptics.triggerSuccess();

          if (preparedXPost) {
            void this.finalizePreparedXPost(signedEvent.id, preparedXPost);
          }

          // Clear draft and close dialog immediately after first successful publish
          if (!this.inlineMode()) {
            this.clearAutoDraft();
          }
          this.snackBar.open(this.inlineMode() ? 'Reply published!' : 'Note published successfully!', 'Close', {
            duration: 3000,
          });

          // Close dialog with the signed event
          if (this.inlineMode()) {
            // In inline mode: reset state and emit event
            this.content.set('');
            this.mentionMap.clear();
            this.pubkeyToNameMap.clear();
            this.mediaMetadata().forEach(media => this.revokeMediaPreviewUrls(media));
            this.mediaMetadata.set([]);
            this.isExpanded.set(false);
            this.replyPublished.emit(signedEvent);
          } else {
            // In dialog mode: close dialog
            this.dialogRef?.close({ published: true, event: signedEvent });
          }

          if (this.shouldNavigateAfterPublish()) {
            // Navigate to the published event
            const nevent = nip19.neventEncode({
              id: signedEvent.id,
              author: signedEvent.pubkey,
              kind: signedEvent.kind,
            });
            this.layout.openGenericEvent(nevent, signedEvent);
          }

          // Unsubscribe after handling
          if (this.publishSubscription) {
            this.publishSubscription.unsubscribe();
            this.publishSubscription = undefined;
          }
        }
      }
    });

    // Start the publish operation (will continue in background even after dialog closes)
    let result;

    try {
      result = await this.nostrService.signAndPublish(eventToSign);
    } catch (error) {
      if (preparedXPost) {
        throw new Error(`Posted to X, but failed to publish to Nostr: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      throw error;
    }

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
      if (preparedXPost) {
        throw new Error('Posted to X, but failed to publish to Nostr');
      }

      throw new Error('Failed to publish event');
    }
  }

  async connectXFromComposer(): Promise<void> {
    if (!this.xPremiumEligible()) {
      this.snackBar.open('Post to X is available for Premium+ accounts only.', 'Close', {
        duration: 5000,
      });
      return;
    }

    try {
      await this.xDualPost.connect();
    } catch (error) {
      this.snackBar.open(`Failed to connect X: ${error instanceof Error ? error.message : 'Unknown error'}`, 'Close', {
        duration: 5000,
      });
    }
  }

  onPostToXChange(checked: boolean): void {
    this.xPostingChoiceInitialized = true;
    this.postToX.set(checked);

    if (checked && !this.xStatusReady()) {
      this.xDualPost.ensureStatusLoaded();
    }
  }

  toggleSecondaryHeaderAction(): void {
    if (!this.xPostingAvailable()) {
      return;
    }

    this.onPostToXChange(!this.postToX());
  }

  private getXMediaItems(): XPostMediaItem[] {
    return this.mediaMetadata()
      .filter(media => !!media.url && !media.pendingUpload)
      .map(media => ({
        url: media.url,
        mimeType: media.mimeType,
        fallbackUrls: media.fallbackUrls,
      }));
  }

  private async prepareXPost(text: string, media: XPostMediaItem[]): Promise<PreparedXPost> {
    const result = await this.xDualPost.publishPost(text.trim(), media);

    return {
      id: result.id,
      url: result.url,
    };
  }

  private async finalizePreparedXPost(nostrEventId: string, preparedXPost: PreparedXPost): Promise<void> {
    try {
      await this.xDualPost.linkPostToEvent(preparedXPost.id, nostrEventId, preparedXPost.url);
    } catch (error) {
      console.warn('Failed to finalize Post to X link', {
        error,
        nostrEventId,
        xPostId: preparedXPost.id,
      });
    }
  }

  private appendXProxyTag(tags: string[][], xUrl: string): void {
    const normalizedUrl = this.normalizeExternalWebUrl(xUrl);
    const hasProxyTag = tags.some(tag => tag[0] === 'proxy' && tag[1] === normalizedUrl && tag[2] === 'web');

    if (!hasProxyTag) {
      tags.push(['proxy', normalizedUrl, 'web']);
    }
  }

  private normalizeExternalWebUrl(url: string): string {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
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
      const relay = this.data.quote.relays?.[0] || '';
      const quoteTarget = this.getQuoteTagTarget(this.data.quote);
      tags.push(['q', quoteTarget, relay, this.data.quote.pubkey]);

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

    // Add imeta tags for uploaded media (NIP-92)
    this.mediaMetadata().filter(metadata => !metadata.pendingUpload).forEach(metadata => {
      const imetaTag = this.buildImetaTag(metadata);
      if (imetaTag) {
        tags.push(imetaTag);
      }
    });

    return tags;
  }

  private getQuoteTagTarget(quote: NonNullable<NoteEditorDialogData['quote']>): string {
    if (
      typeof quote.kind === 'number' &&
      this.utilities.isParameterizedReplaceableEvent(quote.kind) &&
      quote.identifier
    ) {
      return `${quote.kind}:${quote.pubkey}:${quote.identifier}`;
    }

    return quote.id;
  }

  private buildQuoteReference(
    quote: NonNullable<NoteEditorDialogData['quote']>,
    relayHints: string[]
  ): string {
    const normalizedRelays = this.utilities.normalizeRelayUrls(relayHints);

    if (
      typeof quote.kind === 'number' &&
      this.utilities.isParameterizedReplaceableEvent(quote.kind) &&
      quote.identifier
    ) {
      return nip19.naddrEncode({
        kind: quote.kind,
        pubkey: quote.pubkey,
        identifier: quote.identifier,
        relays: normalizedRelays,
      });
    }

    return nip19.neventEncode({
      id: quote.id,
      author: quote.pubkey,
      kind: quote.kind,
      relays: normalizedRelays,
    });
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
    const nostrUriPattern = /nostr:(note1|nevent1|npub1|nprofile1|naddr1)((?:(?!(?:note|nevent|npub|nprofile|naddr)1)[a-zA-Z0-9])+)/g;
    const matches = content.matchAll(nostrUriPattern);

    // Track added quote event IDs (q tags) separately from reply event IDs (e tags)
    const addedQuoteEventIds = new Set(tags.filter(tag => tag[0] === 'q').map(tag => tag[1]));
    const addedPubkeys = new Set(tags.filter(tag => tag[0] === 'p').map(tag => tag[1]));

    const upsertQuoteTag = (target: string, relay: string, pubkey: string): void => {
      const existingQTag = tags.find(tag => tag[0] === 'q' && tag[1] === target);
      if (existingQTag) {
        if (relay && !existingQTag[2]) {
          existingQTag[2] = relay;
        }
        if (pubkey && !existingQTag[3]) {
          existingQTag[3] = pubkey;
        }
        return;
      }

      tags.push(['q', target, relay, pubkey]);
      addedQuoteEventIds.add(target);
    };

    for (const match of matches) {
      const fullIdentifier = match[1] + match[2];

      try {
        const decoded = nip19.decode(fullIdentifier);

        switch (decoded.type) {
          case 'note':
            // NIP-18: Add q tag for quote reference (NOT e tag which is for thread participation)
            if (!addedQuoteEventIds.has(decoded.data)) {
              upsertQuoteTag(decoded.data, '', '');
            }
            break;

          case 'nevent':
            // NIP-18: Add q tag for quote reference (NOT e tag which is for thread participation)
            upsertQuoteTag(decoded.data.id, decoded.data.relays?.[0] || '', decoded.data.author || '');
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
            upsertQuoteTag(aTagValue, decoded.data.relays?.[0] || '', decoded.data.pubkey);
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
   * Parse existing nostr: profile references from content and add pubkeys to mentions.
   * This is called when loading edit content to ensure existing mentions get p tags.
   * Without this, editing a note with nostr:nprofile... references would lose the p tags.
   */
  private parseNostrReferencesFromContent(content: string): void {
    // Match nostr:npub1... and nostr:nprofile1... URIs
    const nostrUriPattern = /nostr:(npub1|nprofile1)([a-zA-Z0-9]+)/g;
    let match;

    while ((match = nostrUriPattern.exec(content)) !== null) {
      const fullIdentifier = match[1] + match[2];

      try {
        const decoded = nip19.decode(fullIdentifier);
        let pubkey: string | undefined;

        if (decoded.type === 'npub') {
          pubkey = decoded.data;
        } else if (decoded.type === 'nprofile') {
          pubkey = decoded.data.pubkey;
        }

        if (pubkey && !this.mentions().includes(pubkey)) {
          this.mentions.update(m => [...m, pubkey!]);
          // Load the profile name for display in the mentions chip list
          this.loadMentionProfileName(pubkey);
        }
      } catch (e) {
        console.warn('Failed to decode nostr URI:', fullIdentifier, e);
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
      this.scheduleTextareaRefresh();

      // Remove from pubkeyToNameMap
      this.pubkeyToNameMap.delete(pubkey);
    }

    // Save draft immediately after mention removal
    this.saveAutoDraft();
  }

  /**
   * Insert an emoji at the current cursor position in the textarea
   */
  insertEmoji(emoji: string): void {
    const textarea = this.contentTextarea?.nativeElement;
    if (textarea) {
      const isFocused = document.activeElement === textarea;
      const start = isFocused ? (textarea.selectionStart ?? textarea.value.length) : (this.lastCursorPosition ?? textarea.value.length);
      const end = isFocused ? (textarea.selectionEnd ?? start) : start;
      const currentContent = this.content();
      const newContent = currentContent.substring(0, start) + emoji + currentContent.substring(end);
      this.content.set(newContent);

      const newPos = start + emoji.length;
      this.lastCursorPosition = newPos;
      this.setCursorAfterRender(newPos);
    } else {
      this.content.update(text => text + emoji);
    }
  }

  /**
   * Insert a GIF URL at the current cursor position
   */
  insertGifUrl(url: string): void {
    const textarea = this.contentTextarea?.nativeElement;
    const currentContent = this.content();
    const isFocused = textarea && document.activeElement === textarea;
    const start = isFocused ? (textarea.selectionStart ?? currentContent.length) : (this.lastCursorPosition ?? currentContent.length);
    const needsNewlineBefore = start > 0 && currentContent[start - 1] !== '\n';
    this.insertEmoji((needsNewlineBefore ? '\n' : '') + url + '\n');

    // Add preview (GIFs are images)
    const currentMetadata = this.mediaMetadata();
    const alreadyAdded = currentMetadata.some(m => m.url === url);
    if (!alreadyAdded) {
      this.mediaMetadata.set([
        ...currentMetadata,
        {
          url,
          mimeType: 'image/gif',
        },
      ]);
    }
  }

  /**
   * Open GIF picker in a fullscreen dialog on small screens
   */
  async openGifPickerDialog(): Promise<void> {
    const { EmojiPickerDialogComponent } = await import('../emoji-picker/emoji-picker-dialog.component');
    const dialogRef = this.dialog.open(EmojiPickerDialogComponent, {
      panelClass: ['material-custom-dialog-panel', 'emoji-picker-dialog-panel'],
      width: '400px',
      data: { title: 'GIFs', mode: 'content', activeTab: 'gifs' },
    });

    dialogRef.afterClosed().subscribe((result: string | undefined) => {
      if (result) {
        this.insertGifUrl(result);
      } else {
        this.scheduleTextareaRefresh(undefined, true);
      }
    });
  }

  /**
   * Open emoji picker in a fullscreen dialog on small screens
   */
  async openEmojiPickerDialog(): Promise<void> {
    const { EmojiPickerDialogComponent } = await import('../emoji-picker/emoji-picker-dialog.component');
    const dialogRef = this.dialog.open(EmojiPickerDialogComponent, {
      panelClass: ['material-custom-dialog-panel', 'emoji-picker-dialog-panel'],
      width: '400px',
      data: { title: 'Emoji', mode: 'content', activeTab: 'emoji' },
    });

    dialogRef.afterClosed().subscribe((result: string | undefined) => {
      if (result) {
        if (result.startsWith('http')) {
          this.insertGifUrl(result);
        } else {
          this.insertEmoji(result);
        }
      } else {
        this.scheduleTextareaRefresh(undefined, true);
      }
    });
  }

  /**
   * Open the reference picker dialog to insert nostr: references (profiles, events, articles)
   */
  async openReferencePicker(): Promise<void> {
    const { ArticleReferencePickerDialogComponent } = await import(
      '../article-reference-picker-dialog/article-reference-picker-dialog.component'
    );
    type ArticleReferencePickerResult = import(
      '../article-reference-picker-dialog/article-reference-picker-dialog.component'
    ).ArticleReferencePickerResult;

    const dialogRef = this.dialog.open(ArticleReferencePickerDialogComponent, {
      panelClass: ['material-custom-dialog-panel', 'article-reference-picker-dialog-panel'],
      width: '760px',
      maxWidth: '96vw',
    });

    dialogRef.afterClosed().subscribe((result: ArticleReferencePickerResult | undefined) => {
      const references = result?.references ?? [];
      if (references.length > 0) {
        this.insertReferences(references);
      } else {
        // Return focus to the textarea after the dialog closes
        this.scheduleTextareaRefresh(undefined, true);
      }
    });
  }

  /**
   * Insert nostr: reference strings at the current cursor position in the textarea
   */
  private insertReferences(references: string[]): void {
    const uniqueReferences = Array.from(new Set(references.filter(ref => !!ref?.trim())));
    if (uniqueReferences.length === 0) {
      return;
    }

    const insertionText = uniqueReferences.join('\n');
    const textarea = this.contentTextarea?.nativeElement;

    if (textarea) {
      const isFocused = document.activeElement === textarea;
      const start = isFocused ? (textarea.selectionStart ?? textarea.value.length) : (this.lastCursorPosition ?? textarea.value.length);
      const end = isFocused ? (textarea.selectionEnd ?? start) : start;
      const currentContent = this.content();

      // Add spacing around the insertion if needed
      const before = currentContent.substring(0, start);
      const after = currentContent.substring(end);
      const needsLeadingSpace = before.length > 0 && !before.endsWith('\n') && !before.endsWith(' ');
      const needsTrailingSpace = after.length > 0 && !after.startsWith('\n') && !after.startsWith(' ');

      const textToInsert = (needsLeadingSpace ? ' ' : '') + insertionText + (needsTrailingSpace ? ' ' : '');
      const newContent = before + textToInsert + after;

      this.content.set(newContent);

      // Position cursor after the inserted text
      const newPos = start + textToInsert.length;
      this.lastCursorPosition = newPos;
      this.setCursorAfterRender(newPos);
    } else {
      // Fallback: append to end
      const currentContent = this.content();
      const separator = !currentContent.trim()
        ? ''
        : currentContent.endsWith('\n')
          ? '\n'
          : '\n\n';
      this.content.set(`${currentContent}${separator}${insertionText}`);
    }

    this.snackBar.open(
      uniqueReferences.length === 1 ? 'Reference inserted' : `${uniqueReferences.length} references inserted`,
      'Close',
      { duration: 2500 },
    );
  }

  // Mention input handling methods
  onContentInput(event: Event): void {
    const target = event.target as EditableContentElement;
    const newContent = target.value;
    this.content.set(newContent);
    this.sentimentError.set('');
    this.lastCursorPosition = target.selectionStart || 0;
    this.scheduleTextareaRefresh(target.selectionStart || 0, false, true);

    // Check for removed mentions and sync with mentions list
    this.syncMentionsWithContent(newContent);

    // Check for slash command trigger first, then mention trigger
    const cursorPos = target.selectionStart || 0;
    this.handleSlashCommandInput(newContent, cursorPos);
    if (!this.slashCommandConfig()) {
      this.handleMentionInput(newContent, cursorPos);
    }
  }

  onContentFocus(): void {
    this.isContentFocused.set(true);
    if (this.platformService.isIOS() && this.isCompactDialogLayout()) {
      if (this.viewportResizeTimeout !== null) {
        clearTimeout(this.viewportResizeTimeout);
      }

      this.viewportResizeTimeout = setTimeout(() => {
        this.viewportResizeTimeout = null;
        requestAnimationFrame(() => {
          this.updateKeyboardCompactMode();
          this.scheduleTextareaRefresh(undefined, false, false, false, false);
        });
      }, 120);
      return;
    }

    this.updateKeyboardCompactMode();
    this.scheduleTextareaRefresh(undefined, false, false, false, false);
  }

  onContentBlur(): void {
    this.isContentFocused.set(false);
    this.updateKeyboardCompactMode();
    this.scheduleTextareaRefresh();
  }

  onContentBeforeInput(event: InputEvent): void {
    if (!this.useNewEditorExperience()) {
      return;
    }

    if (event.inputType.startsWith('format')) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.inputType !== 'insertParagraph' && event.inputType !== 'insertLineBreak') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.insertTextAtSelection('\n');
  }

  onContentPaste(event: ClipboardEvent): void {
    void this.handlePaste(event);
  }

  private openMenuAfterKeyboardDismiss(trigger: MatMenuTrigger): void {
    if (this.pendingMenuOpenTimeout !== null) {
      clearTimeout(this.pendingMenuOpenTimeout);
    }

    this.contentTextarea?.nativeElement?.blur();

    this.pendingMenuOpenTimeout = setTimeout(() => {
      this.pendingMenuOpenTimeout = null;
      requestAnimationFrame(() => {
        trigger.openMenu();
        setTimeout(() => trigger.updatePosition(), 0);
        setTimeout(() => trigger.updatePosition(), 120);
      });
    }, 180);
  }

  onFooterMenuTriggerClick(event: MouseEvent, trigger: MatMenuTrigger): void {
    const textarea = this.contentTextarea?.nativeElement;
    const isFocusedTextarea = !!textarea
      && typeof document !== 'undefined'
      && document.activeElement === textarea;

    if (!this.platformService.isIOS() || !this.isCompactDialogLayout() || !isFocusedTextarea) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.openMenuAfterKeyboardDismiss(trigger);
  }

  private updateKeyboardCompactMode(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined' || this.inlineMode()) {
      this.setKeyboardCompactMode(false);
      return;
    }

    const textarea = this.contentTextarea?.nativeElement;
    const visualViewport = window.visualViewport;
    const viewportHeight = visualViewport?.height ?? window.innerHeight;
    const hasTextareaFocus = !!textarea && document.activeElement === textarea;
    this.refreshViewportHeightBaseline(viewportHeight, hasTextareaFocus);

    const obscuredHeight = Math.max(0, this.viewportHeightBaseline - viewportHeight);
    const shouldUseCompactMode = this.platformService.isIOS()
      && this.isCompactDialogLayout()
      && hasTextareaFocus
      && obscuredHeight > 120;

    this.setKeyboardCompactMode(shouldUseCompactMode);
  }

  private refreshViewportHeightBaseline(viewportHeight: number, hasTextareaFocus: boolean): void {
    if (this.viewportHeightBaseline === 0 || viewportHeight > this.viewportHeightBaseline) {
      this.viewportHeightBaseline = viewportHeight;
      return;
    }

    // Only lower the baseline once the keyboard/pan state has effectively settled back.
    if (!hasTextareaFocus && viewportHeight >= this.viewportHeightBaseline - 24) {
      this.viewportHeightBaseline = viewportHeight;
    }
  }

  private setKeyboardCompactMode(enabled: boolean): void {
    if (this.isKeyboardCompactMode() === enabled) {
      return;
    }

    this.isKeyboardCompactMode.set(enabled);
  }

  private setupContentEditorBridge(): void {
    if (!this.useNewEditorExperience()) {
      this.editorBridgeReady.set(false);
      return;
    }

    const editor = this.contentTextarea?.nativeElement;
    if (!editor) {
      return;
    }

    this.decorateEditorElement(editor);
    this.writeEditorValue(editor, this.content());
    this.editorBridgeReady.set(true);

    effect(() => {
      const content = this.content();
      const mediaReferences = this.mediaMetadata()
        .map(media => `${this.getMediaContentReference(media)}|${this.getMediaThumbnailUrl(media)}|${media.pendingUpload ? 'pending' : 'ready'}`)
        .join('||');

      if (!this.editorBridgeReady()) {
        return;
      }

      const editor = this.contentTextarea?.nativeElement;
      if (!editor) {
        return;
      }

      void mediaReferences;

      if (this.readEditorValue(editor) !== content) {
        this.writeEditorValue(editor, content);
        return;
      }

      this.writeEditorValue(editor, content);
    }, { allowSignalWrites: true });
  }

  private restoreEditorAfterViewToggle(): void {
    setTimeout(() => {
      if (this.useNewEditorExperience()) {
        this.setupContentEditorBridge();
        this.refreshEditorContent();
      }
      this.scheduleTextareaRefresh();
    }, 0);
  }

  private decorateEditorElement(editor: EditableContentElement): void {
    if (editor.__nostriaEditorBridge) {
      return;
    }

    if (editor instanceof HTMLTextAreaElement) {
      editor.__nostriaEditorBridge = true;
      return;
    }

    Object.defineProperties(editor, {
      value: {
        configurable: true,
        get: () => this.readEditorValue(editor),
        set: (value: string) => this.writeEditorValue(editor, value ?? ''),
      },
      selectionStart: {
        configurable: true,
        get: () => this.getEditorSelection(editor)?.start ?? 0,
      },
      selectionEnd: {
        configurable: true,
        get: () => this.getEditorSelection(editor)?.end ?? 0,
      },
      setSelectionRange: {
        configurable: true,
        value: (start: number, end: number) => this.setEditorSelection(editor, start, end),
      },
    });

    editor.__nostriaEditorBridge = true;
  }

  private readEditorValue(editor: HTMLElement): string {
    if (editor instanceof HTMLTextAreaElement) {
      return editor.value
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
    }

    const readNode = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) {
        return (node.textContent ?? '');
      }

      if (node instanceof HTMLElement) {
        if (node.dataset['mediaToken']) {
          return node.dataset['mediaToken'];
        }

        if (node.dataset['referenceToken']) {
          return node.dataset['referenceToken'];
        }
      }

      let text = '';
      node.childNodes.forEach(child => {
        text += readNode(child);
      });
      return text;
    };

    return readNode(editor)
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
  }

  private writeEditorValue(editor: HTMLElement, value: string): void {
    if (editor instanceof HTMLTextAreaElement) {
      if (editor.value !== value) {
        editor.value = value;
      }
      return;
    }

    if (this.readEditorValue(editor) === value) {
      return;
    }

    const fragment = document.createDocumentFragment();
    const segments = this.buildEditorMediaSegments(value);

    for (const segment of segments) {
      if (segment.type === 'text') {
        fragment.appendChild(document.createTextNode(segment.value));
        continue;
      }

      if (segment.type === 'event') {
        const preview = segment.referencePreview;
        if (!preview) {
          fragment.appendChild(document.createTextNode(segment.value));
          continue;
        }

        const chip = document.createElement('span');
        chip.className = 'composer-inline-reference-chip composer-inline-reference-chip-event';
        chip.contentEditable = 'false';
        chip.dataset['referenceToken'] = segment.value;

        const icon = document.createElement('span');
        icon.className = 'composer-inline-reference-chip-icon material-symbols-outlined';
        icon.textContent = 'bolt';
        chip.appendChild(icon);

        const label = document.createElement('span');
        label.className = 'composer-inline-reference-chip-label';
        label.textContent = preview.label;
        chip.appendChild(label);

        if (preview.secondaryLabel) {
          const secondary = document.createElement('span');
          secondary.className = 'composer-inline-reference-chip-secondary';
          secondary.textContent = preview.secondaryLabel;
          chip.appendChild(secondary);
        }

        fragment.appendChild(chip);
        continue;
      }

      const media = segment.media;
      if (!media) {
        fragment.appendChild(document.createTextNode(segment.value));
        continue;
      }

      const chip = document.createElement('span');
      chip.className = 'composer-inline-media-chip';
      chip.contentEditable = 'false';
      chip.dataset['mediaToken'] = segment.value;
      chip.draggable = true;
      chip.addEventListener('dragstart', this.onInlineMediaDragStart);
      chip.addEventListener('dragend', this.onInlineMediaDragEnd);

      const image = document.createElement('img');
      image.className = 'composer-inline-media-chip-thumb';
      image.src = this.getMediaThumbnailUrl(media);
      image.alt = media.fileName || 'Attachment';
      image.title = media.fileName || 'Attachment';
      chip.appendChild(image);

      const label = document.createElement('span');
      label.className = 'composer-inline-media-chip-label';
      label.textContent = media.pendingUpload ? 'Image' : 'Attachment';
      chip.appendChild(label);

      fragment.appendChild(chip);
    }

    editor.replaceChildren(fragment);
  }

  private refreshEditorContent(): void {
    if (!this.useNewEditorExperience() || !this.editorBridgeReady()) {
      return;
    }

    const editor = this.contentTextarea?.nativeElement;
    if (!editor) {
      return;
    }

    this.writeEditorValue(editor, this.content());
  }

  private readonly onInlineMediaDragStart = (event: DragEvent): void => {
    const chip = event.currentTarget as HTMLElement | null;
    const token = chip?.dataset['mediaToken'];
    if (!token || !event.dataTransfer) {
      return;
    }

    this.draggedInlineMediaToken = token;
    event.dataTransfer.setData(INLINE_MEDIA_DRAG_TYPE, token);
    event.dataTransfer.effectAllowed = 'move';
  };

  private readonly onInlineMediaDragEnd = (): void => {
    this.draggedInlineMediaToken = null;
  };

  private isInternalInlineMediaDrag(event: DragEvent): boolean {
    const types = event.dataTransfer?.types;
    return !!types && Array.from(types).includes(INLINE_MEDIA_DRAG_TYPE);
  }

  private getInsertionAnchorFromDropPoint(event: DragEvent): number | null {
    const editor = this.contentTextarea?.nativeElement;
    if (!editor) {
      return null;
    }

    const pointCaret = (document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    });

    if (pointCaret.caretPositionFromPoint) {
      const position = pointCaret.caretPositionFromPoint(event.clientX, event.clientY);
      if (position && editor.contains(position.offsetNode)) {
        return this.getEditorOffset(editor, position.offsetNode, position.offset);
      }
    }

    if (pointCaret.caretRangeFromPoint) {
      const range = pointCaret.caretRangeFromPoint(event.clientX, event.clientY);
      if (range && editor.contains(range.startContainer)) {
        return this.getEditorOffset(editor, range.startContainer, range.startOffset);
      }
    }

    return this.getCurrentInsertionAnchor();
  }

  private moveInlineMediaToken(token: string, targetAnchor: number): void {
    const currentContent = this.content();
    const currentIndex = currentContent.indexOf(token);
    if (currentIndex < 0) {
      return;
    }

    const before = currentContent.substring(0, currentIndex);
    const after = currentContent.substring(currentIndex + token.length);
    let contentWithoutToken = before + after;
    let adjustedAnchor = targetAnchor;

    if (adjustedAnchor > currentIndex) {
      adjustedAnchor -= token.length;
    }

    if (before.endsWith(' ') && after.startsWith(' ')) {
      contentWithoutToken = before + after.substring(1);
      if (adjustedAnchor > currentIndex) {
        adjustedAnchor -= 1;
      }
    }

    const clampedAnchor = Math.max(0, Math.min(adjustedAnchor, contentWithoutToken.length));
    const insertBefore = contentWithoutToken.substring(0, clampedAnchor);
    const insertAfter = contentWithoutToken.substring(clampedAnchor);
    const needsSpaceBefore = insertBefore.length > 0 && !insertBefore.endsWith(' ') && !insertBefore.endsWith('\n');
    const needsSpaceAfter = insertAfter.length > 0 && !insertAfter.startsWith(' ') && !insertAfter.startsWith('\n');
    const prefix = needsSpaceBefore ? ' ' : '';
    const suffix = needsSpaceAfter ? ' ' : '';
    const nextContent = insertBefore + prefix + token + suffix + insertAfter;
    const nextCursorPosition = clampedAnchor + prefix.length + token.length + suffix.length;

    this.content.set(nextContent);
    this.lastCursorPosition = nextCursorPosition;
    this.refreshEditorContent();
    this.setCursorAfterRender(nextCursorPosition);
  }

  private getEditorSelection(editor: HTMLElement): EditorSelectionRange | null {
    if (typeof window === 'undefined') {
      return null;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) {
      return null;
    }

    return {
      start: this.getEditorOffset(editor, range.startContainer, range.startOffset),
      end: this.getEditorOffset(editor, range.endContainer, range.endOffset),
    };
  }

  private getEditorOffset(root: HTMLElement, node: Node, offset: number): number {
    let total = 0;

    const visit = (current: Node): boolean => {
      if (current === node) {
        if (current.nodeType === Node.TEXT_NODE) {
          total += offset;
        } else {
          const children = Array.from(current.childNodes);
          for (let index = 0; index < offset; index++) {
            total += this.getEditorNodeTextLength(children[index]);
          }
        }
        return true;
      }

      if (current instanceof HTMLElement && (current.dataset['mediaToken'] || current.dataset['referenceToken'])) {
        total += (current.dataset['mediaToken'] || current.dataset['referenceToken'] || '').length;
        return false;
      }

      if (current.nodeType === Node.TEXT_NODE) {
        total += current.textContent?.length ?? 0;
        return false;
      }

      for (const child of Array.from(current.childNodes)) {
        if (visit(child)) {
          return true;
        }
      }

      return false;
    };

    visit(root);
    return total;
  }

  private setEditorSelection(editor: HTMLElement, start: number, end: number): void {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return;
    }

    const selection = window.getSelection();
    if (!selection) {
      return;
    }

    const range = document.createRange();
    const startPoint = this.resolveEditorPoint(editor, start);
    const endPoint = this.resolveEditorPoint(editor, end);

    range.setStart(startPoint.node, startPoint.offset);
    range.setEnd(endPoint.node, endPoint.offset);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  private resolveEditorPoint(root: HTMLElement, targetOffset: number): { node: Node; offset: number } {
    let remaining = Math.max(0, targetOffset);

    const visit = (current: Node): { node: Node; offset: number } | null => {
      if (current instanceof HTMLElement && (current.dataset['mediaToken'] || current.dataset['referenceToken'])) {
        const tokenLength = (current.dataset['mediaToken'] || current.dataset['referenceToken'] || '').length;
        if (remaining <= tokenLength) {
          const parent = current.parentNode ?? root;
          const index = Array.from(parent.childNodes).indexOf(current);
          return { node: parent, offset: index + (remaining < tokenLength ? 0 : 1) };
        }

        remaining -= tokenLength;
        return null;
      }

      if (current.nodeType === Node.TEXT_NODE) {
        const length = current.textContent?.length ?? 0;
        if (remaining <= length) {
          return { node: current, offset: remaining };
        }

        remaining -= length;
        return null;
      }

      for (const child of Array.from(current.childNodes)) {
        const result = visit(child);
        if (result) {
          return result;
        }
      }

      return null;
    };

    const resolved = visit(root);
    if (resolved) {
      return resolved;
    }

    if (root.lastChild && root.lastChild.nodeType === Node.TEXT_NODE) {
      const lastText = root.lastChild;
      return { node: lastText, offset: lastText.textContent?.length ?? 0 };
    }

    return { node: root, offset: root.childNodes.length };
  }

  private getEditorNodeTextLength(node: Node | undefined): number {
    if (!node) {
      return 0;
    }

    if (node instanceof HTMLElement && (node.dataset['mediaToken'] || node.dataset['referenceToken'])) {
      return (node.dataset['mediaToken'] || node.dataset['referenceToken'] || '').length;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent?.length ?? 0;
    }

    return Array.from(node.childNodes).reduce((sum, child) => sum + this.getEditorNodeTextLength(child), 0);
  }

  private buildEditorMediaSegments(value: string): EditorMediaSegment[] {
    if (!value) {
      return [{ type: 'text', value: '' }];
    }

    const references = this.mediaMetadata()
      .map(media => ({ media, reference: this.getMediaContentReference(media) }))
      .filter(entry => !!entry.reference)
      .sort((a, b) => b.reference.length - a.reference.length);

    const eventReferences = this.getInlineEventReferencePreviews(value);

    if (references.length === 0 && eventReferences.length === 0) {
      return [{ type: 'text', value }];
    }

    const segments: EditorMediaSegment[] = [];
    let cursor = 0;

    while (cursor < value.length) {
      const match = references.find(entry => value.startsWith(entry.reference, cursor));
      const eventMatch = eventReferences.find(entry => value.startsWith(entry.reference, cursor));

      if (!match && !eventMatch) {
        const nextIndex = references
          .map(entry => value.indexOf(entry.reference, cursor))
          .concat(eventReferences.map(entry => value.indexOf(entry.reference, cursor)))
          .filter(index => index >= 0)
          .sort((a, b) => a - b)[0] ?? value.length;

        segments.push({
          type: 'text',
          value: value.slice(cursor, nextIndex),
        });
        cursor = nextIndex;
        continue;
      }

      if (eventMatch && (!match || eventMatch.reference.length >= match.reference.length)) {
        segments.push({
          type: 'event',
          value: eventMatch.reference,
          referencePreview: eventMatch.preview,
        });
        cursor += eventMatch.reference.length;
        continue;
      }

      if (!match) {
        break;
      }

      segments.push({
        type: 'media',
        value: match.reference,
        media: match.media,
      });
      cursor += match.reference.length;
    }

    return segments;
  }

  private getInlineEventReferencePreviews(value: string): { reference: string; preview: ComposerReferencePreview }[] {
    const matches = value.match(/(?:nostr:)?(?:note|nevent)1[a-zA-Z0-9]+/g) ?? [];
    return matches
      .map(reference => ({
        reference,
        preview: this.buildComposerReferencePreview(reference),
      }))
      .filter((entry): entry is { reference: string; preview: ComposerReferencePreview } => !!entry.preview && entry.preview.type === 'event');
  }

  private scheduleTextareaRefresh(
    cursorPosition?: number,
    focus = false,
    followCaret = false,
    restoreSelection = true,
    restoreScrollPosition = true,
  ): void {
    const textarea = this.contentTextarea?.nativeElement;
    if (!textarea) {
      return;
    }

    if (!textarea.__nostriaEditorBridge) {
      this.decorateEditorElement(textarea);
      this.writeEditorValue(textarea, this.content());
    }

    const dialogContentWrapper = this.dialogContentWrapper?.nativeElement;
    const shouldRestoreSelection = restoreSelection && (typeof cursorPosition === 'number' || document.activeElement === textarea);
    const shouldScrollToBottom = followCaret && this.shouldKeepTextareaScrolledToBottom(textarea, cursorPosition);
    const selectionStart = typeof cursorPosition === 'number' ? cursorPosition : textarea.selectionStart;
    const selectionEnd = typeof cursorPosition === 'number' ? cursorPosition : textarea.selectionEnd;
    const textareaScrollTop = textarea.scrollTop;
    const dialogScrollTop = dialogContentWrapper?.scrollTop ?? null;
    const dialogWasAtBottom = dialogContentWrapper
      ? dialogContentWrapper.scrollHeight - dialogContentWrapper.scrollTop <= dialogContentWrapper.clientHeight + 5
      : false;

    if (this.textareaRefreshFrame !== null) {
      cancelAnimationFrame(this.textareaRefreshFrame);
    }

    this.textareaRefreshFrame = requestAnimationFrame(() => {
      this.textareaRefreshFrame = null;
      const textarea = this.contentTextarea?.nativeElement;
      if (!textarea) {
        return;
      }

      const dialogContentWrapper = this.dialogContentWrapper?.nativeElement;

      if (focus && document.activeElement !== textarea) {
        textarea.focus({ preventScroll: true });
      }

      this.syncTextareaHeight(textarea);

      if (this.isKeyboardCompactMode() && dialogContentWrapper) {
        dialogContentWrapper.scrollTop = 0;
      }

      if (shouldRestoreSelection && selectionStart !== null && selectionEnd !== null) {
        textarea.setSelectionRange(selectionStart, selectionEnd);
      }

      if (shouldScrollToBottom) {
        textarea.scrollTop = textarea.scrollHeight;
      } else if (restoreScrollPosition) {
        textarea.scrollTop = textareaScrollTop;
      }

      if (dialogContentWrapper && dialogScrollTop !== null && restoreScrollPosition) {
        if (shouldScrollToBottom && dialogWasAtBottom) {
          dialogContentWrapper.scrollTop = dialogContentWrapper.scrollHeight;
        } else {
          dialogContentWrapper.scrollTop = dialogScrollTop;
        }
      }

      if (document.activeElement === textarea && this.isCompactDialogLayout()) {
        this.ensureCaretVisible(textarea);
      }
    });
  }

  private ensureCaretVisible(textarea: EditableContentElement): void {
    const caret = this.getCaretCoordinates(textarea);
    const visibleTop = textarea.scrollTop;
    const visibleBottom = textarea.scrollTop + textarea.clientHeight;
    const topPadding = 12;
    const bottomPadding = 24;
    const caretTop = caret.top;
    const caretBottom = caret.top + caret.height;

    if (caretTop < visibleTop + topPadding) {
      textarea.scrollTop = Math.max(0, caretTop - topPadding);
      return;
    }

    if (caretBottom > visibleBottom - bottomPadding) {
      textarea.scrollTop = Math.max(0, caretBottom - textarea.clientHeight + bottomPadding);
    }
  }

  private scheduleCaretVisibilityCheck(textarea: EditableContentElement): void {
    setTimeout(() => {
      if (typeof document === 'undefined' || document.activeElement !== textarea || !this.isCompactDialogLayout()) {
        return;
      }

      this.ensureCaretVisible(textarea);
    }, 0);
  }

  private shouldKeepTextareaScrolledToBottom(textarea: EditableContentElement, cursorPosition?: number): boolean {
    if (typeof document === 'undefined' || document.activeElement !== textarea) {
      return true;
    }

    const selectionStart = typeof cursorPosition === 'number' ? cursorPosition : (textarea.selectionStart ?? textarea.value.length);
    const selectionEnd = typeof cursorPosition === 'number' ? cursorPosition : (textarea.selectionEnd ?? textarea.value.length);
    return selectionStart === selectionEnd && selectionEnd === textarea.value.length;
  }

  /**
   * Focus the textarea and set cursor position after Angular's change detection
   * has updated the textarea value via [value] binding.
   */
  private setCursorAfterRender(position: number): void {
    // Use setTimeout to run after Angular's change detection updates the textarea value.
    // requestAnimationFrame can fire before CD, causing the cursor to be reset.
    setTimeout(() => {
      const textarea = this.contentTextarea?.nativeElement;
      if (!textarea) return;

      if (document.activeElement !== textarea) {
        textarea.focus({ preventScroll: true });
      }
      textarea.setSelectionRange(position, position);
      this.syncTextareaHeight(textarea);
    }, 0);
  }

  private insertTextAtSelection(text: string): void {
    const editor = this.contentTextarea?.nativeElement;
    if (!editor) {
      return;
    }

    const selection = this.getEditorSelection(editor) ?? {
      start: this.lastCursorPosition ?? this.content().length,
      end: this.lastCursorPosition ?? this.content().length,
    };
    const currentContent = this.content();
    const nextContent = currentContent.substring(0, selection.start) + text + currentContent.substring(selection.end);
    const nextCursor = selection.start + text.length;

    this.content.set(nextContent);
    this.lastCursorPosition = nextCursor;

    if (this.useNewEditorExperience()) {
      this.refreshEditorContent();
    }

    this.scheduleTextareaRefresh(nextCursor, true, true);
  }

  private clearCompactTextareaSize(): void {
    this.noteEditorLayout?.nativeElement.style.removeProperty('--note-editor-mobile-textarea-max-height');
    this.noteEditorLayout?.nativeElement.style.removeProperty('--note-editor-mobile-viewport-cap');
    const dialogContentWrapper = this.dialogContentWrapper?.nativeElement;
    if (dialogContentWrapper) {
      dialogContentWrapper.scrollTop = 0;
    }
    const contentField = this.contentField?.nativeElement;
    if (contentField) {
      contentField.style.height = '';
      contentField.style.maxHeight = '';
      contentField.style.flexBasis = '';
    }
    const composerActions = this.composerActions?.nativeElement;
    if (composerActions) {
      composerActions.style.marginBottom = '';
    }
  }

  private syncTextareaHeight(textarea: EditableContentElement): void {
    if (this.inlineMode()) {
      // Inline mode: auto-grow with max-height cap
      const minHeight = 88;
      const viewportCap = Math.max(minHeight, window.innerHeight - 220);
      const maxHeight = Math.min(200, viewportCap);

      textarea.style.maxHeight = 'none';
      textarea.style.height = 'auto';

      const nextHeight = Math.max(minHeight, textarea.scrollHeight);
      const targetHeight = Math.min(nextHeight, maxHeight);

      textarea.style.height = `${targetHeight}px`;
      textarea.style.maxHeight = `${maxHeight}px`;
      textarea.style.overflowY = nextHeight > maxHeight ? 'auto' : 'hidden';
    } else if (this.isCompactDialogLayout()) {
      if (!this.isKeyboardCompactMode()) {
        this.clearCompactTextareaSize();
        textarea.style.height = '';
        textarea.style.maxHeight = '';
        textarea.style.overflowY = 'auto';
        return;
      }

      const visualViewport = window.visualViewport;
      const viewportHeight = visualViewport?.height ?? window.innerHeight;
      const viewportBottom = viewportHeight;
      const wrapperRect = this.dialogContentWrapper?.nativeElement.getBoundingClientRect();
      const composerActions = this.composerActions?.nativeElement;
      const footerGap = 8;
      const visibleBottom = viewportHeight - footerGap;
      if (composerActions) {
        composerActions.style.marginBottom = '';
        const footerRect = composerActions.getBoundingClientRect();
        const footerOverflow = Math.max(0, Math.ceil(footerRect.bottom - visibleBottom));
        composerActions.style.marginBottom = footerOverflow > 0 ? `${footerOverflow}px` : '';
      }
      const composerActionsRect = composerActions?.getBoundingClientRect();
      const textareaRect = textarea.getBoundingClientRect();
      const footerTop = composerActionsRect?.top;
      const containerBottom = footerTop ? Math.min(footerTop - footerGap, visibleBottom) : (wrapperRect?.bottom ?? visibleBottom);
      const bottomLimit = Math.min(containerBottom - footerGap, visibleBottom);
      const minHeight = Math.min(140, Math.max(96, window.innerHeight * 0.18));
      const availableHeight = Math.max(0, Math.floor(bottomLimit - textareaRect.top));
      const maxHeightSource = footerTop ? footerTop - 16 : (wrapperRect?.bottom ?? viewportBottom);
      const maxHeight = Math.max(0, Math.floor(maxHeightSource - textareaRect.top));
      const boundedMinHeight = Math.min(minHeight, Math.max(72, availableHeight));
      const targetHeight = Math.max(boundedMinHeight, Math.min(availableHeight, maxHeight));
      const nextHeight = `${targetHeight}px`;

      this.noteEditorLayout?.nativeElement.style.setProperty('--note-editor-mobile-viewport-cap', `${Math.floor(viewportHeight)}px`);
      this.noteEditorLayout?.nativeElement.style.setProperty('--note-editor-mobile-textarea-max-height', nextHeight);
      const contentField = this.contentField?.nativeElement;
      if (contentField) {
        contentField.style.height = nextHeight;
        contentField.style.maxHeight = nextHeight;
        contentField.style.flexBasis = nextHeight;
      }

      textarea.style.overflowY = 'auto';
      textarea.style.height = nextHeight;
      textarea.style.maxHeight = nextHeight;
    } else {
      this.clearCompactTextareaSize();

      // Desktop dialog mode: auto-grow from min-height up to a max-height, then scroll.
      // Keep a stable max-height for all non-compact layouts (width > 700px and height > 700px)
      // so the editor does not shrink between medium-height desktop viewports.
      const minHeight = 120;
      const maxHeight = 400;

      textarea.style.maxHeight = 'none';
      textarea.style.height = 'auto';

      const nextHeight = Math.max(minHeight, textarea.scrollHeight);
      const targetHeight = Math.min(nextHeight, maxHeight);

      textarea.style.height = `${targetHeight}px`;
      textarea.style.maxHeight = `${maxHeight}px`;
      textarea.style.overflowY = nextHeight > maxHeight ? 'auto' : 'hidden';
    }
  }

  /**
   * Check if the dialog is in compact/mobile CSS layout mode.
   * Must match the CSS media query: (max-width: 700px) or (max-height: 700px).
   * This is broader than layout.isHandset() which only checks width.
   */
  private isCompactDialogLayout(): boolean {
    return this.layout.isHandset() || window.innerWidth <= 700 || window.innerHeight <= 700;
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

    // Close dialog on Escape if not in mention autocomplete, slash command menu, or other overlays
    if (event.key === 'Escape') {
      // Check if slash command menu is open
      const slashConfig = this.slashCommandConfig();
      if (slashConfig) {
        event.preventDefault();
        event.stopPropagation();
        this.onSlashCommandDismissed();
        return;
      }

      // Check if mention autocomplete is open
      const mentionConfig = this.mentionConfig();
      if (mentionConfig) {
        event.preventDefault();
        event.stopPropagation();
        this.onMentionDismissed();
      } else {
        // Nothing is open, close the dialog
        this.cancel();
      }
    }
  }

  private handleGlobalKeydown = (event: KeyboardEvent): void => {
    // Alt+D (Windows/Linux) or Cmd+D (Mac) shortcut to toggle dictation
    if (this.platformService.hasModifierKey(event) && (event.key.toLowerCase() === 'd' || event.code === 'KeyD')) {
      event.preventDefault();
      if (!this.isUploading() && !this.isPublishing() && !this.showPreview() && !this.isTranscribing()) {
        this.toggleRecording();
      }
    }
  };

  onContentKeyDown(event: KeyboardEvent): void {
    // If slash command menu is open, handle navigation keys
    const slashConfig = this.slashCommandConfig();
    if (slashConfig && this.slashCommandMenu) {
      if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) {
        this.slashCommandMenu.onKeyDown(event);
        return;
      }
    }

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

    if (this.useNewEditorExperience() && event.key === 'Enter' && !this.platformService.hasModifierKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      this.insertTextAtSelection('\n');
      return;
    }
  }

  onContentKeyUp(event: KeyboardEvent): void {
    // Ignore navigation keys that are handled in keydown to prevent resetting state
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(event.key)) {
      return;
    }

    const target = event.target as EditableContentElement;
    this.syncSlashAndMentionStateFromSelection(target);
  }

  onContentClick(event: MouseEvent): void {
    const target = event.target as EditableContentElement;
    this.syncSlashAndMentionStateFromSelection(target);
    if (this.platformService.isIOS() && this.isCompactDialogLayout()) {
      this.scheduleCaretVisibilityCheck(target);
    }
  }

  onContentSelectionChange(event: Event): void {
    const target = event.target as EditableContentElement;
    this.syncSlashAndMentionStateFromSelection(target);
    if (this.platformService.isIOS() && this.isCompactDialogLayout()) {
      this.scheduleCaretVisibilityCheck(target);
    }
  }

  private syncSlashAndMentionStateFromSelection(textarea: EditableContentElement): void {
    this.lastCursorPosition = textarea.selectionStart;
    if (textarea.selectionStart !== textarea.selectionEnd) {
      this.onMentionDismissed();
      this.onSlashCommandDismissed();
      return;
    }

    const cursorPos = textarea.selectionStart || 0;
    this.handleSlashCommandInput(this.content(), cursorPos);
    if (!this.slashCommandConfig()) {
      this.handleMentionInput(this.content(), cursorPos);
    } else {
      this.mentionConfig.set(null);
    }
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

  private calculateMentionPosition(textarea: EditableContentElement): { top: number; left: number } {
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

  private getCaretCoordinates(element: EditableContentElement): { top: number; left: number; height: number } {
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

    // Generate display name and sanitize for safe mention matching
    const name = this.mentionInputService.sanitizeDisplayName(selection.displayName || 'unknown');

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
    this.scheduleTextareaRefresh(replacement.newCursorPosition, true, true);

    // Add to mentions list for p tags
    this.addMention(selection.pubkey);

    // Hide autocomplete
    this.mentionConfig.set(null);
  }

  onMentionDismissed(): void {
    this.mentionConfig.set(null);
  }

  // --- Slash command menu ---

  /**
   * Detect if the user is typing a slash command.
   * A slash command is triggered by `/` at position 0 or preceded by a newline.
   */
  private handleSlashCommandInput(content: string, cursorPosition: number): void {
    // Walk backwards from cursor to find `/`
    let slashPos = -1;
    for (let i = cursorPosition - 1; i >= 0; i--) {
      const ch = content[i];
      if (ch === '/') {
        // `/` must be at position 0 or preceded by a newline or space
        if (i === 0 || content[i - 1] === '\n' || content[i - 1] === ' ') {
          slashPos = i;
        }
        break;
      }
      // Stop scanning if we hit a space, newline, or non-word char
      if (ch === ' ' || ch === '\n') break;
    }

    if (slashPos === -1) {
      this.slashCommandConfig.set(null);
      return;
    }

    const query = content.substring(slashPos + 1, cursorPosition);

    // Don't trigger if query contains spaces (user is typing normal text after /)
    if (query.includes(' ') || query.includes('\n')) {
      this.slashCommandConfig.set(null);
      return;
    }

    // Calculate position
    const textareaElement = this.contentTextarea?.nativeElement;
    if (textareaElement) {
      const position = this.calculateMentionPosition(textareaElement);
      this.slashCommandPosition.set(position);

      this.slashCommandConfig.set({
        cursorPosition,
        query,
        commandStart: slashPos,
      });

      // When slash menu is active, dismiss mention autocomplete
      this.mentionConfig.set(null);
    }
  }

  onSlashCommandSelected(option: SlashCommandOption): void {
    const config = this.slashCommandConfig();
    if (!config) return;

    // Remove the typed `/query` from content
    const currentContent = this.content();
    const before = currentContent.substring(0, config.commandStart);
    const after = currentContent.substring(config.cursorPosition);
    const newContent = before + after;
    this.content.set(newContent);
    this.lastCursorPosition = config.commandStart;
    this.scheduleTextareaRefresh(config.commandStart, true, true);

    // Dismiss the menu
    this.slashCommandConfig.set(null);

    // Execute the command
    switch (option.id) {
      case 'upload':
        this.openFileDialog();
        break;
      case 'library':
        this.openMediaChooser();
        break;
      case 'emoji':
        if (this.layout.isHandset()) {
          this.openEmojiPickerDialog();
        } else {
          this.openEmojiPickerDialog();
        }
        break;
      case 'gif':
        this.openGifPickerDialog();
        break;
      case 'mention':
        // Insert @ at cursor position to trigger mention autocomplete
        {
          const contentNow = this.content();
          const pos = config.commandStart;
          const updatedContent = contentNow.substring(0, pos) + '@' + contentNow.substring(pos);
          this.content.set(updatedContent);
          const newCursorPos = pos + 1;
          this.scheduleTextareaRefresh(newCursorPos, true, true);
          // Trigger mention detection at next tick
          setTimeout(() => this.handleMentionInput(this.content(), newCursorPos), 0);
        }
        break;
      case 'reference':
        this.openReferencePicker();
        break;
      case 'dictate':
        this.toggleRecording();
        break;
    }
  }

  onSlashCommandDismissed(): void {
    this.slashCommandConfig.set(null);
  }

  cancel(forceCloseAttempt = false): void {
    if (this.isPublishing() && !forceCloseAttempt) {
      return;
    }

    if (this.isPublishing() && forceCloseAttempt) {
      this.snackBar.open('Closing editor while publish is still in progress', 'Dismiss', {
        duration: 3000,
      });
    }

    // Stop PoW if running
    if (this.isPowMining()) {
      this.stopPow();
    }

    if (this.inlineMode()) {
      // In inline mode: just collapse if empty, otherwise confirm discard
      const content = this.content().trim();
      if (content) {
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: 'Discard Reply',
            message: 'Discard your reply?',
            confirmText: 'Discard',
            cancelText: 'Keep Editing',
            confirmColor: 'warn',
          },
        });

        dialogRef.afterClosed().subscribe((confirmed: boolean) => {
          if (confirmed) {
            this.content.set('');
            this.mentionMap.clear();
            this.pubkeyToNameMap.clear();
            this.mediaMetadata().forEach(media => this.revokeMediaPreviewUrls(media));
            this.mediaMetadata.set([]);
            this.isExpanded.set(false);
            this.cancelled.emit();
          }
        });
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
    this.mediaMetadata().forEach(media => this.revokeMediaPreviewUrls(media));
    this.mediaMetadata.set([...this.initialMediaMetadata]);
    this.title.set(this.initialTitle);
    this.isMediaMode.set(false);
    this.expirationEnabled.set(false);
    this.expirationDate.set(null);
    this.expirationTime.set('12:00');
    this.showPreview.set(false);
    this.showAdvancedOptions.set(false);
    this.showEventJson.set(false);
    this.clearSentimentAnalysis();

    // Clear auto-saved draft from storage
    this.clearAutoDraft();

    this.scheduleTextareaRefresh();

    this.snackBar.open('Draft cleared', 'Dismiss', {
      duration: 2000,
    });
  }

  // Preview functionality
  togglePreview(): void {
    const wasInPreview = this.showPreview();
    this.showPreview.update(current => !current);

    if (wasInPreview) {
      // Coming back from preview recreates the editor DOM, so restore the bridge first.
      this.restoreEditorAfterViewToggle();
    } else {
      // Entering preview, focus the Back button after it renders
      setTimeout(() => {
        this.backFromPreviewBtn?.nativeElement?.focus();
      }, 0);
    }
  }

  // Advanced options functionality
  toggleAdvancedOptions(): void {
    const wasInAdvancedOptions = this.showAdvancedOptions();
    this.showAdvancedOptions.update(current => !current);

    if (wasInAdvancedOptions) {
      this.restoreEditorAfterViewToggle();
    }
  }

  onNoteEditorExperienceToggle(enabled: boolean): void {
    this.localSettings.setNoteEditorNewExperience(enabled);
    this.editorBridgeReady.set(false);
  }

  async analyzeSentimentInline(): Promise<void> {
    const text = this.content().trim();
    if (!text || this.isSentimentAnalyzing()) {
      return;
    }

    this.isSentimentAnalyzing.set(true);
    this.sentimentError.set('');
    this.sentimentResult.set(null);
    this.sentimentRequestedText.set(text);

    try {
      if (!this.aiService.sentimentModelLoaded()) {
        await this.aiService.loadModel('sentiment-analysis', this.aiService.sentimentModelId);
      }

      const result = await this.aiService.analyzeSentiment(text) as SentimentAnalysisResult[];
      if (Array.isArray(result) && result.length > 0) {
        this.sentimentResult.set(result[0]);
        this.sentimentResultText.set(text);
      } else {
        this.sentimentError.set('No sentiment result returned.');
        this.sentimentResultText.set(text);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sentiment analysis failed';
      if (message === 'AI Sentiment Analysis is disabled') {
        this.sentimentError.set('Sentiment analysis is disabled in AI settings.');
      } else {
        this.sentimentError.set(message || 'Sentiment analysis failed');
      }
      this.sentimentResultText.set(text);
    } finally {
      this.isSentimentAnalyzing.set(false);
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

  async onMediaOptimizationChange(optimization: MediaOptimizationOptionValue): Promise<void> {
    const settings = {
      ...getMediaUploadSettingsForOptimization(optimization),
      videoOptimizationProfile: this.videoOptimizationProfile(),
    };
    const changed = settings.mode !== this.mediaUploadMode()
      || settings.compressionStrength !== this.compressionStrength()
      || settings.videoOptimizationProfile !== this.videoOptimizationProfile();

    this.mediaUploadMode.set(settings.mode);
    this.compressionStrength.set(settings.compressionStrength);
    this.videoOptimizationProfile.set(settings.videoOptimizationProfile ?? 'default');

    if (!changed) {
      return;
    }

    await this.reprocessPendingMediaForOptimization(settings);
  }

  isSelectedVideoOptimizationProfile(profile: VideoOptimizationProfile): boolean {
    const media = this.getVideoProfileMenuMedia();
    if (!media) {
      return false;
    }

    return this.getVideoOptimizationProfileForMedia(media) === profile;
  }

  async onVideoOptimizationProfileSelected(profile: VideoOptimizationProfile): Promise<void> {
    const media = this.getVideoProfileMenuMedia();
    if (!media) {
      return;
    }

    this.closeVideoOptimizationMenu();

    if (this.getVideoOptimizationProfileForMedia(media) === profile) {
      return;
    }

    this.mediaMetadata.update(current => current.map(item => {
      if (item.id !== media.id) {
        return item;
      }

      return {
        ...item,
        videoOptimizationProfile: profile,
      };
    }));
    this.saveAutoDraft();

    if (!media.pendingUpload || !media.id) {
      return;
    }

    await this.reprocessPendingMediaForOptimization(this.getCurrentMediaUploadSettings(), [media.id]);
  }

  onVideoOptimizationMenuClosed(): void {
    this.clearPendingVideoProfileMenuOpen();
    this.videoProfileMenuMediaId.set(null);
  }

  private getCurrentMediaUploadSettings(): MediaUploadSettings {
    return {
      mode: this.mediaUploadMode(),
      compressionStrength: this.compressionStrength(),
      videoOptimizationProfile: this.videoOptimizationProfile(),
    };
  }

  private getVideoOptimizationProfileForMedia(media: MediaMetadata): VideoOptimizationProfile {
    return media.videoOptimizationProfile ?? this.videoOptimizationProfile();
  }

  private getVideoOptimizationProfileLabelForMedia(media: MediaMetadata): string {
    return getVideoOptimizationProfileLabel(this.getVideoOptimizationProfileForMedia(media));
  }

  getVideoOptimizationProfileBadgeLabelForMedia(media: MediaMetadata): string {
    return getVideoOptimizationProfileBadgeLabel(this.getVideoOptimizationProfileForMedia(media));
  }

  private canOpenVideoOptimizationMenu(media: MediaMetadata | undefined): boolean {
    return !!media?.pendingUpload && !!media.mimeType?.startsWith('video/');
  }

  private getVideoProfileMenuMedia(): MediaMetadata | undefined {
    const mediaId = this.videoProfileMenuMediaId();
    if (!mediaId) {
      return undefined;
    }

    return this.mediaMetadata().find(media => media.id === mediaId);
  }

  private getContextMenuAnchor(
    element: HTMLElement | null,
    clientX: number,
    clientY: number,
  ): { x: number; y: number } {
    if (clientX > 0 || clientY > 0) {
      return { x: clientX, y: clientY };
    }

    const rect = element?.getBoundingClientRect();
    if (!rect) {
      return { x: 24, y: 24 };
    }

    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  private getClampedVideoProfileMenuPosition(x: number, y: number): { x: number; y: number } {
    if (typeof window === 'undefined') {
      return { x, y };
    }

    const menuWidth = 280;
    const menuHeight = 260;

    return {
      x: Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8)),
    };
  }

  private openVideoOptimizationMenu(media: MediaMetadata, x: number, y: number): void {
    if (!media.id) {
      return;
    }

    this.videoProfileMenuMediaId.set(media.id);
    this.videoProfileMenuPosition.set(this.getClampedVideoProfileMenuPosition(x, y));

    requestAnimationFrame(() => {
      this.videoProfileMenuTrigger?.openMenu();
      setTimeout(() => this.videoProfileMenuTrigger?.updatePosition(), 0);
    });
  }

  private closeVideoOptimizationMenu(): void {
    this.videoProfileMenuTrigger?.closeMenu();
    this.videoProfileMenuMediaId.set(null);
  }

  private clearPendingVideoProfileMenuOpen(): void {
    if (this.pendingVideoProfileMenuTimeout !== null) {
      clearTimeout(this.pendingVideoProfileMenuTimeout);
      this.pendingVideoProfileMenuTimeout = null;
    }
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

  formatFileSize(bytes?: number): string {
    if (!bytes || bytes <= 0) return '0 Bytes';

    const units = ['Bytes', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, exponent);
    return `${parseFloat(value.toFixed(2))} ${units[exponent]}`;
  }

  getMediaThumbnailUrl(media: MediaMetadata): string {
    if (media.mimeType?.startsWith('video/')) {
      return media.image || '';
    }

    return media.previewUrl || media.url;
  }

  getMediaThumbnailAriaLabel(media: MediaMetadata): string {
    if (this.shouldReinsertPendingMediaReference(media)) {
      return 'Reinsert pending media placeholder';
    }

    return media.pendingUpload ? 'Open optimized media preview' : 'Open media preview';
  }

  getMediaThumbnailTooltip(media: MediaMetadata): string {
    if (this.shouldReinsertPendingMediaReference(media)) {
      return 'Reinsert placeholder tag';
    }

    const baseTooltip = media.pendingUpload ? 'Open optimized preview' : 'Open preview';

    if (!this.canOpenVideoOptimizationMenu(media)) {
      return baseTooltip;
    }

    return `${baseTooltip}. Right-click or press and hold to change video type (${this.getVideoOptimizationProfileLabelForMedia(media)}).`;
  }

  getMediaThumbnailSizeLabel(media: MediaMetadata): string {
    const comparisonSize = this.getMediaComparisonSize(media);
    return this.formatCompactFileSize(comparisonSize || this.getMediaUploadSize(media) || this.getMediaOriginalSize(media));
  }

  getMediaThumbnailSavingsLabel(media: MediaMetadata): string {
    const savings = this.getMediaCompressionChangePercent(media);

    if (savings === null) {
      return '';
    }

    if (savings > 0) {
      return `-${savings}%`;
    }

    if (savings < 0) {
      return `+${Math.abs(savings)}%`;
    }

    return media.optimizedSize !== undefined ? '0%' : '';
  }

  getMediaThumbnailSavingsTone(media: MediaMetadata): 'decrease' | 'increase' | 'neutral' | 'none' {
    const savings = this.getMediaCompressionChangePercent(media);

    if (savings === null) {
      return 'none';
    }

    if (savings > 0) {
      return 'decrease';
    }

    if (savings < 0) {
      return 'increase';
    }

    return 'neutral';
  }

  getMediaUploadSize(media: MediaMetadata): number {
    return media.localFile?.size ?? media.processedSize ?? this.getMediaOriginalSize(media);
  }

  private getMediaComparisonSize(media: MediaMetadata): number {
    return media.optimizedSize ?? media.processedSize ?? media.localFile?.size ?? this.getMediaOriginalSize(media);
  }

  private getMediaOriginalSize(media: MediaMetadata): number {
    return media.sourceFile?.size ?? media.originalSize ?? media.localFile?.size ?? 0;
  }

  private formatCompactFileSize(bytes?: number): string {
    if (!bytes || bytes <= 0) {
      return '0B';
    }

    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, exponent);

    let decimals = 0;
    if (value < 10 && exponent > 0) {
      decimals = 1;
    }

    return `${parseFloat(value.toFixed(decimals))}${units[exponent]}`;
  }

  private shouldReinsertPendingMediaReference(media: MediaMetadata): boolean {
    if (!media.pendingUpload) {
      return false;
    }

    const reference = this.getMediaContentReference(media);
    return !!reference && !this.content().includes(reference);
  }

  private getMediaCompressionChangePercent(media: MediaMetadata): number | null {
    const originalSize = this.getMediaOriginalSize(media);
    const comparisonSize = this.getMediaComparisonSize(media);

    if (originalSize <= 0 || comparisonSize <= 0) {
      return null;
    }

    return Math.round((1 - comparisonSize / originalSize) * 100);
  }

  private serializeMediaMetadata(media: MediaMetadata[]): string {
    return JSON.stringify(
      media.map(item => ({
        id: item.id,
        url: item.url,
        mimeType: item.mimeType,
        blurhash: item.blurhash,
        thumbhash: item.thumbhash,
        dimensions: item.dimensions,
        alt: item.alt,
        sha256: item.sha256,
        image: item.image,
        imageMirrors: item.imageMirrors,
        fallbackUrls: item.fallbackUrls,
        previewUrl: item.previewUrl,
        placeholderToken: item.placeholderToken,
        pendingUpload: item.pendingUpload,
        fileName: item.fileName,
        originalSize: item.originalSize,
        processedSize: item.processedSize,
        optimizedSize: item.optimizedSize,
        videoOptimizationProfile: item.videoOptimizationProfile,
        uploadOriginal: item.uploadOriginal,
        warningMessage: item.warningMessage,
      }))
    );
  }

  private getDraftMediaMetadata(): MediaMetadata[] {
    return this.mediaMetadata()
      .filter(media => !media.pendingUpload)
      .map(media => ({
        id: media.id,
        url: media.url,
        mimeType: media.mimeType,
        blurhash: media.blurhash,
        thumbhash: media.thumbhash,
        dimensions: media.dimensions,
        alt: media.alt,
        sha256: media.sha256,
        image: media.image,
        imageMirrors: media.imageMirrors,
        fallbackUrls: media.fallbackUrls,
        fileName: media.fileName,
        originalSize: media.originalSize,
        processedSize: media.processedSize,
        optimizedSize: media.optimizedSize,
        videoOptimizationProfile: media.videoOptimizationProfile,
      }));
  }

  private getDraftContent(): string {
    let draftContent = this.content();
    this.mediaMetadata()
      .filter(media => media.pendingUpload)
      .forEach(media => {
        const reference = this.getMediaContentReference(media);
        const escapedReference = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        draftContent = draftContent.replace(new RegExp('\\s*' + escapedReference + '\\s*', 'g'), ' ');
      });

    return draftContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
  }

  private getMediaContentReference(media: MediaMetadata): string {
    return media.placeholderToken || media.url;
  }

  private getPendingMediaPreviewReference(media: MediaMetadata): string {
    const previewUrl = media.mimeType?.startsWith('video/') ? media.url : (media.previewUrl || media.url);
    return this.decoratePreviewMediaUrl(previewUrl, media.mimeType);
  }

  private decoratePreviewMediaUrl(url: string, mimeType: string | undefined): string {
    if (!url.startsWith('blob:')) {
      return url;
    }

    if (mimeType?.startsWith('video/')) {
      return `${url}#nostria-video`;
    }

    if (mimeType?.startsWith('audio/')) {
      return `${url}#nostria-audio`;
    }

    return `${url}#nostria-image`;
  }

  private resolvePendingMediaReferences(content: string, forPreview = false): string {
    let resolvedContent = content;

    this.mediaMetadata()
      .filter(media => media.pendingUpload)
      .forEach(media => {
        const reference = this.getMediaContentReference(media);
        const replacement = forPreview ? this.getPendingMediaPreviewReference(media) : media.url;

        if (!reference || !replacement) {
          return;
        }

        const escapedReference = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        resolvedContent = resolvedContent.replace(new RegExp(escapedReference, 'g'), replacement);
      });

    return resolvedContent;
  }

  private createPendingMediaPlaceholder(mimeType: string): string {
    const mediaType = mimeType.startsWith('video/') ? 'video' : 'image';
    const prefix = `[${mediaType}`;
    let index = 1;

    while (this.mediaMetadata().some(media => media.placeholderToken === `${prefix}${index}]`)) {
      index++;
    }

    return `${prefix}${index}]`;
  }

  private replaceMediaPlaceholderInContent(placeholderToken: string | undefined, url: string): void {
    if (!placeholderToken) {
      return;
    }

    const currentContent = this.content();
    const placeholderIndex = currentContent.indexOf(placeholderToken);
    if (placeholderIndex >= 0) {
      const before = currentContent.substring(0, placeholderIndex);
      const after = currentContent.substring(placeholderIndex + placeholderToken.length);
      const prefix = this.endsWithMediaReference(before) ? ' ' : '';
      const suffix = this.startsWithMediaReference(after) ? ' ' : '';

      this.content.set(before + prefix + url + suffix + after);
      this.refreshEditorContent();
      this.pendingMediaInsertionAnchors.delete(placeholderToken);
      return;
    }

    if (!this.isMediaMode() && !currentContent.includes(url)) {
      const insertionAnchor = this.pendingMediaInsertionAnchors.get(placeholderToken);
      this.insertFileUrl(url, insertionAnchor);
    }

    this.pendingMediaInsertionAnchors.delete(placeholderToken);
  }

  private startsWithMediaReference(value: string): boolean {
    return /^(\[(?:image|video)\d+\]|https?:\/\/\S+|blob:\S+)/.test(value);
  }

  private endsWithMediaReference(value: string): boolean {
    return /(\[(?:image|video)\d+\]|https?:\/\/\S+|blob:\S+)$/.test(value);
  }

  private revokeMediaPreviewUrls(media: MediaMetadata | undefined): void {
    if (!media?.pendingUpload) {
      return;
    }

    for (const url of [media.previewUrl, media.image, media.url]) {
      if (url?.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }
  }

  private removeMediaReferenceFromContent(reference: string | undefined): void {
    if (!reference) {
      return;
    }

    this.pendingMediaInsertionAnchors.delete(reference);

    let currentContent = this.content();
    const escapedReference = reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    currentContent = currentContent.replace(new RegExp('\\s*' + escapedReference + '\\s*', 'g'), ' ');
    currentContent = currentContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
    this.content.set(currentContent);
    this.refreshEditorContent();
    this.scheduleTextareaRefresh();
  }

  // File upload functionality
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      void this.uploadFiles(Array.from(input.files));
    }
    // Reset the input so the same file can be selected again
    input.value = '';
  }

  async openFileDialog(): Promise<void> {
    if (!this.fileInput?.nativeElement) {
      console.warn('File input not available. Make sure preview and advanced options are closed.');
      return;
    }

    const hasMediaServers = await this.ensureConfiguredMediaServers();
    if (!hasMediaServers) {
      return;
    }

    this.fileInput.nativeElement.click();
  }

  private hasConfiguredMediaServers(): boolean {
    return this.mediaService.mediaServers().length > 0;
  }

  private async ensureConfiguredMediaServers(): Promise<boolean> {
    await this.mediaService.load();

    if (this.hasConfiguredMediaServers()) {
      return true;
    }

    this.showMediaServerWarning();
    return false;
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

    dialogRef.afterClosed().subscribe((result: boolean) => {
      if (result) {
        // Navigate to media library servers tab
        this.router.navigate(['/collections/media'], { queryParams: { tab: 'servers' } });
        // Close the note editor dialog
        this.dialogRef?.close({ published: false });
      }
    });
  }

  async openMediaChooser(): Promise<void> {
    const hasMediaServers = await this.ensureConfiguredMediaServers();
    if (!hasMediaServers) {
      return;
    }

    // Dynamically import the media chooser dialog
    const { MediaChooserDialogComponent } = await import('../media-chooser-dialog/media-chooser-dialog.component');
    type MediaChooserResult = import('../media-chooser-dialog/media-chooser-dialog.component').MediaChooserResult;

    const dialogRef = this.dialog.open(MediaChooserDialogComponent, {
      panelClass: ['material-custom-dialog-panel', 'media-chooser-dialog-panel'],
      width: '700px',
      maxWidth: '95vw',
      data: {
        multiple: true,
        mediaType: 'all',
        encryptedSelectionBehavior: 'decrypt-and-queue',
      },
    });

    dialogRef.afterClosed().subscribe((result: MediaChooserResult | undefined) => {
      if (result?.items?.length) {
        // Add selected media items to the editor
        for (const item of result.items) {
          this.addExistingMediaToEditor(item);
        }
      }
    });
  }

  private async addExistingMediaToEditor(item: { sha256: string; type: string; url: string; size: number; localFile?: File; uploadOriginal?: boolean }): Promise<void> {
    if (item.localFile) {
      await this.addQueuedMediaToEditor(item.localFile, item.uploadOriginal ?? true);
      return;
    }

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
          id: crypto.randomUUID(),
          url: urlToAdd,
          mimeType: item.type,
          sha256: item.sha256,
          fileName: item.url.split('/').pop() || 'media',
          originalSize: item.size,
          processedSize: item.size,
          optimizedSize: item.size,
        },
      ]);
    }

    // Append URL to content
    const separator = currentContent.trim() ? '\n\n' : '';
    const newContent = currentContent + separator + urlToAdd;
    this.content.set(newContent);

    const newPos = newContent.length;
    this.lastCursorPosition = newPos;
    this.setCursorAfterRender(newPos);

    this.snackBar.open('Media added to note', 'Dismiss', { duration: 2000 });
  }

  private async addQueuedMediaToEditor(file: File, uploadOriginal: boolean): Promise<void> {
    const uploadSettings: MediaUploadSettings = {
      mode: 'original',
      compressionStrength: this.compressionStrength(),
      videoOptimizationProfile: this.videoOptimizationProfile(),
    };
    const preparedFile = {
      file,
      uploadOriginal,
      optimizedSize: file.size,
    };
    const pendingMedia = await this.createPendingMediaMetadata(file, preparedFile, '', uploadSettings);
    this.mediaMetadata.set([...this.mediaMetadata(), pendingMedia]);

    if (!this.isMediaMode()) {
      const reference = pendingMedia.placeholderToken || pendingMedia.url;
      const { start, end } = this.insertFileUrl(reference);

      if (pendingMedia.placeholderToken) {
        this.pendingMediaInsertionAnchors.set(pendingMedia.placeholderToken, start);
      }

      this.lastCursorPosition = end;
      this.setCursorAfterRender(end);
    }

    this.saveAutoDraft();
    this.snackBar.open('Media added to note', 'Dismiss', { duration: 2000 });
  }

  onDragEnter(event: DragEvent): void {
    if (this.isInternalInlineMediaDrag(event)) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.dragCounter++;
    if (this.dragCounter === 1) {
      this.isDragOver.set(true);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (this.isInternalInlineMediaDrag(event)) {
      event.dataTransfer!.dropEffect = 'move';
      return;
    }

    event.stopPropagation();
    // Don't change state here, just prevent default
  }

  onDragLeave(event: DragEvent): void {
    if (this.isInternalInlineMediaDrag(event)) {
      event.preventDefault();
      return;
    }

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
    if (this.isInternalInlineMediaDrag(event)) {
      const token = event.dataTransfer?.getData(INLINE_MEDIA_DRAG_TYPE) || this.draggedInlineMediaToken;
      if (token) {
        const targetAnchor = this.getInsertionAnchorFromDropPoint(event);
        if (targetAnchor !== null) {
          this.moveInlineMediaToken(token, targetAnchor);
        }
      }
      this.draggedInlineMediaToken = null;
      return;
    }

    event.stopPropagation();
    this.dragCounter = 0;
    this.isDragOver.set(false);

    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      this.uploadFiles(Array.from(event.dataTransfer.files));
    }
  }

  private async uploadFiles(files: File[], insertionAnchor = this.getCurrentInsertionAnchor()): Promise<void> {
    if (files.length === 0) return;

    const hasMediaServers = await this.ensureConfiguredMediaServers();
    if (!hasMediaServers) {
      return;
    }

    this.isUploading.set(true);
    this.uploadStatus.set('Preparing media...');

    try {
      await this.mediaService.load();

      const totalFiles = files.length;
      let preparedFiles = 0;
      const queuedFiles: string[] = [];
      const failedFiles: { fileName: string; error: string }[] = [];
      const uploadSettings = this.getCurrentMediaUploadSettings();

      for (const [index, file] of files.entries()) {
        try {
          const fileLabel = totalFiles > 1 ? ` (${index + 1}/${totalFiles})` : '';
          this.uploadStatus.set(`Preparing ${file.name}${fileLabel}...`);

          const preparedFile = await this.mediaProcessing.prepareFileForUpload(
            file,
            uploadSettings,
            progress => {
              const progressSuffix = progress.progress !== undefined
                ? ` ${Math.round(progress.progress * 100)}%`
                : '';
              this.uploadStatus.set(`${progress.message}${progressSuffix}${fileLabel}`);
            }
          );

          const pendingMedia = await this.createPendingMediaMetadata(file, preparedFile, fileLabel, uploadSettings);
          this.mediaMetadata.set([...this.mediaMetadata(), pendingMedia]);

          if (!this.isMediaMode()) {
            const reference = pendingMedia.placeholderToken || pendingMedia.url;
            const { start, end } = this.insertFileUrl(reference, insertionAnchor);

            if (pendingMedia.placeholderToken) {
              this.pendingMediaInsertionAnchors.set(pendingMedia.placeholderToken, start);
            }

            insertionAnchor = end;
          }

          preparedFiles++;
          if (preparedFiles < totalFiles) {
            this.uploadStatus.set(`Prepared ${preparedFiles}/${totalFiles} files...`);
          }
          queuedFiles.push(file.name);
        } catch (error) {
          failedFiles.push({
            fileName: file.name,
            error: error instanceof Error ? error.message : 'Upload failed',
          });
        }
      }

      if (failedFiles.length > 0) {
        const errorMessages = failedFiles
          .map(f => `${f.fileName}: ${f.error}`)
          .join('\n');

        this.snackBar.open(
          `Failed to prepare ${failedFiles.length} file(s):\n${errorMessages}`,
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

  private async createPendingMediaMetadata(
    originalFile: File,
    preparedFile: { file: File; uploadOriginal: boolean; optimizedSize?: number; warningMessage?: string },
    fileLabel: string,
    uploadSettings: MediaUploadSettings,
    existingMedia?: MediaMetadata,
  ): Promise<MediaMetadata> {
    const mimeType = this.mediaService.getFileMimeType(preparedFile.file);
    const previewUrl = URL.createObjectURL(preparedFile.file);
    const placeholderToken = existingMedia?.placeholderToken ?? this.createPendingMediaPlaceholder(mimeType);

    const pendingMedia: MediaMetadata = {
      id: existingMedia?.id ?? crypto.randomUUID(),
      url: previewUrl,
      mimeType,
      previewUrl: mimeType.startsWith('image/') ? previewUrl : undefined,
      placeholderToken,
      pendingUpload: true,
      fileName: originalFile.name,
      originalSize: originalFile.size,
      processedSize: preparedFile.file.size,
      optimizedSize: preparedFile.optimizedSize ?? preparedFile.file.size,
      videoOptimizationProfile: mimeType.startsWith('video/')
        ? (existingMedia?.videoOptimizationProfile ?? uploadSettings.videoOptimizationProfile ?? 'default')
        : undefined,
      localFile: preparedFile.file,
      sourceFile: originalFile,
      uploadOriginal: preparedFile.uploadOriginal,
      warningMessage: preparedFile.warningMessage,
    };

    if (mimeType.startsWith('video/')) {
      this.uploadStatus.set(`Extracting video thumbnail${fileLabel}...`);
      const thumbnailData = await this.extractPendingVideoThumbnail(preparedFile.file);
      pendingMedia.image = thumbnailData.objectUrl;
      pendingMedia.thumbnailBlob = thumbnailData.blob;
      pendingMedia.dimensions = thumbnailData.dimensions;
      pendingMedia.blurhash = thumbnailData.blurhash;
      pendingMedia.thumbhash = thumbnailData.thumbhash;
    }

    return pendingMedia;
  }

  private async reprocessPendingMediaForOptimization(settings: MediaUploadSettings, mediaIds?: string[]): Promise<void> {
    const pendingMedia = this.mediaMetadata().filter(media => {
      if (!media.pendingUpload || (!media.sourceFile && !media.localFile)) {
        return false;
      }

      if (!mediaIds || mediaIds.length === 0) {
        return true;
      }

      return !!media.id && mediaIds.includes(media.id);
    });
    if (pendingMedia.length === 0) {
      return;
    }

    const runId = ++this.pendingMediaOptimizationRunId;
    const isStale = (): boolean => runId !== this.pendingMediaOptimizationRunId;

    const currentMetadata = [...this.mediaMetadata()];
    const failedFiles: string[] = [];

    this.isUploading.set(true);
    this.uploadStatus.set('Updating media optimization...');

    try {
      for (const [index, pending] of pendingMedia.entries()) {
        if (isStale()) {
          return;
        }

        const sourceFile = pending.sourceFile ?? pending.localFile;
        if (!sourceFile) {
          continue;
        }

        const fileLabel = pendingMedia.length > 1 ? ` (${index + 1}/${pendingMedia.length})` : '';
        this.uploadStatus.set(`Updating ${sourceFile.name}${fileLabel}...`);

        try {
          const mediaSettings = this.getUploadSettingsForPendingMedia(pending, settings);
          const preparedFile = await this.mediaProcessing.prepareFileForUpload(
            sourceFile,
            mediaSettings,
            progress => {
              if (isStale()) {
                return;
              }

              const progressSuffix = progress.progress !== undefined
                ? ` ${Math.round(progress.progress * 100)}%`
                : '';
              this.uploadStatus.set(`${progress.message}${progressSuffix}${fileLabel}`);
            }
          );

          if (isStale()) {
            return;
          }

          const refreshedMedia = await this.createPendingMediaMetadata(sourceFile, preparedFile, fileLabel, mediaSettings, pending);
          if (isStale()) {
            this.revokeMediaPreviewUrls(refreshedMedia);
            return;
          }

          const metadataIndex = currentMetadata.findIndex(item => item.id === pending.id);
          if (metadataIndex >= 0) {
            currentMetadata[metadataIndex] = refreshedMedia;
          }

          this.revokeMediaPreviewUrls(pending);
        } catch (error) {
          failedFiles.push(sourceFile.name || `media ${index + 1}`);
          console.error('Failed to update pending media optimization', error);
        }
      }

      if (isStale()) {
        return;
      }

      this.mediaMetadata.set(currentMetadata);
      this.saveAutoDraft();

      if (failedFiles.length > 0) {
        this.snackBar.open(
          `Failed to update optimization for ${failedFiles.length} file(s).`,
          'Close',
          {
            duration: 6000,
            panelClass: 'error-snackbar',
          }
        );
      }
    } finally {
      if (!isStale()) {
        this.isUploading.set(false);
        this.uploadStatus.set('');
      }
    }
  }

  private getUploadSettingsForPendingMedia(media: MediaMetadata, settings: MediaUploadSettings): MediaUploadSettings {
    if (!media.mimeType?.startsWith('video/')) {
      return settings;
    }

    return {
      ...settings,
      videoOptimizationProfile: this.getVideoOptimizationProfileForMedia(media),
    };
  }

  private async extractPendingVideoThumbnail(videoFile: File): Promise<{
    blob: Blob;
    objectUrl: string;
    dimensions: { width: number; height: number };
    blurhash?: string;
    thumbhash?: string;
  }> {
    const localVideoUrl = URL.createObjectURL(videoFile);

    try {
      const thumbnailResult = await this.utilities.extractThumbnailFromVideo(localVideoUrl, 1);
      const thumbnailFile = new File([thumbnailResult.blob], 'thumbnail.jpg', {
        type: 'image/jpeg',
      });
      const placeholderResult = await this.imagePlaceholder.generatePlaceholders(thumbnailFile);

      return {
        blob: thumbnailResult.blob,
        objectUrl: thumbnailResult.objectUrl,
        dimensions: thumbnailResult.dimensions,
        blurhash: placeholderResult.blurhash,
        thumbhash: placeholderResult.thumbhash,
      };
    } finally {
      URL.revokeObjectURL(localVideoUrl);
    }
  }

  private async uploadPendingMediaBeforePublish(): Promise<boolean> {
    const pendingMedia = this.mediaMetadata().filter(media => media.pendingUpload && media.localFile);
    if (pendingMedia.length === 0) {
      return true;
    }

    const hasMediaServers = await this.ensureConfiguredMediaServers();
    if (!hasMediaServers) {
      return false;
    }

    this.isUploading.set(true);
    this.uploadStatus.set('Uploading media...');

    try {
      await this.mediaService.load();

      const currentMetadata = [...this.mediaMetadata()];
      const failedUploads: { fileName: string; error: string }[] = [];

      for (const [index, pending] of pendingMedia.entries()) {
        if (!pending.localFile) {
          continue;
        }

        const fileLabel = pendingMedia.length > 1 ? ` (${index + 1}/${pendingMedia.length})` : '';
        const uploadSize = this.getMediaUploadSize(pending);
        const isCompressed = !!pending.originalSize && uploadSize > 0 && uploadSize < pending.originalSize;

        if (pending.mimeType?.startsWith('video/') || pending.mimeType?.startsWith('image/')) {
          this.uploadStatus.set(`${isCompressed ? 'Uploading compressed media' : 'Uploading media'}${fileLabel}...`);
        } else {
          this.uploadStatus.set(`Uploading file${fileLabel}...`);
        }

        const result = await this.mediaService.uploadFile(
          pending.localFile,
          pending.uploadOriginal ?? false,
          this.mediaService.mediaServers()
        );

        if (result.status !== 'success' || !result.item) {
          failedUploads.push({
            fileName: pending.fileName || pending.localFile.name,
            error: result.message || 'Upload failed',
          });
          continue;
        }

        this.uploadStatus.set(`Processing metadata${fileLabel}...`);
        const thumbnailData = pending.thumbnailBlob && pending.dimensions
          ? {
            blob: pending.thumbnailBlob,
            dimensions: pending.dimensions,
            blurhash: pending.blurhash,
            thumbhash: pending.thumbhash,
          }
          : undefined;

        const uploadedMetadata = await this.extractMediaMetadata(
          pending.localFile,
          result.item.url,
          result.item.sha256,
          result.item.mirrors,
          thumbnailData
        );

        const updatedMedia: MediaMetadata = {
          id: pending.id,
          url: uploadedMetadata?.url ?? result.item.url,
          mimeType: uploadedMetadata?.mimeType ?? pending.mimeType,
          blurhash: uploadedMetadata?.blurhash,
          thumbhash: uploadedMetadata?.thumbhash,
          dimensions: uploadedMetadata?.dimensions ?? pending.dimensions,
          alt: uploadedMetadata?.alt ?? pending.alt,
          sha256: uploadedMetadata?.sha256 ?? result.item.sha256,
          image: uploadedMetadata?.image,
          imageMirrors: uploadedMetadata?.imageMirrors,
          fallbackUrls: uploadedMetadata?.fallbackUrls ?? (result.item.mirrors?.length ? result.item.mirrors : undefined),
          fileName: pending.fileName,
          originalSize: pending.originalSize,
          processedSize: pending.processedSize,
          optimizedSize: pending.optimizedSize,
          pendingUpload: false,
        };

        const metadataIndex = currentMetadata.findIndex(media => media.id === pending.id);
        if (metadataIndex >= 0) {
          currentMetadata[metadataIndex] = updatedMedia;
          this.mediaMetadata.set([...currentMetadata]);
        }

        this.replaceMediaPlaceholderInContent(pending.placeholderToken, updatedMedia.url);
        this.revokeMediaPreviewUrls(pending);
      }

      if (failedUploads.length > 0) {
        const errorMessages = failedUploads.map(f => `${f.fileName}: ${f.error}`).join('\n');
        this.snackBar.open(
          `Failed to upload ${failedUploads.length} file(s):\n${errorMessages}`,
          'Close',
          {
            duration: 8000,
            panelClass: 'error-snackbar',
          }
        );
        return false;
      }

      this.scheduleTextareaRefresh();
      return true;
    } catch (error) {
      this.snackBar.open(
        'Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error'),
        'Close',
        {
          duration: 5000,
          panelClass: 'error-snackbar',
        }
      );
      return false;
    } finally {
      this.isUploading.set(false);
      this.uploadStatus.set('');
    }
  }

  setMediaMode(enabled: boolean): void {
    this.isMediaMode.set(enabled);

    let currentContent = this.content();
    const mediaReferences = this.mediaMetadata().map(m => this.getMediaContentReference(m));

    if (enabled) {
      // Remove URLs
      mediaReferences.forEach(url => {
        // Escape special regex characters in URL
        const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Create global regex
        const regex = new RegExp(escapedUrl, 'g');
        currentContent = currentContent.replace(regex, '').trim();
      });
    } else {
      // Add URLs if missing
      mediaReferences.forEach(url => {
        if (!currentContent.includes(url)) {
          currentContent += (currentContent ? '\n' : '') + url;
        }
      });
    }
    this.content.set(currentContent);
  }

  private getCurrentInsertionAnchor(): number {
    const currentContent = this.content();
    const textarea = this.contentTextarea?.nativeElement;

    if (!textarea) {
      return this.lastCursorPosition ?? currentContent.length;
    }

    const isFocused = document.activeElement === textarea;
    return isFocused ? (textarea.selectionStart ?? currentContent.length) : (this.lastCursorPosition ?? currentContent.length);
  }

  private insertFileUrl(url: string, insertionAnchor?: number): { start: number; end: number } {
    const currentContent = this.content();
    const textarea = this.contentTextarea?.nativeElement;
    const cursorPosition = insertionAnchor ?? this.getCurrentInsertionAnchor();

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
    this.refreshEditorContent();

    const insertionStart = cursorPosition + prefix.length;
    const newCursorPosition = cursorPosition + prefix.length + url.length + suffix.length;
    this.lastCursorPosition = newCursorPosition;

    if (textarea) {
      this.setCursorAfterRender(newCursorPosition);
    }

    return {
      start: insertionStart,
      end: newCursorPosition,
    };
  }

  private async handlePaste(event: ClipboardEvent): Promise<void> {
    const clipboardData = event.clipboardData;
    if (!clipboardData) {
      return;
    }

    const items = Array.from(clipboardData.items ?? []);
    const pastedHtml = clipboardData.getData('text/html') || '';
    const htmlContainsImage = /<img\b/i.test(pastedHtml);
    let text = clipboardData.getData('text/plain') || '';
    if (!text && pastedHtml) {
      text = this.extractPlainTextFromHtml(pastedHtml);
    }

    const normalizedText = text ? this.normalizePastedText(text) : '';
    const hasDirectMediaFiles = items.some(item => {
      if (item.kind !== 'file') {
        return false;
      }

      const file = item.getAsFile();
      return !!file && this.isMediaFile(file);
    });
    const useCustomTextPaste = !!normalizedText && (
      this.useNewEditorExperience()
      || normalizedText !== text
      || !!pastedHtml
      || hasDirectMediaFiles
      || htmlContainsImage
    );
    const shouldPreventDefault = hasDirectMediaFiles
      || htmlContainsImage
      || (!!pastedHtml && this.useNewEditorExperience())
      || useCustomTextPaste;

    if (!shouldPreventDefault) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const mediaFiles: File[] = [];

    for (const item of items) {
      if (item.kind !== 'file') {
        continue;
      }

      const file = item.getAsFile();
      if (file && this.isMediaFile(file)) {
        mediaFiles.push(file);
      }
    }

    if (mediaFiles.length === 0 && pastedHtml) {
      mediaFiles.push(...await this.extractImageFilesFromPastedHtml(pastedHtml));
    }

    const selectionStart = this.getCurrentInsertionAnchor();

    if (normalizedText) {
      this.insertTextAtSelection(normalizedText);
    }

    if (mediaFiles.length > 0) {
      void this.uploadFiles(mediaFiles, selectionStart + normalizedText.length);
    }
  }

  private isMediaFile(file: File): boolean {
    // Check by MIME type first
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      return true;
    }

    // Additional check by file extension as fallback
    const mediaExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|avif|heic|heif|mp4|webm|mov|avi|mkv|m4v)$/i;
    return mediaExtensions.test(file.name);
  }

  private async extractImageFilesFromPastedHtml(html: string): Promise<File[]> {
    if (typeof document === 'undefined' || !html.trim()) {
      return [];
    }

    const container = document.createElement('div');
    container.innerHTML = html;

    const extractedFiles = await Promise.all(
      Array.from(container.querySelectorAll('img'))
        .map((image, index) => this.createFileFromImageSource(image.getAttribute('src') || '', index))
    );

    return extractedFiles.filter((file): file is File => !!file);
  }

  private async createFileFromImageSource(source: string, index: number): Promise<File | null> {
    const normalizedSource = source.trim();
    if (!normalizedSource) {
      return null;
    }

    if (normalizedSource.startsWith('data:image/')) {
      return this.createFileFromDataUrl(normalizedSource, index);
    }

    if (!/^(blob:|https?:)/i.test(normalizedSource)) {
      return null;
    }

    try {
      const response = await fetch(normalizedSource);
      if (!response.ok) {
        console.warn('Failed to fetch pasted image source', normalizedSource, response.status);
        return null;
      }

      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) {
        return null;
      }

      const extension = this.getFileExtensionForMimeType(blob.type);
      return new File([blob], `pasted-image-${index + 1}.${extension}`, { type: blob.type });
    } catch (error) {
      console.warn('Failed to extract pasted image source', normalizedSource, error);
      return null;
    }
  }

  private createFileFromDataUrl(dataUrl: string, index: number): File | null {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      return null;
    }

    const [, mimeType, base64] = match;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const extension = this.getFileExtensionForMimeType(mimeType);
    return new File([bytes], `pasted-image-${index + 1}.${extension}`, { type: mimeType });
  }

  private getFileExtensionForMimeType(mimeType: string): string {
    switch (mimeType) {
      case 'image/jpeg':
        return 'jpg';
      case 'image/png':
        return 'png';
      case 'image/gif':
        return 'gif';
      case 'image/webp':
        return 'webp';
      case 'image/svg+xml':
        return 'svg';
      case 'image/bmp':
        return 'bmp';
      case 'image/tiff':
        return 'tiff';
      case 'image/avif':
        return 'avif';
      case 'image/heic':
        return 'heic';
      case 'image/heif':
        return 'heif';
      default:
        return mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png';
    }
  }

  private extractPlainTextFromHtml(html: string): string {
    if (typeof document === 'undefined' || !html.trim()) {
      return '';
    }

    const container = document.createElement('div');
    container.innerHTML = html;

    return (container.innerText || container.textContent || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
  }

  private normalizePastedText(text: string): string {
    let normalizedText = text;

    if (this.localSettings.removeTrackingParameters() && normalizedText.length < 10000) {
      normalizedText = cleanTrackingParametersFromText(normalizedText);
    }

    if (this.containsNip19Identifier(normalizedText)) {
      normalizedText = this.addNostrPrefixToText(normalizedText);
    }

    return normalizedText;
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
    const nip19Pattern = /\b(note1|nevent1|npub1|nprofile1|naddr1|nsec1)(?:(?!(?:note|nevent|npub|nprofile|naddr|nsec)1)[a-zA-Z0-9])+\b/;
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
    const nostrUriPattern = /nostr:(note1|nevent1|npub1|nprofile1|naddr1)(?:(?!(?:note|nevent|npub|nprofile|naddr)1)[a-zA-Z0-9])+/g;
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
    const bareNip19Pattern = /\b(note1|nevent1|npub1|nprofile1|naddr1)((?:(?!(?:note|nevent|npub|nprofile|naddr)1)[a-zA-Z0-9])+)\b/g;
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
  private addNostrPrefixToText(text: string): string {
    return text.replace(
      /(?<!nostr:)(?<!\/)(\b(note1|nevent1|npub1|nprofile1|naddr1|nsec1)((?:(?!(?:note|nevent|npub|nprofile|naddr|nsec)1)[a-zA-Z0-9])+)\b)/g,
      'nostr:$1'
    );
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

  private clearSentimentAnalysis(): void {
    this.isSentimentAnalyzing.set(false);
    this.sentimentResult.set(null);
    this.sentimentError.set('');
    this.sentimentRequestedText.set('');
    this.sentimentResultText.set('');
  }

  dismissSentimentStatus(): void {
    this.clearSentimentAnalysis();
  }

  openAiDialog(action: 'generate' | 'translate'): void {
    const dialogRef = this.dialog.open(AiToolsDialogComponent, {
      panelClass: ['material-custom-dialog-panel', 'ai-tools-dialog-panel'],
      data: { content: this.content(), initialAction: action },
      width: '500px'
    });

    dialogRef.afterClosed().subscribe((result: string | undefined) => {
      if (typeof result === 'string') {
        this.content.set(result);
        this.sentimentError.set('');
        this.scheduleTextareaRefresh();
      }
    });
  }

  private formatSentimentLabel(label: string): string {
    switch (label) {
      case 'POSITIVE':
        return 'Positive';
      case 'NEGATIVE':
        return 'Negative';
      default:
        return 'Neutral';
    }
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
    this.scheduleTextareaRefresh();
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

