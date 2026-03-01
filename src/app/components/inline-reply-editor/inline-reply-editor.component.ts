import {
  Component,
  inject,
  signal,
  computed,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  DestroyRef,
  input,
  output,
  ChangeDetectionStrategy,
  effect,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { FormsModule } from '@angular/forms';

import { NostrService } from '../../services/nostr.service';
import { MediaService } from '../../services/media.service';
import { AccountStateService } from '../../services/account-state.service';
import { nip19, Event as NostrEvent } from 'nostr-tools';
import { LayoutService } from '../../services/layout.service';
import { MentionAutocompleteComponent, MentionSelection, MentionAutocompleteConfig } from '../mention-autocomplete/mention-autocomplete.component';
import { MentionDetectionResult } from '../../services/mention-input.service';
import { PublishEventBus, PublishRelayResultEvent } from '../../services/publish-event-bus.service';
import { Subscription } from 'rxjs';
import { SpeechService } from '../../services/speech.service';
import { PlatformService } from '../../services/platform.service';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { EmojiPickerComponent } from '../emoji-picker/emoji-picker.component';
import { NoteEditorService, ReplyToInfo } from '../../services/note-editor.service';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { ImagePlaceholderService } from '../../services/image-placeholder.service';
import { UtilitiesService } from '../../services/utilities.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { cleanTrackingParametersFromText } from '../../utils/url-cleaner';

interface MediaMetadata {
  url: string;
  mimeType?: string;
  blurhash?: string;
  thumbhash?: string;
  dimensions?: { width: number; height: number };
  alt?: string;
  sha256?: string;
  image?: string;
  imageMirrors?: string[];
  fallbackUrls?: string[];
  thumbnailBlob?: Blob;
}

/**
 * Simplified inline reply editor component.
 * Used for quick replies in thread views without preview functionality.
 * Does not use the event component to avoid circular dependencies.
 */
@Component({
  selector: 'app-inline-reply-editor',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatMenuModule,
    MentionAutocompleteComponent,
    UserProfileComponent,
    EmojiPickerComponent,
  ],
  templateUrl: './inline-reply-editor.component.html',
  styleUrl: './inline-reply-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onHostKeyDown($event)',
    '[class.collapsed]': '!isExpanded()',
  },
})
export class InlineReplyEditorComponent implements AfterViewInit, OnDestroy {
  /** The event being replied to */
  replyToEvent = input.required<NostrEvent>();

  /** Emitted when a reply is successfully published */
  replyPublished = output<NostrEvent>();

  /** Emitted when the editor is cancelled/dismissed */
  cancelled = output<void>();

  // State
  isExpanded = signal(false);
  content = signal('');
  mentions = signal<string[]>([]);
  isPublishing = signal(false);
  isUploading = signal(false);
  uploadStatus = signal('');
  isRecording = signal(false);
  isTranscribing = signal(false);
  isDragOver = signal(false);
  dragCounter = 0;
  mediaMetadata = signal<MediaMetadata[]>([]);
  recordingHistory = signal<string[]>([]);
  private lastEventId: string | null = null;

  // Maps for mention handling
  private mentionMap = new Map<string, string>(); // @name -> nostr:uri
  private pubkeyToNameMap = new Map<string, string>(); // pubkey -> name

  // Mention autocomplete state
  mentionConfig = signal<MentionAutocompleteConfig | null>(null);
  mentionPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  mentionDetection = signal<MentionDetectionResult | null>(null);

  // Services
  private elementRef = inject(ElementRef);
  private nostrService = inject(NostrService);
  mediaService = inject(MediaService);
  private accountState = inject(AccountStateService);
  private snackBar = inject(MatSnackBar);
  layout = inject(LayoutService);
  private publishEventBus = inject(PublishEventBus);
  private speechService = inject(SpeechService);
  private platformService = inject(PlatformService);
  private noteEditorService = inject(NoteEditorService);
  private customDialog = inject(CustomDialogService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private imagePlaceholder = inject(ImagePlaceholderService);
  private utilities = inject(UtilitiesService);
  private localSettings = inject(LocalSettingsService);
  private destroyRef = inject(DestroyRef);
  private publishSubscription?: Subscription;
  private publishInitiated = signal(false);

  @ViewChild('contentTextarea') contentTextarea!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;
  @ViewChild(MentionAutocompleteComponent) mentionAutocomplete?: MentionAutocompleteComponent;

  // Computed properties
  currentAccountPubkey = computed(() => this.accountState.pubkey());
  isLoggedIn = computed(() => !!this.currentAccountPubkey());

  hashtags = computed(() => this.noteEditorService.getHashtagsFromContent(this.content()));

  characterCount = computed(() => {
    return this.noteEditorService.processContentForPublishing(this.content(), this.mentionMap).length;
  });

  canPublish = computed(() => {
    const hasContent = this.content().trim().length > 0;
    const notPublishing = !this.isPublishing();
    const notUploading = !this.isUploading();
    return hasContent && notPublishing && notUploading;
  });

  constructor() {
    // React to replyToEvent changes (when navigating between events)
    effect(() => {
      const event = this.replyToEvent();
      if (event) {
        // Only reset state if the event ID actually changed
        if (this.lastEventId === event.id) {
          return;
        }
        this.lastEventId = event.id;

        // Reset editor state for the new event
        this.content.set('');
        this.mentions.set([event.pubkey]); // Start with the event author mentioned
        this.mentionMap.clear();
        this.pubkeyToNameMap.clear();
        this.mediaMetadata.set([]);
        this.isExpanded.set(false);

        // Fetch the profile name for the reply target
        this.loadMentionProfileName(event.pubkey);
      }
    });
  }

  ngAfterViewInit() {
    this.dragCounter = 0;
    this.isDragOver.set(false);
    this.setupPasteHandler();
  }

  ngOnDestroy() {
    if (this.publishSubscription) {
      this.publishSubscription.unsubscribe();
    }
  }

  // ===============================
  // UI Interaction Methods
  // ===============================

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

  // ===============================
  // Content Input Methods
  // ===============================

  onContentInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    const newContent = target.value;
    this.content.set(newContent);
    this.autoResizeTextarea(target);
    this.syncMentionsWithContent(newContent);
    this.handleMentionInput(newContent, target.selectionStart || 0);
  }

  private autoResizeTextarea(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    const computedStyle = window.getComputedStyle(textarea);
    const minHeight = parseInt(computedStyle.minHeight, 10) || 60;
    const maxHeight = 200;
    const newHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${newHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }

  /**
   * Synchronise the DOM textarea value with the content signal.
   * Necessary when content is updated programmatically (e.g. mention/media removal)
   * so that the visible text stays in sync with the signal state.
   */
  private syncTextareaValue(value: string): void {
    if (this.contentTextarea) {
      this.contentTextarea.nativeElement.value = value;
    }
  }

  private syncMentionsWithContent(currentContent: string): void {
    const mentionsToRemove: string[] = [];

    for (const pubkey of this.mentions()) {
      if (this.isReplyTargetMention(pubkey)) continue;

      const name = this.pubkeyToNameMap.get(pubkey);
      if (!name) continue;

      const baseMention = `@${name}`;
      let mentionFound = currentContent.includes(baseMention);

      if (!mentionFound) {
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

    if (mentionsToRemove.length > 0) {
      for (const pubkey of mentionsToRemove) {
        this.mentions.set(this.mentions().filter(p => p !== pubkey));
        const name = this.pubkeyToNameMap.get(pubkey);
        if (name) {
          const baseMention = `@${name}`;
          this.mentionMap.delete(baseMention);
          let counter = 1;
          while (this.mentionMap.has(`${baseMention}_${counter}`)) {
            this.mentionMap.delete(`${baseMention}_${counter}`);
            counter++;
          }
          this.pubkeyToNameMap.delete(pubkey);
        }
      }
    }
  }

  // ===============================
  // Keyboard Methods
  // ===============================

  onHostKeyDown(event: KeyboardEvent): void {
    // Ctrl+Enter to publish
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (this.canPublish() && !this.isPublishing()) {
        this.publishReply();
      }
    }

    if (event.key === 'Escape') {
      const mentionConfig = this.mentionConfig();
      if (mentionConfig) {
        event.preventDefault();
        event.stopPropagation();
        this.onMentionDismissed();
      } else {
        this.cancel();
      }
    }
  }

  onContentKeyDown(event: KeyboardEvent): void {
    const mentionConfig = this.mentionConfig();

    if (mentionConfig) {
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
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
        event.preventDefault();
        event.stopPropagation();
        if (this.mentionAutocomplete) {
          const results = this.mentionAutocomplete.searchResults();
          const currentIndex = this.mentionAutocomplete.focusedIndex();
          if (event.key === 'ArrowDown') {
            this.mentionAutocomplete.setFocusedIndex(Math.min(currentIndex + 1, results.length - 1));
          } else {
            this.mentionAutocomplete.setFocusedIndex(Math.max(currentIndex - 1, 0));
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
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
    const target = event.target as HTMLTextAreaElement;
    this.handleMentionInput(this.content(), target.selectionStart || 0);
  }

  onContentClick(event: MouseEvent): void {
    const target = event.target as HTMLTextAreaElement;
    this.handleMentionInput(this.content(), target.selectionStart || 0);
  }

  // ===============================
  // Mention Methods
  // ===============================

  private handleMentionInput(content: string, cursorPosition: number): void {
    const detection = this.noteEditorService.detectMention(content, cursorPosition);
    this.mentionDetection.set(detection);

    if (detection.isTypingMention) {
      const textareaElement = this.contentTextarea?.nativeElement;
      if (textareaElement) {
        const position = this.calculateMentionPosition(textareaElement);
        this.mentionPosition.set(position);
        this.mentionConfig.set({
          cursorPosition: detection.cursorPosition,
          query: detection.query,
          mentionStart: detection.mentionStart,
        });
      }
    } else {
      this.mentionConfig.set(null);
    }
  }

  private calculateMentionPosition(textarea: HTMLTextAreaElement): { top: number; left: number } {
    // Position the autocomplete directly below the textarea element
    // We use absolute positioning relative to .textarea-container
    const containerElement = textarea.closest('.textarea-container');
    if (!containerElement) {
      return { top: 0, left: 0 };
    }

    const containerRect = containerElement.getBoundingClientRect();
    const textareaRect = textarea.getBoundingClientRect();

    // Position directly below the textarea with a small gap
    const gap = 2;
    const top = textareaRect.bottom - containerRect.top + gap;
    const left = 0; // Align with left edge of container

    return { top, left };
  }

  onMentionSelected(selection: MentionSelection): void {
    const detection = this.mentionDetection();
    if (!detection) return;

    // Sanitize display name for safe mention matching
    const name = this.noteEditorService.sanitizeDisplayName(selection.displayName || 'unknown');
    let textToInsert = `@${name}`;

    if (this.mentionMap.has(textToInsert) && this.mentionMap.get(textToInsert) !== selection.nprofileUri) {
      let counter = 1;
      while (this.mentionMap.has(`${textToInsert}_${counter}`) && this.mentionMap.get(`${textToInsert}_${counter}`) !== selection.nprofileUri) {
        counter++;
      }
      textToInsert = `${textToInsert}_${counter}`;
    }

    this.mentionMap.set(textToInsert, selection.nprofileUri);
    this.pubkeyToNameMap.set(selection.pubkey, name);

    const replacement = this.noteEditorService.replaceMention(detection, textToInsert);
    this.content.set(replacement.replacementText);

    setTimeout(() => {
      const textarea = this.contentTextarea?.nativeElement;
      if (textarea) {
        textarea.selectionStart = replacement.newCursorPosition;
        textarea.selectionEnd = replacement.newCursorPosition;
        textarea.focus();
      }
    }, 0);

    this.addMention(selection.pubkey);
    this.mentionConfig.set(null);
  }

  onMentionDismissed(): void {
    this.mentionConfig.set(null);
  }

  // ===============================
  // Emoji Methods
  // ===============================

  /**
   * Insert an emoji at the current cursor position in the textarea
   */
  insertEmoji(emoji: string): void {
    const textarea = this.contentTextarea?.nativeElement;
    if (textarea) {
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? start;
      const currentContent = this.content();
      const newContent = currentContent.substring(0, start) + emoji + currentContent.substring(end);
      this.content.set(newContent);
      textarea.value = newContent;

      // Restore cursor position after emoji
      setTimeout(() => {
        const newPos = start + emoji.length;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
      });
    } else {
      this.content.update(text => text + emoji);
    }
  }

  /**
   * Open emoji picker in a fullscreen dialog on small screens
   */
  async openEmojiPickerDialog(): Promise<void> {
    const { EmojiPickerDialogComponent } = await import('../emoji-picker/emoji-picker-dialog.component');
    type EmojiPickerDialogResult = string;
    const dialogRef = this.customDialog.open<typeof EmojiPickerDialogComponent.prototype, EmojiPickerDialogResult>(EmojiPickerDialogComponent, {
      title: 'Emoji',
      width: '400px',
      panelClass: 'emoji-picker-dialog',
    });

    dialogRef.afterClosed$.subscribe(result => {
      if (result.result) {
        this.insertEmoji(result.result);
      }
    });
  }

  addMention(pubkey: string): void {
    const currentMentions = this.mentions();
    if (!currentMentions.includes(pubkey)) {
      this.mentions.set([...currentMentions, pubkey]);
    }
  }

  removeMention(pubkey: string): void {
    this.mentions.set(this.mentions().filter(p => p !== pubkey));

    const name = this.pubkeyToNameMap.get(pubkey);
    if (name) {
      const baseMention = `@${name}`;
      const possibleMentions: string[] = [baseMention];
      let counter = 1;
      while (this.mentionMap.has(`${baseMention}_${counter}`)) {
        possibleMentions.push(`${baseMention}_${counter}`);
        counter++;
      }

      let currentContent = this.content();
      for (const mention of possibleMentions) {
        if (this.mentionMap.has(mention)) {
          const escapedMention = mention.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          currentContent = currentContent.replace(new RegExp(escapedMention + '\\s?', 'g'), '');
          this.mentionMap.delete(mention);
        }
      }

      currentContent = currentContent.replace(/[ \t]+/g, ' ').replace(/^ +| +$/gm, '').trim();
      this.content.set(currentContent);
      this.syncTextareaValue(currentContent);

      this.pubkeyToNameMap.delete(pubkey);
    }
  }

  getMentionDisplayName(pubkey: string): string {
    const name = this.pubkeyToNameMap.get(pubkey);
    if (name) return `@${name}`;
    const npub = nip19.npubEncode(pubkey);
    return `${npub.substring(0, 8)}...${npub.substring(npub.length - 4)}`;
  }

  isReplyTargetMention(pubkey: string): boolean {
    return this.replyToEvent()?.pubkey === pubkey;
  }

  private async loadMentionProfileName(pubkey: string): Promise<void> {
    const name = await this.noteEditorService.loadProfileName(pubkey);
    if (name) {
      this.pubkeyToNameMap.set(pubkey, name);
    }
  }

  // ===============================
  // Publishing Methods
  // ===============================

  async publishReply(): Promise<void> {
    if (this.publishInitiated()) return;
    this.publishInitiated.set(true);

    if (!this.canPublish() || this.isPublishing()) {
      this.publishInitiated.set(false);
      return;
    }

    this.isPublishing.set(true);

    try {
      const content = this.noteEditorService.processContentForPublishing(this.content().trim(), this.mentionMap);
      const event = this.replyToEvent();

      const replyTo: ReplyToInfo = {
        id: event.id,
        pubkey: event.pubkey,
        event: event,
      };

      const tags = this.noteEditorService.buildTags({
        replyTo,
        mentions: this.mentions(),
        content,
        mediaMetadata: this.mediaMetadata(),
        addClientTag: true,
      });

      await this.publishEvent(content, tags);
    } catch (error) {
      console.error('Error publishing reply:', error);
      this.snackBar.open('Failed to publish reply. Please try again.', 'Close', { duration: 5000 });
    } finally {
      this.isPublishing.set(false);
      this.publishInitiated.set(false);
    }
  }

  private async publishEvent(contentToPublish: string, tags: string[][]): Promise<void> {
    const eventToSign = this.nostrService.createEvent(1, contentToPublish, tags);
    let dialogClosed = false;
    let publishedEventId: string | undefined;
    let relayTimeoutHandle: ReturnType<typeof setTimeout> | undefined;

    // Clean up any previous subscription that may have leaked
    if (this.publishSubscription) {
      this.publishSubscription.unsubscribe();
      this.publishSubscription = undefined;
    }

    const cleanup = (): void => {
      if (relayTimeoutHandle !== undefined) {
        clearTimeout(relayTimeoutHandle);
        relayTimeoutHandle = undefined;
      }
      if (this.publishSubscription) {
        this.publishSubscription.unsubscribe();
        this.publishSubscription = undefined;
      }
    };

    this.publishSubscription = this.publishEventBus.on('relay-result').subscribe((event) => {
      if (!dialogClosed && event.type === 'relay-result') {
        const relayEvent = event as PublishRelayResultEvent;
        const isOurEvent = publishedEventId
          ? relayEvent.event.id === publishedEventId
          : relayEvent.event.content === contentToPublish;

        if (isOurEvent && relayEvent.success) {
          dialogClosed = true;
          publishedEventId = relayEvent.event.id;
          cleanup();

          this.snackBar.open('Reply published!', 'Close', { duration: 3000 });

          const signedEvent = relayEvent.event;
          this.content.set('');
          this.mentionMap.clear();
          this.pubkeyToNameMap.clear();
          this.mediaMetadata.set([]);
          this.isExpanded.set(false);
          this.replyPublished.emit(signedEvent);

          const nevent = nip19.neventEncode({
            id: signedEvent.id,
            author: signedEvent.pubkey,
            kind: signedEvent.kind,
          });
          this.layout.openGenericEvent(nevent, signedEvent);
        }
      }
    });

    const result = await this.nostrService.signAndPublish(eventToSign);

    if (result.event) {
      publishedEventId = result.event.id;
    }

    if (!result.success || !result.event) {
      cleanup();
      throw new Error('Failed to publish reply');
    }

    if (!dialogClosed) {
      // Relay confirmation not yet received — set a timeout so isPublishing doesn't get
      // stuck forever if no relay-result event ever fires (e.g. all relays time out).
      relayTimeoutHandle = setTimeout(() => {
        if (!dialogClosed) {
          cleanup();
          // Reset publishing state so the user isn't stuck
          this.isPublishing.set(false);
          this.publishInitiated.set(false);
          this.snackBar.open('Reply sent (no relay confirmation received)', 'Close', { duration: 5000 });
        }
      }, 30000);
    }
  }

  // ===============================
  // Cancel Method
  // ===============================

  cancel(): void {
    if (this.isPublishing()) return;

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

      dialogRef.afterClosed().subscribe(confirmed => {
        if (confirmed) {
          this.content.set('');
          this.mentionMap.clear();
          this.pubkeyToNameMap.clear();
          this.mediaMetadata.set([]);
          this.isExpanded.set(false);
          this.cancelled.emit();
        }
      });
    } else {
      this.isExpanded.set(false);
      this.cancelled.emit();
    }
  }

  // ===============================
  // Media Methods
  // ===============================

  dismissError(): void {
    this.mediaService.clearError();
  }

  openFileDialog(): void {
    if (!this.fileInput?.nativeElement) return;

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
        this.router.navigate(['/collections/media'], { queryParams: { tab: 'servers' } });
      }
    });
  }

  async openMediaChooser(): Promise<void> {
    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

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
        for (const item of result.items) {
          this.addExistingMediaToEditor(item);
        }
      }
    });
  }

  private addExistingMediaToEditor(item: { sha256: string; type: string; url: string; size: number }): void {
    const currentContent = this.content();
    const urlToAdd = item.url;

    if (currentContent.includes(urlToAdd)) {
      this.snackBar.open('This media is already in your reply', 'Dismiss', { duration: 3000 });
      return;
    }

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

    const separator = currentContent.trim() ? '\n\n' : '';
    this.content.set(currentContent + separator + urlToAdd);
    this.snackBar.open('Media added to reply', 'Dismiss', { duration: 2000 });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.uploadFiles(Array.from(input.files));
    }
    input.value = '';
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

    if (!this.hasConfiguredMediaServers()) {
      this.showMediaServerWarning();
      return;
    }

    this.isUploading.set(true);
    this.uploadStatus.set('Preparing upload...');

    try {
      await this.mediaService.load();

      const totalFiles = files.length;
      let completedFiles = 0;

      const uploadPromises = files.map(async (file, index) => {
        try {
          const fileLabel = totalFiles > 1 ? ` (${index + 1}/${totalFiles})` : '';
          const fileMimeType = this.mediaService.getFileMimeType(file);

          let thumbnailData: {
            blob: Blob;
            dimensions: { width: number; height: number };
            blurhash: string | undefined;
            thumbhash: string | undefined;
          } | undefined;

          if (fileMimeType.startsWith('video/')) {
            try {
              this.uploadStatus.set(`Extracting video thumbnail${fileLabel}...`);
              const localVideoUrl = URL.createObjectURL(file);
              const thumbnailResult = await this.utilities.extractThumbnailFromVideo(localVideoUrl, 1);
              const thumbnailFile = new File([thumbnailResult.blob], 'thumbnail.jpg', { type: 'image/jpeg' });
              const placeholderResult = await this.imagePlaceholder.generatePlaceholders(thumbnailFile);

              thumbnailData = {
                blob: thumbnailResult.blob,
                dimensions: thumbnailResult.dimensions,
                blurhash: placeholderResult.blurhash,
                thumbhash: placeholderResult.thumbhash,
              };

              URL.revokeObjectURL(localVideoUrl);
              URL.revokeObjectURL(thumbnailResult.objectUrl);
            } catch (error) {
              console.error('Failed to extract video thumbnail:', error);
            }
          }

          this.uploadStatus.set(`Uploading${fileLabel}...`);
          const result = await this.mediaService.uploadFile(file, false, this.mediaService.mediaServers());

          if (result.status === 'success' && result.item) {
            this.insertFileUrl(result.item.url);
            this.uploadStatus.set(`Processing metadata${fileLabel}...`);

            const metadata = await this.extractMediaMetadata(file, result.item.url, result.item.sha256, result.item.mirrors, thumbnailData);
            if (metadata) {
              this.mediaMetadata.set([...this.mediaMetadata(), metadata]);
            }

            completedFiles++;
            if (completedFiles < totalFiles) {
              this.uploadStatus.set(`Completed ${completedFiles}/${totalFiles} files...`);
            }

            return { success: true, fileName: file.name };
          } else {
            completedFiles++;
            return { success: false, fileName: file.name, error: result.message || 'Upload failed' };
          }
        } catch (error) {
          completedFiles++;
          return { success: false, fileName: file.name, error: error instanceof Error ? error.message : 'Upload failed' };
        }
      });

      const results = await Promise.all(uploadPromises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      if (successful.length > 0) {
        this.snackBar.open(`${successful.length} file(s) uploaded successfully`, 'Close', { duration: 3000 });
      }

      if (failed.length > 0) {
        const errorMessages = failed.map(f => `${f.fileName}: ${f.error}`).join('\n');
        this.snackBar.open(`Failed to upload ${failed.length} file(s):\n${errorMessages}`, 'Close', { duration: 8000 });
      }
    } catch (error) {
      this.snackBar.open('Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error'), 'Close', { duration: 5000 });
    } finally {
      this.isUploading.set(false);
      this.uploadStatus.set('');
    }
  }

  private insertFileUrl(url: string): void {
    const currentContent = this.content();
    const textarea = this.contentTextarea.nativeElement;
    const cursorPosition = textarea.selectionStart;

    const beforeCursor = currentContent.substring(0, cursorPosition);
    const afterCursor = currentContent.substring(cursorPosition);

    const needsSpaceBefore = beforeCursor.length > 0 && !beforeCursor.endsWith(' ') && !beforeCursor.endsWith('\n');
    const needsSpaceAfter = afterCursor.length > 0 && !afterCursor.startsWith(' ') && !afterCursor.startsWith('\n');

    const prefix = needsSpaceBefore ? ' ' : '';
    const suffix = needsSpaceAfter ? ' ' : '';

    const newContent = beforeCursor + prefix + url + suffix + afterCursor;
    this.content.set(newContent);

    setTimeout(() => {
      const newCursorPosition = cursorPosition + prefix.length + url.length + suffix.length;
      textarea.setSelectionRange(newCursorPosition, newCursorPosition);
      textarea.focus();
    }, 0);
  }

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
      const mimeType = this.mediaService.getFileMimeType(file);

      const metadata: MediaMetadata = {
        url,
        mimeType,
        sha256,
        fallbackUrls: mirrors && mirrors.length > 0 ? mirrors : undefined,
      };

      if (mimeType.startsWith('image/')) {
        const placeholders = await this.imagePlaceholder.generatePlaceholders(file);
        metadata.blurhash = placeholders.blurhash;
        metadata.thumbhash = placeholders.thumbhash;
        metadata.dimensions = placeholders.dimensions;
        if (mirrors && mirrors.length > 0) {
          metadata.fallbackUrls = mirrors;
        }
        return metadata;
      }

      if (mimeType.startsWith('video/') && thumbnailData) {
        try {
          const thumbnailFile = new File([thumbnailData.blob], 'thumbnail.jpg', { type: 'image/jpeg' });
          const uploadResult = await this.mediaService.uploadFile(thumbnailFile, false, this.mediaService.mediaServers());

          if (uploadResult.status === 'success' && uploadResult.item) {
            metadata.image = uploadResult.item.url;
            metadata.blurhash = thumbnailData.blurhash;
            metadata.thumbhash = thumbnailData.thumbhash;
            metadata.dimensions = thumbnailData.dimensions;

            if (uploadResult.item.mirrors && uploadResult.item.mirrors.length > 0) {
              metadata.imageMirrors = uploadResult.item.mirrors;
            }
          }
        } catch (error) {
          console.error('Failed to upload video thumbnail:', error);
        }
      }

      return metadata;
    } catch (error) {
      console.error('Failed to extract media metadata:', error);
      return {
        url,
        mimeType: this.mediaService.getFileMimeType(file),
        fallbackUrls: mirrors && mirrors.length > 0 ? mirrors : undefined,
      };
    }
  }

  removeMedia(index: number): void {
    const currentMetadata = [...this.mediaMetadata()];
    const removedMedia = currentMetadata[index];
    currentMetadata.splice(index, 1);
    this.mediaMetadata.set(currentMetadata);

    if (removedMedia?.url) {
      let currentContent = this.content();
      const escapedUrl = removedMedia.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      currentContent = currentContent.replace(new RegExp('\\s*' + escapedUrl + '\\s*', 'g'), ' ');
      currentContent = currentContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim();
      this.content.set(currentContent);
      this.syncTextareaValue(currentContent);
    }
  }

  // ===============================
  // Paste Handler
  // ===============================

  private setupPasteHandler(): void {
    if (this.contentTextarea) {
      this.contentTextarea.nativeElement.addEventListener('paste', this.handlePaste.bind(this));
    }
  }

  private handlePaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;

    let hasMediaFile = false;
    const mediaFiles: File[] = [];

    // Check for media files (images and videos) in clipboard
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && this.isMediaFile(file)) {
          hasMediaFile = true;
          mediaFiles.push(file);
        }
      }
    }

    // If we found media files, prevent default behavior and upload them
    if (hasMediaFile && mediaFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      this.uploadFiles(mediaFiles);
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

    // If no media files or NIP-19 identifiers, allow normal text pasting
  }

  /**
   * Check if file is a supported media file (image or video)
   */
  private isMediaFile(file: File): boolean {
    // Check by MIME type first
    if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
      return true;
    }

    // Additional check by file extension as fallback
    const mediaExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|tiff|avif|heic|heif|mp4|webm|mov|avi|mkv|m4v)$/i;
    return mediaExtensions.test(file.name);
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
      /(?<!nostr:)(?<!\/)(\b(note1|nevent1|npub1|nprofile1|naddr1|nsec1)((?:(?!(?:note|nevent|npub|nprofile|naddr|nsec)1)[a-zA-Z0-9])+)\b)/g,
      'nostr:$1'
    );

    // Insert the processed text at cursor position
    const newContent =
      currentContent.substring(0, cursorPosition) +
      processedText +
      currentContent.substring(cursorPosition);

    this.content.set(newContent);
    // Keep the DOM textarea in sync synchronously to avoid visual flicker
    textarea.value = newContent;

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
    // Keep the DOM textarea in sync synchronously to avoid visual flicker
    textarea.value = newContent;

    // Restore cursor position after the inserted text
    setTimeout(() => {
      const newCursorPosition = cursorPosition + text.length;
      textarea.setSelectionRange(newCursorPosition, newCursorPosition);
      textarea.focus();
    }, 0);
  }

  // ===============================
  // Recording Methods
  // ===============================

  async toggleRecording(): Promise<void> {
    if (this.isRecording()) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  private async startRecording(): Promise<void> {
    try {
      await this.speechService.startRecording({
        onRecordingStateChange: (isRecording) => {
          this.isRecording.set(isRecording);
        },
        onTranscribingStateChange: (isTranscribing) => {
          this.isTranscribing.set(isTranscribing);
        },
        onTranscription: (text) => {
          if (text) {
            this.recordingHistory.update(h => [...h, this.content()]);
            const currentContent = this.content();
            const separator = currentContent.trim() ? ' ' : '';
            this.content.set(currentContent + separator + text);
          }
        }
      });
    } catch (error) {
      console.error('Failed to start recording:', error);
      this.isRecording.set(false);
      this.snackBar.open('Failed to start recording. Please check microphone permissions.', 'Close', { duration: 5000 });
    }
  }

  private stopRecording(): void {
    this.speechService.stopRecording();
  }

  undoLastRecording(): void {
    const history = this.recordingHistory();
    if (history.length > 0) {
      const previousContent = history[history.length - 1];
      this.recordingHistory.update(h => h.slice(0, -1));
      this.content.set(previousContent);
    }
  }
}
