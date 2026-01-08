import { Component, input, inject, signal, effect, untracked } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { EmojiSetService } from '../../services/emoji-set.service';
import { EmojiSetEventComponent } from '../event-types/emoji-set-event.component';
import { Event as NostrEvent } from 'nostr-tools';

@Component({
  selector: 'app-emoji-set-mention',
  imports: [MatProgressSpinnerModule, MatCardModule, EmojiSetEventComponent],
  template: `
    <div class="emoji-set-mention">
      @if (loading()) {
        <mat-card appearance="outlined" class="loading-card">
          <mat-card-content>
            <div class="loading-state">
              <mat-spinner diameter="24"></mat-spinner>
              <span>Loading emoji set...</span>
            </div>
          </mat-card-content>
        </mat-card>
      } @else if (event()) {
        <app-emoji-set-event [event]="event()!"></app-emoji-set-event>
      } @else {
        <mat-card appearance="outlined" class="error-card">
          <mat-card-content>
            <p class="error-text">Emoji set not found</p>
          </mat-card-content>
        </mat-card>
      }
    </div>
  `,
  styles: `
    .emoji-set-mention {
      margin: 16px 0;
    }

    .loading-card,
    .error-card {
      margin: 16px 0;
    }

    .loading-state {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 16px;
      justify-content: center;
      color: var(--mat-sys-on-surface-variant);
    }

    .error-text {
      text-align: center;
      color: var(--mat-sys-error);
      padding: 16px;
    }
  `,
})
export class EmojiSetMentionComponent {
  private emojiSetService = inject(EmojiSetService);

  identifier = input.required<string>();
  pubkey = input.required<string>();

  loading = signal<boolean>(true);
  event = signal<NostrEvent | null>(null);

  constructor() {
    effect(() => {
      const identifier = this.identifier();
      const pubkey = this.pubkey();

      if (identifier && pubkey) {
        untracked(() => {
          this.loadEmojiSet(pubkey, identifier);
        });
      }
    });
  }

  private async loadEmojiSet(pubkey: string, identifier: string): Promise<void> {
    this.loading.set(true);

    try {
      const emojiSet = await this.emojiSetService.getEmojiSet(pubkey, identifier);

      if (emojiSet) {
        this.event.set(emojiSet.event);
      } else {
        this.event.set(null);
      }
    } catch (error) {
      console.error('Error loading emoji set:', error);
      this.event.set(null);
    } finally {
      this.loading.set(false);
    }
  }
}
