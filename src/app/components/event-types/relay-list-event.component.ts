import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { Event } from 'nostr-tools';

@Component({
  selector: 'app-relay-list-event',
  imports: [CommonModule, MatCardModule, MatChipsModule, MatIconModule],
  templateUrl: './relay-list-event.component.html',
  styleUrl: './relay-list-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RelayListEventComponent {
  event = input.required<Event>();

  relayUrls = computed(() => {
    return this.event().tags
      .filter(tag => tag[0] === 'relay' && !!tag[1])
      .map(tag => tag[1]);
  });

  relayHosts = computed(() => {
    return this.relayUrls().map(url => {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    });
  });

  title = computed(() => {
    return this.event().kind === 10086 ? 'Discovery Relays' : 'Relay List';
  });
}