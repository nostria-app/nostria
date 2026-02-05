import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CustomDialogService, CustomDialogRef } from '../../services/custom-dialog.service';
import type { NoteEditorDialogData } from '../../interfaces/note-editor';
import { kinds, nip19, type Event } from 'nostr-tools';
import { UserRelaysService } from '../../services/relays/user-relays';
import { UtilitiesService } from '../../services/utilities.service';
import { FollowingService } from '../../services/following.service';
import { RepostService } from '../../services/repost.service';
import { EventService } from '../../services/event';
import { AccountStateService } from '../../services/account-state.service';
import { LayoutService } from '../../services/layout.service';
import { MessagingService } from '../../services/messaging.service';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { NPubPipe } from '../../pipes/npub.pipe';
import type { NostrRecord } from '../../interfaces';

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
  event?: Event; // The original event for repost/quote actions
}

@Component({
  selector: 'app-share-article-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatInputModule,
    MatFormFieldModule,
    MatDividerModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    UserProfileComponent,
    NPubPipe,
  ],
  template: `
    <div dialog-content class="share-dialog-content">
      <!-- Sending overlay -->
      @if (isSending()) {
      <div class="sending-overlay">
        <mat-spinner diameter="32"></mat-spinner>
        <span>{{ sendProgress() }}</span>
      </div>
      }

      <!-- Prominent Nostr Actions: Repost & Quote -->
      @if (data.event) {
      <div class="prominent-actions">
        <button class="prominent-action-button repost-button" (click)="createRepost()">
          <mat-icon>repeat</mat-icon>
          @if (hasReposted()) {
          <span>Undo Repost</span>
          } @else {
          <span>Repost</span>
          }
        </button>
        <button class="prominent-action-button quote-button" (click)="createQuote()">
          <mat-icon>format_quote</mat-icon>
          <span>Quote</span>
        </button>
      </div>
      <mat-divider></mat-divider>
      }

      <!-- Selected Recipients -->
      @if (selectedRecipients().length > 0) {
      <div class="selected-recipients">
        <div class="section-header">
          <span>Recipients ({{ selectedRecipients().length }})</span>
        </div>
        <div class="recipient-chips">
          @for (recipient of selectedRecipients(); track recipient.event.pubkey) {
          <div class="recipient-chip">
            <app-user-profile [pubkey]="recipient.event.pubkey" view="tiny" [disableLink]="true"></app-user-profile>
            <span class="recipient-name">{{ recipient.data?.display_name || recipient.data?.name || (recipient.event.pubkey | npub) }}</span>
            <button class="remove-recipient" (click)="removeRecipient(recipient.event.pubkey)" [disabled]="isSending()">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          }
        </div>
      </div>
      }

      <!-- Contact Search Section -->
      <div class="contact-search-section">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Send to contact</mat-label>
          <input matInput [(ngModel)]="searchInput" placeholder="Search contacts or paste npub1..." autocomplete="off"
            (keydown.enter)="onSearchEnter()" />
          @if (isNpubInput()) {
          <mat-icon matSuffix>key</mat-icon>
          } @else {
          <mat-icon matSuffix>search</mat-icon>
          }
          @if (npubError()) {
          <mat-error>{{ npubError() }}</mat-error>
          }
        </mat-form-field>

        <!-- Valid npub indicator -->
        @if (isNpubInput() && hasValidNpub()) {
        <div class="npub-valid-indicator" (click)="addNpubAsRecipient()">
          <mat-icon>check_circle</mat-icon>
          <span>Valid npub detected - Click to add</span>
          <mat-icon>add</mat-icon>
        </div>
        }

        <!-- Quick-selection: Favorites / Frequently used contacts -->
        @if (!searchInput() && !isNpubInput() && quickContacts().length > 0) {
        <div class="quick-contacts">
          @for (contact of quickContacts(); track contact.event.pubkey) {
          <button class="quick-contact-chip" (click)="selectProfile(contact)" matTooltip="Add as recipient">
            <app-user-profile [pubkey]="contact.event.pubkey" view="tiny" [disableLink]="true"></app-user-profile>
            <span class="contact-name">{{ contact.data?.display_name || contact.data?.name || 'Unknown' }}</span>
          </button>
          }
        </div>
        }

        <!-- Search results -->
        @if (searchInput() && !isNpubInput() && searchResults().length > 0) {
        <div class="search-results">
          @for (profile of searchResults(); track profile.event.pubkey) {
          <div class="search-result-item" (click)="selectProfile(profile)">
            <app-user-profile [pubkey]="profile.event.pubkey" view="list" [disableLink]="true"></app-user-profile>
          </div>
          }
        </div>
        }
        @if (searchInput() && !isNpubInput() && searchResults().length === 0) {
        <div class="no-results">
          <span>No contacts found. Try pasting an npub.</span>
        </div>
        }
      </div>

      <!-- Comment field (shown when recipients selected) -->
      @if (selectedRecipients().length > 0) {
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Add a comment (optional)</mat-label>
        <textarea matInput [(ngModel)]="comment" cdkTextareaAutosize cdkAutosizeMinRows="2" cdkAutosizeMaxRows="5"
          [disabled]="isSending()"></textarea>
        <mat-hint>Your comment will appear above the shared content</mat-hint>
      </mat-form-field>
      }

      <mat-divider></mat-divider>

      <!-- Share Actions -->
      <div class="share-actions-list">
        <button class="share-action-item" (click)="copyLink()">
          <mat-icon>link</mat-icon>
          <span>Copy Link</span>
        </button>

        <button class="share-action-item" (click)="shareAsNote()">
          <mat-icon>edit_note</mat-icon>
          <span>Post on Nostr</span>
        </button>

        <mat-divider></mat-divider>

        <button class="share-action-item" (click)="shareViaEmail()">
          <mat-icon>mail</mat-icon>
          <span>Email</span>
        </button>
        <button class="share-action-item" (click)="shareToBluesky()">
          <mat-icon>cloud</mat-icon>
          <span>Bluesky</span>
        </button>
        <button class="share-action-item" (click)="shareToTwitter()">
          <mat-icon>tag</mat-icon>
          <span>X (Twitter)</span>
        </button>
        <button class="share-action-item" (click)="shareToReddit()">
          <mat-icon>forum</mat-icon>
          <span>Reddit</span>
        </button>
        <button class="share-action-item" (click)="shareToFacebook()">
          <mat-icon>facebook</mat-icon>
          <span>Facebook</span>
        </button>
        <button class="share-action-item" (click)="shareToLinkedIn()">
          <mat-icon>work</mat-icon>
          <span>LinkedIn</span>
        </button>
        <button class="share-action-item" (click)="shareToHackerNews()">
          <mat-icon>code</mat-icon>
          <span>Hacker News</span>
        </button>
        <button class="share-action-item" (click)="shareToPinterest()">
          <mat-icon>push_pin</mat-icon>
          <span>Pinterest</span>
        </button>
        <button class="share-action-item" (click)="copyEmbed()">
          <mat-icon>data_object</mat-icon>
          <span>Copy Embed Code</span>
        </button>
      </div>
    </div>
    <div dialog-actions class="dialog-actions">
      @if (selectedRecipients().length > 0) {
      <button mat-button (click)="close()" [disabled]="isSending()">Cancel</button>
      <button mat-flat-button (click)="sendToRecipients()" [disabled]="!canSend()">
        @if (isSending()) {
        <mat-spinner diameter="18"></mat-spinner>
        <span>Sending...</span>
        } @else {
        <mat-icon>send</mat-icon>
        <span>Send to {{ selectedRecipients().length }} {{ selectedRecipients().length === 1 ? 'person' : 'people' }}</span>
        }
      </button>
      } @else {
      <button mat-button (click)="close()">Close</button>
      }
    </div>
  `,
  styles: `
    .share-dialog-content {
      min-width: 320px;
      position: relative;
    }

    .sending-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      background: color-mix(in srgb, var(--mat-sys-surface) 90%, transparent);
      z-index: 10;
      border-radius: 8px;

      span {
        color: var(--mat-sys-on-surface-variant);
        font-size: 13px;
      }
    }

    .full-width {
      width: 100%;
    }

    .prominent-actions {
      display: flex;
      gap: 12px;
      padding: 4px 0 12px;
    }

    .prominent-action-button {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface);
      border-radius: 12px;
      cursor: pointer;
      font-size: 14px;
      transition: background-color 0.15s, border-color 0.15s;

      mat-icon {
        color: var(--mat-sys-primary);
        flex-shrink: 0;
      }

      &:hover {
        background: var(--mat-sys-surface-container-highest);
        border-color: var(--mat-sys-outline);
      }

      &.repost-button:hover {
        background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent);
        border-color: var(--mat-sys-primary);
      }

      &.quote-button:hover {
        background: color-mix(in srgb, var(--mat-sys-tertiary) 12%, transparent);
        border-color: var(--mat-sys-tertiary);
      }

      &.quote-button mat-icon {
        color: var(--mat-sys-tertiary);
      }
    }

    .selected-recipients {
      padding: 8px 0;

      .section-header {
        font-size: 12px;
        text-transform: uppercase;
        color: var(--mat-sys-on-surface-variant);
        margin-bottom: 8px;
        letter-spacing: 0.5px;
      }

      .recipient-chips {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
    }

    .recipient-chip {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 4px 4px 4px;
      background: var(--mat-sys-surface-container-high);
      border-radius: 20px;
      max-width: 180px;

      .recipient-name {
        font-size: 12px;
        color: var(--mat-sys-on-surface);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100px;
      }

      .remove-recipient {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: 50%;
        padding: 0;
        color: var(--mat-sys-on-surface-variant);

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
        }

        &:hover {
          background: var(--mat-sys-surface-container-highest);
        }
      }
    }

    .contact-search-section {
      margin-bottom: 8px;
    }

    .npub-valid-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
      border-radius: 8px;
      cursor: pointer;
      margin-bottom: 8px;
      font-size: 13px;
      transition: background-color 0.15s;

      &:hover {
        background: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);
      }

      mat-icon:first-child {
        color: inherit;
      }

      span {
        flex: 1;
      }
    }

    .quick-contacts {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }

    .quick-contact-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px 4px 4px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container);
      border-radius: 20px;
      cursor: pointer;
      transition: background-color 0.2s;
      max-width: 160px;

      &:hover {
        background: var(--mat-sys-surface-container-high);
      }

      .contact-name {
        font-size: 12px;
        color: var(--mat-sys-on-surface);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }

    .search-results {
      max-height: 200px;
      overflow-y: auto;
      margin-bottom: 8px;
    }

    .search-result-item {
      padding: 6px 8px;
      cursor: pointer;
      border-radius: 8px;
      transition: background-color 0.15s;

      &:hover {
        background: var(--mat-sys-surface-container-high);
      }
    }

    .no-results {
      padding: 12px;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
      font-size: 13px;
    }

    .share-actions-list {
      display: flex;
      flex-direction: column;
      padding: 8px 0;
    }

    .share-action-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border: none;
      background: transparent;
      cursor: pointer;
      border-radius: 8px;
      transition: background-color 0.15s;
      color: var(--mat-sys-on-surface);
      font-size: 14px;
      text-align: left;

      &:hover {
        background: var(--mat-sys-surface-container-high);
      }

      mat-icon {
        color: var(--mat-sys-on-surface-variant);
        flex-shrink: 0;
      }

      span {
        flex: 1;
      }
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;

      button {
        display: flex;
        align-items: center;
        gap: 8px;
      }
    }

    mat-divider {
      margin: 4px 0;
    }
  `,
})
export class ShareArticleDialogComponent {
  private dialogRef = inject(CustomDialogRef<ShareArticleDialogComponent>, { optional: true });
  data = inject<ShareArticleDialogData>(MAT_DIALOG_DATA, { optional: true }) ?? {
    title: 'Share',
    url: '',
    eventId: '',
    pubkey: '',
    kind: 1,
  };
  private snackBar = inject(MatSnackBar);
  private customDialog = inject(CustomDialogService);
  private userRelaysService = inject(UserRelaysService);
  private utilities = inject(UtilitiesService);
  private followingService = inject(FollowingService);
  private repostService = inject(RepostService);
  private eventService = inject(EventService);
  private accountState = inject(AccountStateService);
  private layout = inject(LayoutService);
  private messagingService = inject(MessagingService);

  // Contact search
  searchInput = signal<string>('');
  comment = signal<string>('');
  selectedRecipients = signal<NostrRecord[]>([]);
  isSending = signal<boolean>(false);
  sendProgress = signal<string>('');

  // Npub detection
  isNpubInput = computed(() => this.searchInput().trim().startsWith('npub1'));

  hasValidNpub = computed(() => {
    const input = this.searchInput().trim();
    if (!input.startsWith('npub1')) return false;
    try {
      const decoded = nip19.decode(input);
      return decoded.type === 'npub';
    } catch {
      return false;
    }
  });

  npubError = computed(() => {
    const input = this.searchInput().trim();
    if (input.startsWith('npub1') && input.length > 10) {
      try {
        nip19.decode(input);
        return '';
      } catch {
        return 'Invalid npub format';
      }
    }
    return '';
  });

  searchResults = computed(() => {
    const input = this.searchInput().trim().toLowerCase();
    if (!input || this.isNpubInput()) return [];
    const results = this.followingService.searchProfiles(input);
    const records = this.followingService.toNostrRecords(results).slice(0, 10);
    // Filter out already selected recipients
    const selectedPubkeys = new Set(this.selectedRecipients().map(r => r.event.pubkey));
    return records.filter(r => !selectedPubkeys.has(r.event.pubkey));
  });

  // Quick contacts: first N from following list (favorites/frequent)
  quickContacts = computed(() => {
    const allProfiles = this.followingService.searchProfiles('');
    const records = this.followingService.toNostrRecords(allProfiles).slice(0, 8);
    // Filter out already selected recipients
    const selectedPubkeys = new Set(this.selectedRecipients().map(r => r.event.pubkey));
    return records.filter(r => !selectedPubkeys.has(r.event.pubkey));
  });

  canSend = computed(() => this.selectedRecipients().length > 0 && !this.isSending());

  // Track repost state
  hasReposted = signal<boolean>(false);

  constructor() {
    // Check if user has already reposted this event
    this.checkRepostState();
  }

  private async checkRepostState() {
    if (!this.data.event) return;
    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) return;

    try {
      const reposts = await this.eventService.loadReposts(
        this.data.eventId,
        this.data.kind,
        userPubkey,
        false
      );
      this.hasReposted.set(reposts.some(r => r.event.pubkey === userPubkey));
    } catch {
      // Ignore errors
    }
  }

  close() {
    if (this.isSending()) return;
    this.dialogRef?.close();
  }

  // --- Recipient selection ---

  selectProfile(profile: NostrRecord) {
    const current = this.selectedRecipients();
    if (current.some(r => r.event.pubkey === profile.event.pubkey)) return;
    this.selectedRecipients.set([...current, profile]);
    this.searchInput.set('');
  }

  removeRecipient(pubkey: string) {
    this.selectedRecipients.update(recipients =>
      recipients.filter(r => r.event.pubkey !== pubkey)
    );
  }

  addNpubAsRecipient() {
    const input = this.searchInput().trim();
    try {
      const decoded = nip19.decode(input);
      if (decoded.type !== 'npub') return;
      const pubkey = decoded.data;

      // Check if already selected
      if (this.selectedRecipients().some(r => r.event.pubkey === pubkey)) {
        this.searchInput.set('');
        return;
      }

      const record: NostrRecord = {
        event: { id: '', pubkey, kind: 0, created_at: 0, content: '', tags: [], sig: '' },
        data: null,
      };
      this.selectedRecipients.update(recipients => [...recipients, record]);
      this.searchInput.set('');
    } catch {
      // Invalid npub, ignore
    }
  }

  onSearchEnter() {
    if (this.isNpubInput() && this.hasValidNpub()) {
      this.addNpubAsRecipient();
    }
  }

  // --- Send messages ---

  async sendToRecipients() {
    if (!this.canSend()) return;

    const recipients = this.selectedRecipients();
    const encodedId = this.getEncodedId();
    const commentText = this.comment().trim();
    const fullContent = commentText
      ? `${commentText}\n\nnostr:${encodedId}`
      : `nostr:${encodedId}`;

    this.isSending.set(true);
    let sentCount = 0;

    try {
      for (let i = 0; i < recipients.length; i++) {
        this.sendProgress.set(`Sending ${i + 1} of ${recipients.length}...`);
        try {
          await this.messagingService.sendDirectMessage(fullContent, recipients[i].event.pubkey);
          sentCount++;
        } catch (error) {
          console.error(`Failed to send to ${recipients[i].event.pubkey}:`, error);
        }
      }

      if (sentCount === recipients.length) {
        this.snackBar.open(`Sent to ${sentCount} ${sentCount === 1 ? 'person' : 'people'}`, 'Close', { duration: 2000 });
      } else if (sentCount > 0) {
        this.snackBar.open(`Sent to ${sentCount} of ${recipients.length}`, 'Close', { duration: 3000 });
      } else {
        this.snackBar.open('Failed to send messages', 'Close', { duration: 3000 });
      }

      this.dialogRef?.close();
    } finally {
      this.isSending.set(false);
      this.sendProgress.set('');
    }
  }

  // --- Repost / Quote ---

  async createRepost() {
    const ev = this.data.event;
    if (!ev) return;

    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      await this.layout.showLoginDialog();
      return;
    }

    if (this.hasReposted()) {
      // Undo repost
      try {
        const reposts = await this.eventService.loadReposts(
          this.data.eventId,
          this.data.kind,
          userPubkey,
          false
        );
        const ourRepost = reposts.find(r => r.event.pubkey === userPubkey);
        if (ourRepost) {
          await this.repostService.deleteRepost(ourRepost.event);
          this.hasReposted.set(false);
          this.snackBar.open('Repost removed', 'Close', { duration: 2000 });
        }
      } catch (error) {
        console.error('Failed to undo repost:', error);
        this.snackBar.open('Failed to undo repost', 'Close', { duration: 3000 });
      }
    } else {
      try {
        await this.repostService.repostNote(ev);
        this.hasReposted.set(true);
        this.snackBar.open('Reposted', 'Close', { duration: 2000 });
      } catch (error) {
        console.error('Failed to repost:', error);
        this.snackBar.open('Failed to repost', 'Close', { duration: 3000 });
      }
    }
  }

  async createQuote() {
    const ev = this.data.event;
    if (!ev) return;

    const userPubkey = this.accountState.pubkey();
    const currentAccount = this.accountState.account();
    if (!userPubkey || currentAccount?.source === 'preview') {
      await this.layout.showLoginDialog();
      return;
    }

    this.dialogRef?.close();
    this.eventService.createNote({
      quote: {
        id: ev.id,
        pubkey: ev.pubkey,
        kind: ev.kind,
      },
    });
  }

  // --- Share actions ---

  /** Generate clean canonical URL for sharing (uses data.url if provided, otherwise generates from event) */
  private getShareUrl(): string {
    // If a URL is explicitly provided and it's a nostria.app URL, use it directly
    if (this.data.url && this.data.url.includes('nostria.app')) {
      return this.data.url;
    }

    // Otherwise, generate URL from event data
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

  async shareAsNote() {
    const encodedId = this.getEncodedId();
    this.dialogRef?.close();

    setTimeout(async () => {
      const noteData: NoteEditorDialogData = {
        content: `nostr:${encodedId}`,
      };

      // Dynamically import NoteEditorDialogComponent to avoid circular dependency
      const { NoteEditorDialogComponent } = await import('../note-editor-dialog/note-editor-dialog.component');

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

    const authorRelays = this.userRelaysService.getRelaysForPubkey(this.data.pubkey);
    const relayHint = authorRelays[0];
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
