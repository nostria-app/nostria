import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TextFieldModule } from '@angular/cdk/text-field';

import { nip19 } from 'nostr-tools';

import { FollowingService } from '../../services/following.service';
import { MessagingService } from '../../services/messaging.service';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { NostrRecord } from '../../interfaces';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { NPubPipe } from '../../pipes/npub.pipe';

export interface SendMessageDialogData {
  /** The encoded Nostr ID (nevent, naddr, etc.) of the content being shared */
  encodedId: string;
  /** Title of the content being shared (for preview) */
  title?: string;
  /** Image URL for the content preview */
  image?: string;
}

export interface SendMessageDialogResult {
  /** Whether messages were sent successfully */
  success: boolean;
  /** Number of messages sent */
  sentCount: number;
  /** Total recipients */
  totalRecipients: number;
}

@Component({
  selector: 'app-send-message-dialog',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatDividerModule,
    MatTooltipModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    TextFieldModule,
    UserProfileComponent,
    NPubPipe,
  ],
  templateUrl: './send-message-dialog.component.html',
  styleUrl: './send-message-dialog.component.scss',
})
export class SendMessageDialogComponent {
  private readonly dialogRef = inject(CustomDialogRef<SendMessageDialogComponent, SendMessageDialogResult | undefined>);
  private readonly followingService = inject(FollowingService);
  private readonly messagingService = inject(MessagingService);
  private readonly snackBar = inject(MatSnackBar);
  readonly data = inject<SendMessageDialogData>(MAT_DIALOG_DATA, { optional: true }) ?? {
    encodedId: '',
  };

  // Form state
  searchInput = signal<string>('');
  comment = signal<string>('');
  selectedRecipients = signal<NostrRecord[]>([]);

  // Sending state
  isSending = signal<boolean>(false);
  sendProgress = signal<string>('');

  // Initial following list (cached on component init)
  private initialFollowingList: NostrRecord[] = [];

  // Computed: Check if input looks like an npub
  isNpubInput = computed(() => {
    const input = this.searchInput().trim();
    return input.startsWith('npub1');
  });

  // Computed: Validate npub format
  hasValidNpub = computed(() => {
    const input = this.searchInput().trim();
    if (!input || !this.isNpubInput()) return false;

    try {
      const decoded = nip19.decode(input);
      return decoded.type === 'npub';
    } catch {
      return false;
    }
  });

  // Computed: Error message for invalid npub
  npubError = computed(() => {
    const input = this.searchInput().trim();
    if (this.isNpubInput() && input.length > 10 && !this.hasValidNpub()) {
      return 'Invalid npub format';
    }
    return '';
  });

  // Computed: Search results based on input
  searchResults = computed(() => {
    const input = this.searchInput().trim().toLowerCase();
    const selectedPubkeys = this.selectedRecipients().map(r => r.event.pubkey);

    // If input is an npub, don't show search results from following
    if (this.isNpubInput()) {
      return [];
    }

    let results: NostrRecord[];

    // If no input, show initial following list
    if (!input) {
      results = this.initialFollowingList;
    } else {
      // Filter following list by search query
      const followingResults = this.followingService.searchProfiles(input);
      results = this.followingService.toNostrRecords(followingResults);
    }

    // Filter out already selected recipients
    return results.filter(profile => !selectedPubkeys.includes(profile.event.pubkey));
  });

  // Computed: Can send the message
  canSend = computed(() => {
    return this.selectedRecipients().length > 0 && !this.isSending();
  });

  constructor() {
    // Load initial following list
    this.loadInitialFollowingList();
  }

  private loadInitialFollowingList(): void {
    // Get all profiles from following list (limited for performance)
    const allProfiles = this.followingService.searchProfiles('');
    this.initialFollowingList = this.followingService.toNostrRecords(allProfiles).slice(0, 50);
  }

  selectProfile(profile: NostrRecord): void {
    // Add to selected recipients if not already selected
    const current = this.selectedRecipients();
    if (!current.find(r => r.event.pubkey === profile.event.pubkey)) {
      this.selectedRecipients.set([...current, profile]);
    }
    this.searchInput.set('');
  }

  addNpubAsRecipient(): void {
    if (!this.hasValidNpub()) return;

    try {
      const decoded = nip19.decode(this.searchInput().trim());
      const pubkey = decoded.data as string;

      // Check if already selected
      const current = this.selectedRecipients();
      if (current.find(r => r.event.pubkey === pubkey)) {
        this.searchInput.set('');
        return;
      }

      // Create a minimal NostrRecord for the npub
      const npubRecord: NostrRecord = {
        event: {
          id: '',
          pubkey: pubkey,
          created_at: 0,
          kind: 0,
          tags: [],
          content: '',
          sig: '',
        },
        data: {},
      };

      this.selectedRecipients.set([...current, npubRecord]);
      this.searchInput.set('');
    } catch {
      // Invalid npub, do nothing
    }
  }

  removeRecipient(pubkey: string): void {
    this.selectedRecipients.update(recipients =>
      recipients.filter(r => r.event.pubkey !== pubkey)
    );
  }

  async send(): Promise<void> {
    if (!this.canSend()) return;

    const recipients = this.selectedRecipients().map(r => r.event.pubkey);
    const commentText = this.comment().trim();
    const nostrContent = `nostr:${this.data.encodedId}`;

    // Build the full message content
    const fullContent = commentText
      ? `${commentText}\n\n${nostrContent}`
      : nostrContent;

    this.isSending.set(true);
    let sentCount = 0;

    try {
      for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        this.sendProgress.set(`Sending ${i + 1} of ${recipients.length}...`);

        try {
          await this.messagingService.sendDirectMessage(fullContent, recipient);
          sentCount++;
        } catch (error) {
          console.error(`Failed to send message to ${recipient}:`, error);
          // Continue sending to other recipients
        }
      }

      // Show success message
      if (sentCount === recipients.length) {
        this.snackBar.open(
          `Message sent to ${sentCount} ${sentCount === 1 ? 'person' : 'people'}`,
          'Close',
          { duration: 3000 }
        );
      } else if (sentCount > 0) {
        this.snackBar.open(
          `Message sent to ${sentCount} of ${recipients.length} recipients`,
          'Close',
          { duration: 4000 }
        );
      } else {
        this.snackBar.open(
          'Failed to send messages. Please try again.',
          'Close',
          { duration: 4000 }
        );
      }

      // Close dialog with result
      const result: SendMessageDialogResult = {
        success: sentCount > 0,
        sentCount,
        totalRecipients: recipients.length,
      };

      this.dialogRef.close(result);
    } catch (error) {
      console.error('Error sending messages:', error);
      this.snackBar.open('Failed to send messages. Please try again.', 'Close', { duration: 4000 });
    } finally {
      this.isSending.set(false);
      this.sendProgress.set('');
    }
  }

  close(): void {
    if (!this.isSending()) {
      this.dialogRef.close();
    }
  }
}
