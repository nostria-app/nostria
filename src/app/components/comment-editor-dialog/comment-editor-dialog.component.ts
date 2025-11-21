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
import { CommonModule } from '@angular/common';
import { NostrService } from '../../services/nostr.service';
import { AccountStateService } from '../../services/account-state.service';
import { ContentComponent } from '../content/content.component';
import { Event as NostrEvent, UnsignedEvent } from 'nostr-tools';
import { AccountRelayService } from '../../services/relays/account-relay';
import { MatDialog } from '@angular/material/dialog';
import { AudioRecordDialogComponent } from '../../pages/media/audio-record-dialog/audio-record-dialog.component';
import { MediaService } from '../../services/media.service';

export interface CommentEditorDialogData {
  rootEvent: NostrEvent; // The event being commented on
  parentComment?: NostrEvent; // If replying to a comment
}

@Component({
  selector: 'app-comment-editor-dialog',
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    ContentComponent,
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
          this.isPublishing.set(false);
          this.snackBar.open('Failed to upload voice message', 'Close', { duration: 3000 });
        }
      }
    });
  }

  private buildCommentEvent(content: string, pubkey: string): UnsignedEvent {
    const rootEvent = this.data.rootEvent;
    const parentComment = this.data.parentComment;
    const now = Math.floor(Date.now() / 1000);

    const tags: string[][] = [];

    // Determine if replying to a comment or the root event
    const isReplyingToComment = !!parentComment;

    // Check if root event is addressable (kind >= 30000 and < 40000)
    const isRootAddressable = rootEvent.kind >= 30000 && rootEvent.kind < 40000;

    if (isReplyingToComment && parentComment) {
      // Replying to a comment
      // Root scope tags (uppercase) - point to original event
      if (isRootAddressable) {
        // Use A tag for addressable events (like articles)
        const dTag = rootEvent.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const aTagValue = `${rootEvent.kind}:${rootEvent.pubkey}:${dTag}`;
        tags.push(['A', aTagValue, '', rootEvent.pubkey]);
      } else {
        // Use E tag for regular events
        tags.push(['E', rootEvent.id, '', rootEvent.pubkey]);
      }
      tags.push(['K', rootEvent.kind.toString()]);
      tags.push(['P', rootEvent.pubkey]);

      // Parent scope tags (lowercase) - point to the comment being replied to
      tags.push(['e', parentComment.id, '', parentComment.pubkey]);
      tags.push(['k', '1111']); // Parent is a comment (kind 1111)
      tags.push(['p', parentComment.pubkey]);
    } else {
      // Top-level comment on the event
      // Root scope tags (uppercase)
      if (isRootAddressable) {
        // Use A tag for addressable events (like articles)
        const dTag = rootEvent.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const aTagValue = `${rootEvent.kind}:${rootEvent.pubkey}:${dTag}`;
        tags.push(['A', aTagValue, '', rootEvent.pubkey]);
      } else {
        // Use E tag for regular events
        tags.push(['E', rootEvent.id, '', rootEvent.pubkey]);
      }
      tags.push(['K', rootEvent.kind.toString()]);
      tags.push(['P', rootEvent.pubkey]);

      // Parent scope tags (lowercase) - same as root for top-level
      if (isRootAddressable) {
        const dTag = rootEvent.tags.find(tag => tag[0] === 'd')?.[1] || '';
        const aTagValue = `${rootEvent.kind}:${rootEvent.pubkey}:${dTag}`;
        tags.push(['a', aTagValue, '', rootEvent.pubkey]);
      } else {
        tags.push(['e', rootEvent.id, '', rootEvent.pubkey]);
      }
      tags.push(['k', rootEvent.kind.toString()]);
      tags.push(['p', rootEvent.pubkey]);
    }

    const kind = this.audioAttachment() ? 1244 : 1111;

    if (this.audioAttachment()) {
      const att = this.audioAttachment()!;
      const waveform = att.waveform.join(' ');
      tags.push(['imeta', `url ${att.url}`, `waveform ${waveform}`, `duration ${att.duration}`]);
      tags.push(['alt', 'Voice reply']);
    }

    return {
      kind,
      content,
      tags,
      created_at: now,
      pubkey,
    };
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
