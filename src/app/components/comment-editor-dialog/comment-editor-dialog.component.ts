import {
  Component,
  inject,
  signal,
  ViewChild,
  ElementRef,
  AfterViewInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { FormsModule } from '@angular/forms';

import { NostrService } from '../../services/nostr.service';
import { AccountStateService } from '../../services/account-state.service';
import { ContentComponent } from '../content/content.component';
import { Event as NostrEvent, UnsignedEvent } from 'nostr-tools';
import { MatDialog } from '@angular/material/dialog';
import { AudioRecordDialogComponent } from '../../pages/media/audio-record-dialog/audio-record-dialog.component';
import { MediaService } from '../../services/media.service';
import { EventService } from '../../services/event';
import { MentionAutocompleteComponent, MentionSelection, MentionAutocompleteConfig } from '../mention-autocomplete/mention-autocomplete.component';
import { MentionInputService, MentionDetectionResult } from '../../services/mention-input.service';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { MaterialCustomDialogComponent } from '../material-custom-dialog/material-custom-dialog.component';

export interface CommentEditorDialogData {
  rootEvent: NostrEvent; // The event being commented on
  parentComment?: NostrEvent; // If replying to a comment
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-comment-editor-dialog',
  imports: [
    FormsModule,
    MaterialCustomDialogComponent,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    ContentComponent,
    MentionAutocompleteComponent,
    UserProfileComponent,
  ],
  templateUrl: './comment-editor-dialog.component.html',
  styleUrl: './comment-editor-dialog.component.scss',
})
export class CommentEditorDialogComponent implements AfterViewInit {
  private dialog = inject(MatDialog);
  private mediaService = inject(MediaService);
  private dialogRef = inject(MatDialogRef<CommentEditorDialogComponent>);
  data = inject(MAT_DIALOG_DATA) as CommentEditorDialogData;
  private nostrService = inject(NostrService);
  private accountState = inject(AccountStateService);
  private snackBar = inject(MatSnackBar);
  private eventService = inject(EventService);
  private mentionInputService = inject(MentionInputService);

  @ViewChild('contentTextarea')
  contentTextarea!: ElementRef<HTMLTextAreaElement>;
  @ViewChild(MentionAutocompleteComponent) mentionAutocomplete?: MentionAutocompleteComponent;

  // Signals for reactive state
  content = signal('');
  isPublishing = signal(false);
  audioAttachment = signal<{ url: string, waveform: number[], duration: number } | null>(null);

  // Mention state
  mentionConfig = signal<MentionAutocompleteConfig | null>(null);
  mentionPosition = signal<{ top: number; left: number }>({ top: 0, left: 0 });
  private mentionDetection = signal<MentionDetectionResult | null>(null);
  private mentionMap = new Map<string, string>(); // @name -> nostr:uri
  private pubkeyToNameMap = new Map<string, string>(); // pubkey -> display name
  private mentionedPubkeys: string[] = [];

  ngAfterViewInit(): void {
    // Focus the textarea after view init
    setTimeout(() => {
      this.contentTextarea?.nativeElement.focus();
    }, 100);
  }

  onKeydown(event: KeyboardEvent): void {
    const mentionConfig = this.mentionConfig();

    // If mention autocomplete is open, handle navigation keys
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

    // Check for Ctrl+Enter (Windows/Linux) or Option+Enter (Mac)
    if (event.key === 'Enter' && (event.ctrlKey || event.altKey)) {
      event.preventDefault();
      this.onPublish();
    }
  }

  onKeyup(event: KeyboardEvent): void {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
      return;
    }
    const target = event.target as HTMLTextAreaElement;
    this.handleMentionInput(this.content(), target.selectionStart || 0);
  }

  onContentInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.content.set(target.value);
    this.handleMentionInput(target.value, target.selectionStart || 0);
  }

  onContentClick(event: MouseEvent): void {
    const target = event.target as HTMLTextAreaElement;
    this.handleMentionInput(this.content(), target.selectionStart || 0);
  }

  async onPublish(): Promise<void> {
    const commentText = this.content().trim();

    if (!commentText && !this.audioAttachment()) {
      this.snackBar.open('Comment cannot be empty', 'Close', { duration: 3000 });
      return;
    }

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open('No account selected', 'Close', { duration: 3000 });
      return;
    }

    this.isPublishing.set(true);

    try {
      // Build NIP-22 comment event
      const unsignedEvent = this.buildCommentEvent(commentText, pubkey);

      // Sign and publish via PublishService so publishEventBus fires relay-result events
      const result = await this.nostrService.signAndPublish(unsignedEvent);

      if (!result.success || !result.event) {
        throw new Error(result.error || 'Failed to publish comment');
      }

      this.snackBar.open('Comment published successfully!', 'Close', { duration: 3000 });

      // Close dialog with success
      this.dialogRef.close({ published: true, event: result.event });
    } catch (error) {
      console.error('Failed to publish comment:', error);
      this.snackBar.open('Failed to publish comment. Please try again.', 'Close', {
        duration: 5000,
      });
    } finally {
      this.isPublishing.set(false);
    }
  }

  recordAudio() {
    const dialogRef = this.dialog.open(AudioRecordDialogComponent, {
      width: '400px',
      maxWidth: '90vw',
      panelClass: 'responsive-dialog',
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe(async result => {
      if (result && result.blob) {
        try {
          this.isPublishing.set(true); // Reuse publishing spinner for uploading

          // Upload file
          const file = new File([result.blob], 'voice-message.mp4', { type: result.blob.type });
          const uploadResult = await this.mediaService.uploadFile(
            file,
            false,
            this.mediaService.mediaServers()
          );

          this.isPublishing.set(false);

          if (uploadResult.status === 'success' && uploadResult.item) {
            this.audioAttachment.set({
              url: uploadResult.item.url,
              waveform: result.waveform,
              duration: Math.round(result.duration)
            });
            this.content.set(uploadResult.item.url);
          } else {
            this.snackBar.open('Failed to upload voice message', 'Close', { duration: 3000 });
          }
        } catch (error) {
          console.error(error);
          this.isPublishing.set(false);
          this.snackBar.open('Failed to upload voice message', 'Close', { duration: 3000 });
        }
      }
    });
  }

  private buildCommentEvent(content: string, pubkey: string): UnsignedEvent {
    const processedContent = this.processContentForPublishing(content);
    const event = this.eventService.buildCommentEvent(
      this.data.rootEvent,
      processedContent,
      pubkey,
      this.data.parentComment,
      this.audioAttachment() || undefined
    );

    // Add p tags for mentioned users
    const existingPubkeys = new Set(event.tags.filter(t => t[0] === 'p' || t[0] === 'P').map(t => t[1]));
    for (const mentionPubkey of this.mentionedPubkeys) {
      if (!existingPubkeys.has(mentionPubkey)) {
        event.tags.push(['p', mentionPubkey]);
      }
    }

    // Extract hashtags and add as lowercase "t" tags
    const hashtagRegex = /#([a-zA-Z0-9_]+)/g;
    const hashtags = new Set<string>();
    let match;
    while ((match = hashtagRegex.exec(processedContent)) !== null) {
      hashtags.add(match[1].toLowerCase());
    }
    for (const hashtag of hashtags) {
      event.tags.push(['t', hashtag]);
    }

    return event;
  }

  private processContentForPublishing(content: string): string {
    let processed = content;
    const sortedEntries = Array.from(this.mentionMap.entries()).sort((a, b) => b[0].length - a[0].length);
    for (const [name, uri] of sortedEntries) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedName, 'g');
      processed = processed.replace(regex, uri);
    }
    return processed;
  }

  private handleMentionInput(content: string, cursorPosition: number): void {
    const detection = this.mentionInputService.detectMention(content, cursorPosition);
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

    const cursorTop = textareaRect.top + cursorCoords.top;
    const cursorLeft = textareaRect.left + cursorCoords.left;

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

    // Add to mentioned pubkeys list
    if (!this.mentionedPubkeys.includes(selection.pubkey)) {
      this.mentionedPubkeys.push(selection.pubkey);
    }

    const replacement = this.mentionInputService.replaceMention(detection, textToInsert);
    this.content.set(replacement.replacementText);

    // Restore cursor position after content update
    setTimeout(() => {
      const textarea = this.contentTextarea?.nativeElement;
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(replacement.newCursorPosition, replacement.newCursorPosition);
      }
    });

    this.mentionConfig.set(null);
  }

  onMentionDismissed(): void {
    this.mentionConfig.set(null);
  }

  onCancel(): void {
    this.dialogRef.close({ published: false });
  }

  // Get title based on whether replying to comment or root event
  getTitle(): string {
    if (this.data.parentComment) {
      return 'Reply to Comment';
    }
    return 'Add Comment';
  }
}
