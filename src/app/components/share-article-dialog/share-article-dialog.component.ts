import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { NoteEditorDialogComponent, NoteEditorDialogData } from '../note-editor-dialog/note-editor-dialog.component';
import { nip19 } from 'nostr-tools';

export interface ShareArticleDialogData {
  title: string;
  summary?: string;
  url: string;
  eventId: string;
  pubkey: string;
  identifier?: string;
  kind: number;
}

@Component({
  selector: 'app-share-article-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>Share Article</h2>
    <mat-dialog-content>
      <div class="share-options">
        <button mat-stroked-button class="share-option" (click)="shareAsNote()">
          <mat-icon>edit_note</mat-icon>
          <div class="option-text">
            <span class="option-title">Share as Note</span>
            <span class="option-description">Create a new note mentioning this article</span>
          </div>
        </button>

        @if (canNativeShare()) {
          <button mat-stroked-button class="share-option" (click)="nativeShare()">
            <mat-icon>share</mat-icon>
            <div class="option-text">
              <span class="option-title">Share via Device</span>
              <span class="option-description">Use your device's native sharing options</span>
            </div>
          </button>
        }

        <button mat-stroked-button class="share-option" (click)="copyLink()">
          <mat-icon>link</mat-icon>
          <div class="option-text">
            <span class="option-title">Copy Link</span>
            <span class="option-description">Copy article link to clipboard</span>
          </div>
        </button>

        <button mat-stroked-button class="share-option" (click)="copyNostrLink()">
          <mat-icon>tag</mat-icon>
          <div class="option-text">
            <span class="option-title">Copy Nostr Address</span>
            <span class="option-description">Copy naddr identifier for Nostr clients</span>
          </div>
        </button>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
    </mat-dialog-actions>
  `,
  styles: `
    .share-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 300px;
    }

    .share-option {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 16px;
      padding: 12px 16px;
      height: auto;
      text-align: left;
    }

    .option-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .option-title {
      line-height: 1.4;
    }

    .option-description {
      font-size: 12px;
      opacity: 0.7;
    }
  `,
})
export class ShareArticleDialogComponent {
  private dialogRef = inject(MatDialogRef<ShareArticleDialogComponent>);
  data = inject<ShareArticleDialogData>(MAT_DIALOG_DATA);
  private snackBar = inject(MatSnackBar);
  private customDialog = inject(CustomDialogService);

  canNativeShare = signal(typeof navigator !== 'undefined' && !!navigator.share);

  shareAsNote() {
    // Create the naddr for the article
    const naddr = this.createNaddr();

    // Close this dialog first
    this.dialogRef.close();

    // Open the note editor after a brief delay to ensure this dialog is closed
    setTimeout(() => {
      const noteData: NoteEditorDialogData = {
        content: `nostr:${naddr}`,
      };

      this.customDialog.open(NoteEditorDialogComponent, {
        title: 'Share Article',
        data: noteData,
        width: '680px',
        maxWidth: '95vw',
      });
    }, 100);
  }

  async nativeShare() {
    const shareData: ShareData = {
      title: this.data.title || 'Nostr Article',
      text: this.data.summary || `Check out this article: ${this.data.title || 'Nostr Article'}`,
      url: this.data.url,
    };

    try {
      if (navigator.share && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        this.dialogRef.close();
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Error sharing article:', error);
        this.snackBar.open('Failed to share article', 'Close', { duration: 3000 });
      }
    }
  }

  async copyLink() {
    try {
      await navigator.clipboard.writeText(this.data.url);
      this.snackBar.open('Link copied to clipboard', 'Close', { duration: 2000 });
      this.dialogRef.close();
    } catch (error) {
      console.error('Failed to copy link:', error);
      this.snackBar.open('Failed to copy link', 'Close', { duration: 3000 });
    }
  }

  async copyNostrLink() {
    try {
      const naddr = this.createNaddr();
      await navigator.clipboard.writeText(naddr);
      this.snackBar.open('Nostr address copied to clipboard', 'Close', { duration: 2000 });
      this.dialogRef.close();
    } catch (error) {
      console.error('Failed to copy Nostr link:', error);
      this.snackBar.open('Failed to copy Nostr address', 'Close', { duration: 3000 });
    }
  }

  private createNaddr(): string {
    return nip19.naddrEncode({
      identifier: this.data.identifier || '',
      pubkey: this.data.pubkey,
      kind: this.data.kind,
    });
  }
}
