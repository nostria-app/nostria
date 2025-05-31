import { Component, inject, signal, computed, effect } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { NostrService } from '../../services/nostr.service';
import { RelayService } from '../../services/relay.service';
import { UnsignedEvent } from 'nostr-tools/pure';

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
    MatChipsModule
  ],
  templateUrl: './note-editor-dialog.component.html',
  styleUrl: './note-editor-dialog.component.scss'
})
export class NoteEditorDialogComponent {
  private dialogRef = inject(MatDialogRef<NoteEditorDialogComponent>);
  data = inject(MAT_DIALOG_DATA) as NoteEditorDialogData;
  private nostrService = inject(NostrService);
  private relayService = inject(RelayService);
  private snackBar = inject(MatSnackBar);

  // Signals for reactive state
  content = signal('');
  isPublishing = signal(false);
  mentions = signal<string[]>(this.data?.mentions || []);

  // Computed properties
  characterCount = computed(() => this.content().length);
  charactersRemaining = computed(() => 280 - this.characterCount());
  isOverLimit = computed(() => this.characterCount() > 280);
  canPublish = computed(() => 
    this.content().trim().length > 0 && 
    !this.isOverLimit() && 
    !this.isPublishing()
  );

  // Dialog mode indicators
  isReply = computed(() => !!this.data?.replyTo);
  isQuote = computed(() => !!this.data?.quote);

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
  getCharacterCountColor(): string {
    const remaining = this.charactersRemaining();
    if (remaining < 0) return 'error-text';
    if (remaining < 20) return 'warning-text';
    return 'primary-text';
  }
}
