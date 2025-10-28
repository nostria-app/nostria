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

  ngAfterViewInit(): void {
    // Focus the textarea after view init
    setTimeout(() => {
      this.contentTextarea?.nativeElement.focus();
    }, 100);
  }

  async onPublish(): Promise<void> {
    const commentText = this.content().trim();

    if (!commentText) {
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

  private buildCommentEvent(content: string, pubkey: string): UnsignedEvent {
    const rootEvent = this.data.rootEvent;
    const parentComment = this.data.parentComment;
    const now = Math.floor(Date.now() / 1000);

    const tags: string[][] = [];

    // Determine if replying to a comment or the root event
    const isReplyingToComment = !!parentComment;

    if (isReplyingToComment && parentComment) {
      // Replying to a comment
      // Root scope tags (uppercase) - point to original event
      tags.push(['E', rootEvent.id, '', rootEvent.pubkey]);
      tags.push(['K', rootEvent.kind.toString()]);
      tags.push(['P', rootEvent.pubkey]);

      // Parent scope tags (lowercase) - point to the comment being replied to
      tags.push(['e', parentComment.id, '', parentComment.pubkey]);
      tags.push(['k', '1111']); // Parent is a comment (kind 1111)
      tags.push(['p', parentComment.pubkey]);
    } else {
      // Top-level comment on the event
      // Root scope tags (uppercase)
      tags.push(['E', rootEvent.id, '', rootEvent.pubkey]);
      tags.push(['K', rootEvent.kind.toString()]);
      tags.push(['P', rootEvent.pubkey]);

      // Parent scope tags (lowercase) - same as root for top-level
      tags.push(['e', rootEvent.id, '', rootEvent.pubkey]);
      tags.push(['k', rootEvent.kind.toString()]);
      tags.push(['p', rootEvent.pubkey]);
    }

    return {
      kind: 1111,
      pubkey,
      created_at: now,
      tags,
      content,
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
