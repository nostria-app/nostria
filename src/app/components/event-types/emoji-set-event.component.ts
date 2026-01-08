import { Component, computed, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event } from 'nostr-tools';

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
  event = input.required<Event>();

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
}
