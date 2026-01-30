import {
  Component,
  inject,
  signal,
  computed,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  HostListener,
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
import { NoteEditorService, ReplyToInfo } from '../../services/note-editor.service';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { ConfirmDialogComponent } from '../confirm-dialog/confirm-dialog.component';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { ImagePlaceholderService } from '../../services/image-placeholder.service';
import { UtilitiesService } from '../../services/utilities.service';

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
  recordingHistory: string[] = [];
  private expandedAt = 0;
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
  private layout = inject(LayoutService);
  private publishEventBus = inject(PublishEventBus);
  private speechService = inject(SpeechService);
  private platformService = inject(PlatformService);
  private noteEditorService = inject(NoteEditorService);
  private customDialog = inject(CustomDialogService);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private imagePlaceholder = inject(ImagePlaceholderService);
  private utilities = inject(UtilitiesService);
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
    this.expandedAt = Date.now();
    this.isExpanded.set(true);
    setTimeout(() => {
      this.contentTextarea?.nativeElement?.focus();
    }, 50);
  }

  collapseEditor(): void {
    if (!this.content().trim() && !this.isPublishing() && !this.isUploading()) {
      this.isExpanded.set(false);
    }
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isExpanded()) return;
    // Ignore clicks within 100ms of expansion to prevent immediate collapse
    if (Date.now() - this.expandedAt < 100) return;
    if (this.isPublishing() || this.isUploading() || this.content().trim()) return;

    const clickedInside = this.elementRef.nativeElement.contains(event.target);
    const mentionAutocomplete = document.querySelector('app-mention-autocomplete');
    const clickedOnMentionAutocomplete = mentionAutocomplete?.contains(event.target as Node);

    if (!clickedInside && !clickedOnMentionAutocomplete) {
      this.isExpanded.set(false);
    }
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
    const cursorCoords = this.getCaretCoordinates(textarea);
    const textareaRect = textarea.getBoundingClientRect();
    
    // Account for textarea scroll position
    const scrollTop = textarea.scrollTop;
    const scrollLeft = textarea.scrollLeft;
    
    const cursorTop = textareaRect.top + cursorCoords.top - scrollTop;
    const cursorLeft = textareaRect.left + cursorCoords.left - scrollLeft;
    const gap = 4;
    const top = cursorTop + cursorCoords.height + gap;
    let left = cursorLeft;

    const viewportWidth = window.innerWidth;
    const autocompleteWidth = 420;

    if (left + autocompleteWidth > viewportWidth - 16) {
      left = viewportWidth - autocompleteWidth - 16;
    }
    if (left < 16) {
      left = 16;
    }

    return { top, left };
  }

  private getCaretCoordinates(element: HTMLTextAreaElement): { top: number; left: number; height: number } {
    const div = document.createElement('div');
    const style = getComputedStyle(element);
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
        (div.style as unknown as Record<string, string>)[prop] = value;
      }
    });

    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.style.top = '0';
    div.style.left = '0';
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

    let name = selection.displayName || 'unknown';
    name = name.replace(/\s+/g, '_');
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

      if (this.contentTextarea) {
        this.contentTextarea.nativeElement.value = currentContent;
      }

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

    this.publishSubscription = this.publishEventBus.on('relay-result').subscribe((event) => {
      if (!dialogClosed && event.type === 'relay-result') {
        const relayEvent = event as PublishRelayResultEvent;
        const isOurEvent = publishedEventId
          ? relayEvent.event.id === publishedEventId
          : relayEvent.event.content === contentToPublish;

        if (isOurEvent && relayEvent.success) {
          dialogClosed = true;
          publishedEventId = relayEvent.event.id;

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

          if (this.publishSubscription) {
            this.publishSubscription.unsubscribe();
            this.publishSubscription = undefined;
          }
        }
      }
    });

    const result = await this.nostrService.signAndPublish(eventToSign);

    if (result.event) {
      publishedEventId = result.event.id;
    }

    if (!dialogClosed && (!result.success || !result.event)) {
      throw new Error('Failed to publish reply');
    }
  }

  // ===============================
  // Cancel Method
  // ===============================

  cancel(): void {
    if (this.isPublishing()) return;

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

      if (this.contentTextarea) {
        this.contentTextarea.nativeElement.value = currentContent;
      }
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

    const imageFiles: File[] = [];

    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && file.type.startsWith('image/')) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      this.uploadFiles(imageFiles);
    }
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
            this.recordingHistory.push(this.content());
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
    if (this.recordingHistory.length > 0) {
      const previousContent = this.recordingHistory.pop()!;
      this.content.set(previousContent);
    }
  }
}
