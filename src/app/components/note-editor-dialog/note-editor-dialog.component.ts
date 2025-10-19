import {
  Component,
  inject,
  signal,
  computed,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
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
import { DomSanitizer } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { NostrService } from '../../services/nostr.service';
import { MediaService } from '../../services/media.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { AccountStateService } from '../../services/account-state.service';
import { ContentComponent } from '../content/content.component';
import { Router } from '@angular/router';
import { nip19, Event as NostrEvent, UnsignedEvent } from 'nostr-tools';
import { AccountRelayService } from '../../services/relays/account-relay';
import { PowService, PowProgress } from '../../services/pow.service';

export interface NoteEditorDialogData {
  replyTo?: {
    id: string;
    pubkey: string;
    rootId?: string | null;
    event?: NostrEvent; // Include the full event for complete tag analysis
  };
  quote?: {
    id: string;
    pubkey: string;
    content?: string;
  };
  mentions?: string[]; // Array of pubkeys to mention
}

interface NoteAutoDraft {
  content: string;
  mentions: string[];
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
}

@Component({
  selector: 'app-note-editor-dialog',
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
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
    ContentComponent,
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './note-editor-dialog.component.html',
  styleUrl: './note-editor-dialog.component.scss',
})
export class NoteEditorDialogComponent implements AfterViewInit, OnDestroy {
  private dialogRef = inject(MatDialogRef<NoteEditorDialogComponent>);
  data = inject(MAT_DIALOG_DATA) as NoteEditorDialogData;
  private nostrService = inject(NostrService);
  private accountRelay = inject(AccountRelayService);
  mediaService = inject(MediaService);
  private localStorage = inject(LocalStorageService);
  private localSettings = inject(LocalSettingsService);
  private accountState = inject(AccountStateService);
  private snackBar = inject(MatSnackBar);
  private sanitizer = inject(DomSanitizer);
  private router = inject(Router);
  private powService = inject(PowService);

  @ViewChild('contentTextarea')
  contentTextarea!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  // Auto-save configuration
  private readonly AUTO_SAVE_INTERVAL = 2000; // Save every 2 seconds
  private autoSaveTimer?: ReturnType<typeof setTimeout>;

  // Signals for reactive state
  content = signal('');
  isPublishing = signal(false);
  isUploading = signal(false);
  isDragOver = signal(false);
  showPreview = signal(false);
  showAdvancedOptions = signal(false);
  mentions = signal<string[]>(this.data?.mentions || []);

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

  private dragCounter = 0;

  // Computed properties
  characterCount = computed(() => this.content().length);
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

    if (!content.trim()) return '<span class="empty-preview">Nothing to preview...</span>';

    // const formatted = this.formatPreviewContent(content);
    return content;

    // if (!this.showPreview()) return this.sanitizer.bypassSecurityTrustHtml('');

    // const content = this.content();
    // if (!content.trim()) return this.sanitizer.bypassSecurityTrustHtml('<span class="empty-preview">Nothing to preview...</span>');

    // Format the content with better URL handling and line breaks
    // const formatted = this.formatPreviewContent(content);
    // return this.sanitizer.bypassSecurityTrustHtml(formatted);
  });

  // Dialog mode indicators
  isReply = computed(() => !!this.data?.replyTo);
  isQuote = computed(() => !!this.data?.quote);

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

  ngAfterViewInit() {
    // Reset drag counter when component initializes
    this.dragCounter = 0;
    this.isDragOver.set(false);

    // Add paste event listener for clipboard image handling
    this.setupPasteHandler();
  }

  ngOnDestroy() {
    // Clear auto-save timer on destroy
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
  }

  constructor() {
    // Set default value for addClientTag from user's local settings
    this.addClientTag.set(this.localSettings.addClientTag());

    // Initialize content with quote if provided
    if (this.data?.quote) {
      const nevent = nip19.neventEncode({
        id: this.data.quote.id,
        author: this.data.quote.pubkey,
      });
      this.content.set(`\n\nnostr:${nevent}`);
    }

    // Add reply mentions if this is a reply
    if (this.data?.replyTo) {
      const currentMentions = this.mentions();
      if (!currentMentions.includes(this.data.replyTo.pubkey)) {
        this.mentions.set([...currentMentions, this.data.replyTo.pubkey]);
      }
    }

    // Load auto-saved draft if available
    this.loadAutoDraft();

    // Set up auto-save effects
    this.setupAutoSave();
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
    setInterval(checkAndScheduleAutoSave, 2000);

    // Check other properties less frequently
    const mentionsSignal = this.mentions;
    const expirationEnabledSignal = this.expirationEnabled;
    const expirationTimeSignal = this.expirationTime;

    let previousMentions = JSON.stringify(mentionsSignal());
    let previousExpirationEnabled = expirationEnabledSignal();
    let previousExpirationTime = expirationTimeSignal();

    const checkOtherChanges = () => {
      const currentMentions = JSON.stringify(mentionsSignal());
      const currentExpirationEnabled = expirationEnabledSignal();
      const currentExpirationTime = expirationTimeSignal();

      if (
        currentMentions !== previousMentions ||
        currentExpirationEnabled !== previousExpirationEnabled ||
        currentExpirationTime !== previousExpirationTime
      ) {
        previousMentions = currentMentions;
        previousExpirationEnabled = currentExpirationEnabled;
        previousExpirationTime = currentExpirationTime;

        // Only schedule auto-save if there's content
        if (this.content().trim()) {
          this.scheduleAutoSave();
        }
      }
    };

    // Check other changes every 5 seconds
    setInterval(checkOtherChanges, 5000);
  }

  private scheduleAutoSave(): void {
    // Clear existing timer
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }

    // Only auto-save if there's meaningful content
    const content = this.content().trim();
    if (!content) return;

    // Schedule new auto-save
    this.autoSaveTimer = setTimeout(() => {
      this.saveAutoDraft();
    }, this.AUTO_SAVE_INTERVAL);
  }

  private saveAutoDraft(): void {
    const pubkey = this.accountState.pubkey();
    if (!pubkey) return;

    const content = this.content().trim();
    if (!content) return;

    const autoDraft: NoteAutoDraft = {
      content: this.content(),
      mentions: [...this.mentions()],
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
    };

    const key = this.getAutoDraftKey();

    // Check if this is meaningfully different from the last save
    const previousDraft = this.localStorage.getObject<NoteAutoDraft>(key);
    if (previousDraft) {
      const isSimilar =
        previousDraft.content === autoDraft.content &&
        JSON.stringify(previousDraft.mentions) === JSON.stringify(autoDraft.mentions) &&
        previousDraft.expirationEnabled === autoDraft.expirationEnabled &&
        previousDraft.expirationTime === autoDraft.expirationTime;

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

      if (!isExpired && autoDraft.content.trim()) {
        // Don't overwrite existing content from quote/reply initialization
        const existingContent = this.content().trim();
        const draftHasMoreContent = autoDraft.content.trim().length > existingContent.length;

        if (draftHasMoreContent) {
          this.content.set(autoDraft.content);
          this.mentions.set([...autoDraft.mentions]);
          this.showPreview.set(autoDraft.showPreview);
          this.showAdvancedOptions.set(autoDraft.showAdvancedOptions);
          this.expirationEnabled.set(autoDraft.expirationEnabled);
          this.expirationDate.set(autoDraft.expirationDate);
          this.expirationTime.set(autoDraft.expirationTime);
          this.uploadOriginal.set(autoDraft.uploadOriginal ?? false);
          this.addClientTag.set(autoDraft.addClientTag ?? this.localSettings.addClientTag());

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
    if (!this.canPublish()) return;

    this.isPublishing.set(true);

    try {
      let eventToSign: UnsignedEvent;

      // Use the mined event if PoW is enabled and we have a result
      if (this.powEnabled() && this.powMinedEvent()) {
        eventToSign = this.powMinedEvent()!;
      } else {
        const tags = this.buildTags();
        eventToSign = this.nostrService.createEvent(1, this.content().trim(), tags);
      }

      const signedEvent = await this.nostrService.signEvent(eventToSign);

      if (signedEvent) {
        await this.accountRelay.publish(signedEvent);

        // Clear auto-draft after successful publish
        this.clearAutoDraft();

        this.snackBar.open('Note published successfully!', 'Close', {
          duration: 3000,
        });
        this.dialogRef.close({ published: true, event: signedEvent });

        // We don't do "note" much, we want URLs that embeds the autor.
        // const note = nip19.noteEncode(signedEvent.id);
        // this.router.navigate(['/e', note]); // Navigate to the published event
        const nevent = nip19.neventEncode({
          id: signedEvent.id,
          author: signedEvent.pubkey,
        });
        this.router.navigate(['/e', nevent], { state: { event: signedEvent } }); // Navigate to the published event
      } else {
        throw new Error('Failed to sign event');
      }
    } catch (error) {
      console.error('Error publishing note:', error);
      this.snackBar.open('Failed to publish note. Please try again.', 'Close', {
        duration: 5000,
      });
    } finally {
      this.isPublishing.set(false);
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
    }

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

    return tags;
  }

  addMention(pubkey: string): void {
    const currentMentions = this.mentions();
    if (!currentMentions.includes(pubkey)) {
      this.mentions.set([...currentMentions, pubkey]);
    }
  }

  removeMention(pubkey: string): void {
    this.mentions.set(this.mentions().filter(p => p !== pubkey));
  }

  cancel(): void {
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

    this.dialogRef.close({ published: false });
  }

  dismissError(): void {
    this.mediaService.clearError();
  }

  // Preview functionality
  togglePreview(): void {
    this.showPreview.update(current => !current);
  }

  // Advanced options functionality
  toggleAdvancedOptions(): void {
    this.showAdvancedOptions.update(current => !current);
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
    this.fileInput.nativeElement.click();
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

    this.isUploading.set(true);

    try {
      // Load media service if not already loaded
      await this.mediaService.load();

      const uploadPromises = files.map(async file => {
        try {
          const result = await this.mediaService.uploadFile(
            file,
            this.uploadOriginal(),
            this.mediaService.mediaServers()
          );

          if (result.status === 'success' && result.item) {
            this.insertFileUrl(result.item.url);
            return { success: true, fileName: file.name };
          } else {
            return {
              success: false,
              fileName: file.name,
              error: result.message || 'Upload failed',
            };
          }
        } catch (error) {
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
    }
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

    // If no image files, allow normal text pasting
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

  // Proof of Work methods
  onPowToggle(enabled: boolean): void {
    this.powEnabled.set(enabled);
    if (!enabled) {
      this.stopPow();
      this.powMinedEvent.set(null);
      this.powService.reset();
    }
  }

  onPowDifficultyChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const difficulty = parseInt(target.value, 10);
    if (!isNaN(difficulty) && difficulty >= 0) {
      this.powTargetDifficulty.set(difficulty);
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
      const baseEvent = this.nostrService.createEvent(1, this.content().trim(), tags);

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
}
