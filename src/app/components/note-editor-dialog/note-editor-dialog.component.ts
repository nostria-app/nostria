import { Component, inject, signal, computed, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
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
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { NostrService } from '../../services/nostr.service';
import { RelayService } from '../../services/relay.service';
import { MediaService } from '../../services/media.service';
import { UnsignedEvent } from 'nostr-tools/pure';
import { ContentComponent } from '../content/content.component';
import { Router } from '@angular/router';
import { nip19 } from 'nostr-tools';

export interface NoteEditorDialogData {
  replyTo?: {
    id: string;
    pubkey: string;
    rootId?: string;
  };
  quote?: {
    id: string;
    pubkey: string;
    content: string;
  };
  mentions?: string[]; // Array of pubkeys to mention
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
    ContentComponent
  ],
  providers: [provideNativeDateAdapter()],
  templateUrl: './note-editor-dialog.component.html',
  styleUrl: './note-editor-dialog.component.scss'
})
export class NoteEditorDialogComponent implements AfterViewInit {
  private dialogRef = inject(MatDialogRef<NoteEditorDialogComponent>);
  data = inject(MAT_DIALOG_DATA) as NoteEditorDialogData;
  private nostrService = inject(NostrService);
  private relayService = inject(RelayService);
  private mediaService = inject(MediaService);
  private snackBar = inject(MatSnackBar);
  private sanitizer = inject(DomSanitizer);
  private router = inject(Router);

  @ViewChild('contentTextarea') contentTextarea!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

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

  ngAfterViewInit() {
    // Reset drag counter when component initializes
    this.dragCounter = 0;
    this.isDragOver.set(false);
    
    // Add paste event listener for clipboard image handling
    this.setupPasteHandler();
  }

  constructor() {
    // Initialize content with quote if provided
    if (this.data?.quote) {
      this.content.set(`\n\nnostr:${this.data.quote.id}`);
    }

    // Add reply mentions if this is a reply
    if (this.data?.replyTo) {
      const currentMentions = this.mentions();
      if (!currentMentions.includes(this.data.replyTo.pubkey)) {
        this.mentions.set([...currentMentions, this.data.replyTo.pubkey]);
      }
    }
  }

  async publishNote(): Promise<void> {
    if (!this.canPublish()) return;

    this.isPublishing.set(true);

    try {
      const tags = this.buildTags();
      const event = this.nostrService.createEvent(1, this.content().trim(), tags);
      const signedEvent = await this.nostrService.signEvent(event);
      
      if (signedEvent) {
        await this.relayService.publish(signedEvent);
        this.snackBar.open('Note published successfully!', 'Close', { duration: 3000 });
        this.dialogRef.close({ published: true, event: signedEvent });

        // We don't do "note" much, we want URLs that embeds the autor.
        // const note = nip19.noteEncode(signedEvent.id);
        // this.router.navigate(['/e', note]); // Navigate to the published event
        const nevent = nip19.neventEncode({ id: signedEvent.id, author: signedEvent.pubkey });
        this.router.navigate(['/e', nevent], { state: { event: signedEvent } }); // Navigate to the published event
      } else {
        throw new Error('Failed to sign event');
      }
    } catch (error) {
      console.error('Error publishing note:', error);
      this.snackBar.open('Failed to publish note. Please try again.', 'Close', { duration: 5000 });
    } finally {
      this.isPublishing.set(false);
    }
  }

  private buildTags(): string[][] {
    const tags: string[][] = [];

    // Add reply tags (NIP-10)
    if (this.data?.replyTo) {
      if (this.data.replyTo.rootId) {
        // This is a reply to a reply, so we have both root and reply
        tags.push(['e', this.data.replyTo.rootId, '', 'root']);
        tags.push(['e', this.data.replyTo.id, '', 'reply']);
      } else {
        // This is a direct reply, so the event we're replying to is the root
        tags.push(['e', this.data.replyTo.id, '', 'root']);
      }
    }

    // Add quote tag (NIP-18)
    if (this.data?.quote) {
      tags.push(['q', this.data.quote.id]);
    }

    // Add mention tags
    this.mentions().forEach(pubkey => {
      tags.push(['p', pubkey]);
    });

    // Add expiration tag if enabled
    if (this.expirationEnabled()) {
      const expirationDateTime = this.getExpirationDateTime();
      if (expirationDateTime) {
        const expirationTimestamp = Math.floor(expirationDateTime.getTime() / 1000);
        tags.push(['expiration', expirationTimestamp.toString()]);
      }
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
    this.dialogRef.close({ published: false });
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
      
      const uploadPromises = files.map(async (file) => {
        try {
          const result = await this.mediaService.uploadFile(file, false, this.mediaService.mediaServers());
          
          if (result.status === 'success' && result.item) {
            this.insertFileUrl(result.item.url);
            return { success: true, fileName: file.name };
          } else {
            return { success: false, fileName: file.name, error: result.message };
          }
        } catch (error) {
          return { 
            success: false, 
            fileName: file.name, 
            error: error instanceof Error ? error.message : 'Upload failed' 
          };
        }
      });
      
      const results = await Promise.all(uploadPromises);
      
      // Show success/error messages
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);
      
      if (successful.length > 0) {
        this.snackBar.open(
          `${successful.length} file(s) uploaded successfully`, 
          'Close', 
          { duration: 3000 }
        );
      }
      
      if (failed.length > 0) {
        this.snackBar.open(
          `${failed.length} file(s) failed to upload`, 
          'Close', 
          { duration: 5000 }
        );
      }
      
    } catch (error) {
      this.snackBar.open(
        'Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error'), 
        'Close', 
        { duration: 5000 }
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
    const needsSpaceBefore = beforeCursor.length > 0 && !beforeCursor.endsWith(' ') && !beforeCursor.endsWith('\n');
    const needsSpaceAfter = afterCursor.length > 0 && !afterCursor.startsWith(' ') && !afterCursor.startsWith('\n');
    
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
    let imageFiles: File[] = [];
    
    // Check for image files in clipboard
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
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
}
