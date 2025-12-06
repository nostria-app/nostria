import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatListModule } from '@angular/material/list';
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
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatDividerModule, MatListModule],
  template: `
    <div class="dialog-header">
      <h2 mat-dialog-title>Share Article</h2>
      <button mat-icon-button (click)="close()" class="close-button" aria-label="Close dialog">
        <mat-icon>close</mat-icon>
      </button>
    </div>
    <mat-dialog-content>
      <mat-nav-list>
        <button mat-list-item (click)="shareAsNote()">
          <mat-icon matListItemIcon>edit_note</mat-icon>
          <span matListItemTitle>Share as Note</span>
          <span matListItemLine>Create a new note mentioning this article</span>
        </button>

        <mat-divider></mat-divider>

        @if (canNativeShare()) {
          <button mat-list-item (click)="nativeShare()">
            <mat-icon matListItemIcon>share</mat-icon>
            <span matListItemTitle>Share via Device</span>
            <span matListItemLine>Use your device's native sharing options</span>
          </button>
        }

        <button mat-list-item (click)="copyLink()">
          <mat-icon matListItemIcon>link</mat-icon>
          <span matListItemTitle>Copy Link</span>
          <span matListItemLine>Copy article link to clipboard</span>
        </button>

        <button mat-list-item (click)="copyNostrLink()">
          <mat-icon matListItemIcon>tag</mat-icon>
          <span matListItemTitle>Copy Nostr Address</span>
          <span matListItemLine>Copy naddr identifier for Nostr clients</span>
        </button>
      </mat-nav-list>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">Cancel</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-right: 8px;
    }

    .dialog-header h2 {
      margin: 0;
    }

    .close-button {
      margin-top: -8px;
    }

    mat-dialog-content {
      min-width: 280px;
      padding: 0 !important;
    }

    mat-nav-list {
      padding-top: 0;
    }

    a[mat-list-item] {
      cursor: pointer;
    }

    mat-icon[matListItemIcon] {
      color: var(--mat-sys-primary);
    }
  `],
})
export class ShareArticleDialogComponent {
  private dialogRef = inject(MatDialogRef<ShareArticleDialogComponent>);
  data = inject<ShareArticleDialogData>(MAT_DIALOG_DATA);
  private snackBar = inject(MatSnackBar);
  private customDialog = inject(CustomDialogService);

  canNativeShare = signal(typeof navigator !== 'undefined' && !!navigator.share);

  close() {
    this.dialogRef.close();
  }

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
