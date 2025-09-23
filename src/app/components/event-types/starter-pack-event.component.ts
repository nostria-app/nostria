import { Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { Event } from 'nostr-tools';
import { UserProfileComponent } from '../user-profile/user-profile.component';

@Component({
  selector: 'app-starter-pack-event',
  imports: [CommonModule, MatCardModule, MatIconModule, UserProfileComponent],
  templateUrl: './starter-pack-event.component.html',
  styleUrl: './starter-pack-event.component.scss',
})
export class StarterPackEventComponent {
  event = input.required<Event>();

  // Extract the title from tags
  title = computed(() => {
    const event = this.event();
    if (!event) return null;

    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return titleTag?.[1] || 'Starter Pack';
  });

  // Extract the image URL from tags
  image = computed(() => {
    const event = this.event();
    if (!event) return null;

    const imageTag = event.tags.find(tag => tag[0] === 'image');
    return imageTag?.[1] || null;
  });

  // Extract all public keys (p tags) that represent users in the starter pack
  publicKeys = computed(() => {
    const event = this.event();
    if (!event) return [];

    return event.tags.filter(tag => tag[0] === 'p' && tag[1]).map(tag => tag[1]);
  });

  // Extract the d tag (identifier)
  identifier = computed(() => {
    const event = this.event();
    if (!event) return null;

    const dTag = event.tags.find(tag => tag[0] === 'd');
    return dTag?.[1] || null;
  });
}
