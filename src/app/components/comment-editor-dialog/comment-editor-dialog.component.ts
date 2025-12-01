import {
  Component,
  inject,
  signal,
  ViewChild,
  ElementRef,
  AfterViewInit,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
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
import { AccountRelayService } from '../../services/relays/account-relay';
import { MatDialog } from '@angular/material/dialog';
import { AudioRecordDialogComponent } from '../../pages/media/audio-record-dialog/audio-record-dialog.component';
import { MediaService } from '../../services/media.service';
import { EventService } from '../../services/event';

export interface CommentEditorDialogData {
  rootEvent: NostrEvent; // The event being commented on
  parentComment?: NostrEvent; // If replying to a comment
}

@Component({
  selector: 'app-comment-editor-dialog',
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    ContentComponent
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
  private accountRelay = inject(AccountRelayService);
  private accountState = inject(AccountStateService);
  private snackBar = inject(MatSnackBar);
  private eventService = inject(EventService);

  @ViewChild('contentTextarea')
  contentTextarea!: ElementRef<HTMLTextAreaElement>;

  // Signals for reactive state
  content = signal('');
  isPublishing = signal(false);
  audioAttachment = signal<{ url: string, waveform: number[], duration: number } | null>(null);

  ngAfterViewInit(): void {
    // Focus the textarea after view init
    setTimeout(() => {
      this.contentTextarea?.nativeElement.focus();
    }, 100);
  }

  onKeydown(event: KeyboardEvent): void {
    // Check for Ctrl+Enter (Windows/Linux) or Cmd+Enter (Mac)
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.onPublish();
    }
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

      // Sign the event
      const signedEvent = await this.nostrService.signEvent(unsignedEvent);

      if (!signedEvent) {
        throw new Error('Failed to sign comment');
      }

      // Publish to relays
      await this.accountRelay.publish(signedEvent);

      this.snackBar.open('Comment published successfully!', 'Close', { duration: 3000 });

      // Close dialog with success
      this.dialogRef.close({ published: true, event: signedEvent });
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
    return this.eventService.buildCommentEvent(
      this.data.rootEvent,
      content,
      pubkey,
      this.data.parentComment,
      this.audioAttachment() || undefined
    );
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
