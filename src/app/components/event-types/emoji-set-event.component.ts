import { Component, computed, input, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Event } from 'nostr-tools';
import { EmojiSetService } from '../../services/emoji-set.service';
import { NostrService } from '../../services/nostr.service';
import { DataService } from '../../services/data.service';
import { DatabaseService } from '../../services/database.service';
import { AccountStateService } from '../../services/account-state.service';

interface EmojiItem {
  shortcode: string;
  url: string;
}

@Component({
  selector: 'app-emoji-set-event',
  imports: [MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './emoji-set-event.component.html',
  styleUrl: './emoji-set-event.component.scss',
})
export class EmojiSetEventComponent {
  private emojiSetService = inject(EmojiSetService);
  private nostrService = inject(NostrService);
  private dataService = inject(DataService);
  private databaseService = inject(DatabaseService);
  private accountState = inject(AccountStateService);
  private snackBar = inject(MatSnackBar);

  event = input.required<Event>();
  isInstalling = signal(false);
  isInstalled = signal(false);

  // Extract the title from tags
  title = computed(() => {
    const event = this.event();
    if (!event) return 'Emoji Set';

    const titleTag = event.tags.find(tag => tag[0] === 'title');
    const dTag = event.tags.find(tag => tag[0] === 'd');
    return titleTag?.[1] || dTag?.[1] || 'Emoji Set';
  });

  // Extract the image URL from tags (optional banner/preview)
  image = computed(() => {
    const event = this.event();
    if (!event) return null;

    const imageTag = event.tags.find(tag => tag[0] === 'image');
    return imageTag?.[1] || null;
  });

  // Extract description
  description = computed(() => {
    const event = this.event();
    if (!event) return null;

    const descTag = event.tags.find(tag => tag[0] === 'description');
    return descTag?.[1] || null;
  });

  // Extract all emojis from the set
  emojis = computed(() => {
    const event = this.event();
    console.log('EmojiSetEventComponent: Computing emojis from event', event);
    if (!event) return [];

    const emojiItems: EmojiItem[] = [];

    for (const tag of event.tags) {
      if (tag[0] === 'emoji' && tag[1] && tag[2]) {
        emojiItems.push({
          shortcode: tag[1],
          url: tag[2],
        });
      }
    }

    console.log('EmojiSetEventComponent: Extracted emojis', emojiItems);
    return emojiItems;
  });

  // Track which emoji was copied
  copiedEmoji: string | null = null;

  // Copy emoji shortcode to clipboard
  async copyEmoji(emoji: EmojiItem, event: MouseEvent): Promise<void> {
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(`:${emoji.shortcode}:`);
      this.copiedEmoji = emoji.shortcode;

      // Reset after 2 seconds
      setTimeout(() => {
        this.copiedEmoji = null;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy emoji:', err);
    }
  }

  // Install emoji set to user's preferences (kind 10030)
  async installEmojiSet(): Promise<void> {
    if (this.isInstalling()) return;

    const currentEvent = this.event();
    if (!currentEvent) return;

    const pubkey = this.accountState.pubkey();
    if (!pubkey) {
      this.snackBar.open('Please sign in to install emoji sets', 'Close', { duration: 3000 });
      return;
    }

    this.isInstalling.set(true);

    try {
      // Get the current emoji preferences (kind 10030)
      const existingPrefs = await this.databaseService.getEventByPubkeyAndKind(pubkey, 10030);

      // Get the 'd' tag from the emoji set event
      const dTag = currentEvent.tags.find(tag => tag[0] === 'd')?.[1] || '';

      // Build new tags
      const tags: string[][] = [];

      // Add existing tags (except duplicate 'a' references to this set)
      if (existingPrefs) {
        for (const tag of existingPrefs.tags) {
          const aTagValue = `30030:${currentEvent.pubkey}:${dTag}`;
          if (tag[0] === 'a' && tag[1] === aTagValue) {
            // Skip - already installed
            continue;
          }
          tags.push(tag);
        }
      }

      // Add reference to this emoji set
      tags.push(['a', `30030:${currentEvent.pubkey}:${dTag}`]);

      // Create and publish kind 10030 event
      const prefsEvent = this.nostrService.createEvent(10030, '', tags);
      const result = await this.nostrService.signAndPublish(prefsEvent);

      if (result.success && result.event) {
        console.log('[EmojiSetInstall] Published kind 10030 event:', result.event);

        // Save to database for immediate local availability
        try {
          const saved = await this.databaseService.saveReplaceableEvent(result.event);
          console.log('[EmojiSetInstall] saveReplaceableEvent returned:', saved);

          // Verify it was saved (kind 10030 is replaceable, not parameterized - no d-tag)
          const verification = await this.databaseService.getEventByPubkeyAndKind(pubkey, 10030);
          console.log('[EmojiSetInstall] Verification query returned:', verification);
        } catch (saveError) {
          console.error('[EmojiSetInstall] Error saving to database:', saveError);
        }

        this.isInstalled.set(true);
        this.snackBar.open('Emoji set installed!', 'Close', { duration: 3000 });

        // Clear cache so it reloads with new preferences
        this.emojiSetService.clearUserCache(pubkey);
      } else {
        console.error('[EmojiSetInstall] Failed to publish:', result);
        this.snackBar.open('Failed to install emoji set', 'Close', { duration: 3000 });
      }
    } catch (error) {
      console.error('Error installing emoji set:', error);
      this.snackBar.open('Failed to install emoji set', 'Close', { duration: 3000 });
    } finally {
      this.isInstalling.set(false);
    }
  }
}
