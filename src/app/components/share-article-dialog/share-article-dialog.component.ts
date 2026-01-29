import { Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { NoteEditorDialogComponent, NoteEditorDialogData } from '../note-editor-dialog/note-editor-dialog.component';
import { kinds, nip19 } from 'nostr-tools';
import { AccountRelayService } from '../../services/relays/account-relay';
import { UtilitiesService } from '../../services/utilities.service';

export interface ShareArticleDialogData {
  title: string;
  summary?: string;
  image?: string;
  url: string;
  eventId: string;
  pubkey: string;
  identifier?: string;
  kind: number;
  encodedId?: string;
  naddr?: string; // The original naddr with relay hints
}

@Component({
  selector: 'app-share-article-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatMenuModule],
  template: `
    <h2 mat-dialog-title>Share this post</h2>
    <mat-dialog-content>
      <!-- Article Preview Card -->
      @if (data.image || data.title) {
      <div class="article-preview">
        @if (data.image) {
        <img [src]="data.image" [alt]="data.title" class="preview-image" />
        }
        <div class="preview-info">
          <span class="preview-source">Nostria - {{ getAuthorDisplay() }}</span>
          <span class="preview-title">{{ data.title || 'Untitled Article' }}</span>
        </div>
      </div>
      }

      <!-- Primary Share Buttons -->
      <div class="share-buttons-primary">
        <button class="share-btn" (click)="copyLink()" title="Copy link">
          <mat-icon>link</mat-icon>
          <span>Copy link</span>
        </button>
        <button class="share-btn" (click)="shareToFacebook()" title="Facebook">
          <mat-icon>facebook</mat-icon>
          <span>Facebook</span>
        </button>
        <button class="share-btn" (click)="shareViaEmail()" title="Email">
          <mat-icon>mail</mat-icon>
          <span>Email</span>
        </button>
        <button class="share-btn" (click)="shareAsNote()" title="Nostr">
          <mat-icon>edit_note</mat-icon>
          <span>Nostr</span>
        </button>
        <button class="share-btn" [matMenuTriggerFor]="moreMenu" title="More options">
          <mat-icon>more_horiz</mat-icon>
        </button>
      </div>

      <!-- More Options Menu -->
      <mat-menu #moreMenu="matMenu" class="share-more-menu">
        <button mat-menu-item (click)="shareToBluesky()">
          <mat-icon>cloud</mat-icon>
          <span>Bluesky</span>
        </button>
        <button mat-menu-item (click)="shareToTwitter()">
          <mat-icon>share</mat-icon>
          <span>X (Twitter)</span>
        </button>
        <button mat-menu-item (click)="shareToLinkedIn()">
          <mat-icon>work</mat-icon>
          <span>LinkedIn</span>
        </button>
        <button mat-menu-item (click)="shareToReddit()">
          <mat-icon>forum</mat-icon>
          <span>Reddit</span>
        </button>
        <button mat-menu-item (click)="shareToPinterest()">
          <mat-icon>push_pin</mat-icon>
          <span>Pinterest</span>
        </button>
        <button mat-menu-item (click)="shareToHackerNews()">
          <mat-icon>code</mat-icon>
          <span>Hacker News</span>
        </button>
        <button mat-menu-item (click)="sendAsMessage()">
          <mat-icon>send</mat-icon>
          <span>Send as message</span>
        </button>
        <button mat-menu-item (click)="copyEmbed()">
          <mat-icon>code</mat-icon>
          <span>Embed</span>
        </button>
      </mat-menu>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    .article-preview {
      background: var(--mat-sys-surface-container);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 20px;
    }

    .preview-image {
      width: 100%;
      aspect-ratio: 16/9;
      object-fit: cover;
    }

    .preview-info {
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .preview-source {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }

    .preview-title {
      font-size: 14px;
      color: var(--mat-sys-on-surface);
    }

    .share-buttons-primary {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }

    .share-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 12px 16px;
      border: none;
      background: var(--mat-sys-surface-container);
      border-radius: 12px;
      cursor: pointer;
      transition: background-color 0.2s;
      flex: 1;
      min-width: 0;

      &:hover {
        background: var(--mat-sys-surface-container-high);
      }

      mat-icon {
        font-size: 24px;
        width: 24px;
        height: 24px;
        color: var(--mat-sys-on-surface);
      }

      span {
        font-size: 11px;
        color: var(--mat-sys-on-surface-variant);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }

    mat-dialog-content {
      min-width: 320px;
      max-width: 400px;
    }
  `,
})
export class ShareArticleDialogComponent {
  private dialogRef = inject(MatDialogRef<ShareArticleDialogComponent>, { optional: true });
  data = inject<ShareArticleDialogData>(MAT_DIALOG_DATA, { optional: true }) ?? {
    title: 'Share',
    url: '',
    eventId: '',
    pubkey: '',
    kind: 1,
  };
  private snackBar = inject(MatSnackBar);
  private customDialog = inject(CustomDialogService);
  private accountRelay = inject(AccountRelayService);
  private utilities = inject(UtilitiesService);

  /** Generate clean canonical URL for sharing (always nostria.app with clean path) */
  private getShareUrl(): string {
    const encodedId = this.getEncodedId();
    const prefix = this.data.kind === kinds.LongFormArticle ? 'a' : 'e';
    return `https://nostria.app/${prefix}/${encodedId}`;
  }

  getAuthorDisplay(): string {
    if (this.data.pubkey) {
      const npub = nip19.npubEncode(this.data.pubkey);
      return npub.slice(0, 12) + '...';
    }
    return 'Article';
  }

  shareAsNote() {
    const encodedId = this.getEncodedId();
    this.dialogRef?.close();

    setTimeout(() => {
      const noteData: NoteEditorDialogData = {
        content: `nostr:${encodedId}`,
      };

      this.customDialog.open(NoteEditorDialogComponent, {
        title: 'Share Article',
        data: noteData,
        width: '680px',
        maxWidth: '95vw',
      });
    }, 100);
  }

  async copyLink() {
    try {
      await navigator.clipboard.writeText(this.getShareUrl());
      this.snackBar.open('Link copied to clipboard', 'Close', { duration: 2000 });
      this.dialogRef?.close();
    } catch (error) {
      console.error('Failed to copy link:', error);
      this.snackBar.open('Failed to copy link', 'Close', { duration: 3000 });
    }
  }

  shareToFacebook() {
    const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(this.getShareUrl())}`;
    window.open(url, '_blank', 'width=600,height=400');
    this.dialogRef?.close();
  }

  shareViaEmail() {
    const subject = encodeURIComponent(this.data.title || 'Check out this article');
    const body = encodeURIComponent(`${this.data.summary || this.data.title}\n\n${this.getShareUrl()}`);
    window.open(`mailto:?subject=${subject}&body=${body}`);
    this.dialogRef?.close();
  }

  shareToBluesky() {
    const text = encodeURIComponent(`${this.data.title || 'Check out this article'}\n\n${this.getShareUrl()}`);
    window.open(`https://bsky.app/intent/compose?text=${text}`, '_blank');
    this.dialogRef?.close();
  }

  shareToTwitter() {
    const text = encodeURIComponent(this.data.title || 'Check out this article');
    const url = encodeURIComponent(this.getShareUrl());
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'width=600,height=400');
    this.dialogRef?.close();
  }

  shareToLinkedIn() {
    const url = encodeURIComponent(this.getShareUrl());
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`, '_blank', 'width=600,height=400');
    this.dialogRef?.close();
  }

  shareToReddit() {
    const title = encodeURIComponent(this.data.title || 'Check out this article');
    const url = encodeURIComponent(this.getShareUrl());
    window.open(`https://www.reddit.com/submit?title=${title}&url=${url}`, '_blank');
    this.dialogRef?.close();
  }

  shareToPinterest() {
    const url = encodeURIComponent(this.getShareUrl());
    const description = encodeURIComponent(this.data.title || '');
    const media = encodeURIComponent(this.data.image || '');
    window.open(`https://pinterest.com/pin/create/button/?url=${url}&description=${description}&media=${media}`, '_blank', 'width=600,height=400');
    this.dialogRef?.close();
  }

  shareToHackerNews() {
    const title = encodeURIComponent(this.data.title || 'Check out this article');
    const url = encodeURIComponent(this.getShareUrl());
    window.open(`https://news.ycombinator.com/submitlink?t=${title}&u=${url}`, '_blank');
    this.dialogRef?.close();
  }

  sendAsMessage() {
    const encodedId = this.getEncodedId();
    this.dialogRef?.close();

    // TODO: Open message composer with encodedId
    this.snackBar.open('Send as message - Coming soon!', 'Close', { duration: 2000 });
  }

  copyEmbed() {
    const embedCode = `<iframe src="${this.getShareUrl()}" width="100%" height="400" frameborder="0"></iframe>`;
    navigator.clipboard.writeText(embedCode).then(() => {
      this.snackBar.open('Embed code copied!', 'Close', { duration: 2000 });
      this.dialogRef?.close();
    });
  }

  private getEncodedId(): string {
    if (this.data.encodedId) {
      return this.data.encodedId;
    }
    if (this.data.naddr) {
      return this.data.naddr;
    }

    const relayHint = this.accountRelay.relays()[0]?.url;
    const relayHints = this.utilities.normalizeRelayUrls(relayHint ? [relayHint] : []);

    if (this.data.kind >= 30000 && this.data.kind < 40000) {
      return nip19.naddrEncode({
        identifier: this.data.identifier || '',
        pubkey: this.data.pubkey,
        kind: this.data.kind,
        relays: relayHints,
      });
    }

    return nip19.neventEncode({
      id: this.data.eventId,
      author: this.data.pubkey,
      kind: this.data.kind,
      relays: relayHints,
    });
  }
}
