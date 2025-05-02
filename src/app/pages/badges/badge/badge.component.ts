import { Component, effect, input, signal } from '@angular/core';
import { NostrEvent } from '../../../interfaces';
import { MatCardModule } from '@angular/material/card';

interface ParsedBadge {
  id: string;
  description: string;
  name: string;
  image: string;
  thumb: string;
  tags: string[];
}

@Component({
  selector: 'app-badge',
  imports: [MatCardModule],
  templateUrl: './badge.component.html',
  styleUrl: './badge.component.scss'
})
export class BadgeComponent {
  badge = input<NostrEvent | undefined>(undefined);
  
  // Parsed badge data as signals
  id = signal<string>('');
  description = signal<string>('');
  name = signal<string>('');
  image = signal<string>('');
  thumb = signal<string>('');
  tags = signal<string[]>([]);

  constructor() {
    effect(() => {
      if (this.badge()) {
        this.parseBadge();
      }
    });
  }

  parseBadge() {
    const badgeEvent = this.badge();
    if (!badgeEvent || !badgeEvent.tags) {
      return;
    }

    const parsedBadge: Partial<ParsedBadge> = {
      tags: []
    };

    // Parse each tag based on its identifier
    for (const tag of badgeEvent.tags) {
      if (tag.length >= 2) {
        const [key, value] = tag;
        
        switch (key) {
          case 'd':
            parsedBadge.id = value;
            break;
          case 'description':
            parsedBadge.description = value;
            break;
          case 'name':
            parsedBadge.name = value;
            break;
          case 'image':
            parsedBadge.image = value;
            break;
          case 'thumb':
            parsedBadge.thumb = value;
            break;
          case 't':
            // Accumulate types in an array
            if (parsedBadge.tags) {
              parsedBadge.tags.push(value);
            }
            break;
        }
      }
    }

    // Update the signals with the parsed values
    this.id.set(parsedBadge.id || '');
    this.description.set(parsedBadge.description || '');
    this.name.set(parsedBadge.name || '');
    this.image.set(parsedBadge.image || '');
    this.thumb.set(parsedBadge.thumb || '');
    this.tags.set(parsedBadge.tags || []);
  }
}