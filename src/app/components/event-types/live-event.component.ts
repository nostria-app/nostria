import { Component, computed, input, inject } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { Event } from 'nostr-tools';
import { ProfileDisplayNameComponent } from '../user-profile/display-name/profile-display-name.component';

@Component({
  selector: 'app-live-event',
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatChipsModule,
    MatTooltipModule,
    DatePipe,
    ProfileDisplayNameComponent
  ],
  templateUrl: './live-event.component.html',
  styleUrl: './live-event.component.scss',
})
export class LiveEventComponent {
  event = input.required<Event>();

  private router = inject(Router);

  // Live event title
  title = computed(() => {
    const event = this.event();
    if (!event) return null;

    const titleTag = event.tags.find(tag => tag[0] === 'title');
    return titleTag?.[1] || 'Untitled Live Event';
  });

  // Live event summary/description
  summary = computed(() => {
    const event = this.event();
    if (!event) return null;

    const summaryTag = event.tags.find(tag => tag[0] === 'summary');
    return summaryTag?.[1] || null;
  });

  // Live event status
  status = computed(() => {
    const event = this.event();
    if (!event) return 'planned';

    const statusTag = event.tags.find(tag => tag[0] === 'status');
    return statusTag?.[1] || 'planned';
  });

  // Start timestamp (in seconds)
  starts = computed(() => {
    const event = this.event();
    if (!event) return null;

    const startsTag = event.tags.find(tag => tag[0] === 'starts');
    return startsTag?.[1] ? parseInt(startsTag[1], 10) : null;
  });

  // End timestamp (in seconds)
  ends = computed(() => {
    const event = this.event();
    if (!event) return null;

    const endsTag = event.tags.find(tag => tag[0] === 'ends');
    return endsTag?.[1] ? parseInt(endsTag[1], 10) : null;
  });

  // Thumbnail image
  thumbnail = computed(() => {
    const event = this.event();
    if (!event) return null;

    const thumbTag = event.tags.find(tag => tag[0] === 'thumb');
    const imageTag = event.tags.find(tag => tag[0] === 'image');
    return thumbTag?.[1] || imageTag?.[1] || null;
  });

  // Streaming URL
  streamingUrl = computed(() => {
    const event = this.event();
    if (!event) return null;

    const streamingTag = event.tags.find(tag => tag[0] === 'streaming');
    return streamingTag?.[1] || null;
  });

  // Service URL (API endpoint)
  serviceUrl = computed(() => {
    const event = this.event();
    if (!event) return null;

    const serviceTag = event.tags.find(tag => tag[0] === 'service');
    return serviceTag?.[1] || null;
  });

  // Current participants count
  currentParticipants = computed(() => {
    const event = this.event();
    if (!event) return null;

    const participantsTag = event.tags.find(tag => tag[0] === 'current_participants');
    return participantsTag?.[1] ? parseInt(participantsTag[1], 10) : null;
  });

  // Total participants count
  totalParticipants = computed(() => {
    const event = this.event();
    if (!event) return null;

    const participantsTag = event.tags.find(tag => tag[0] === 'total_participants');
    return participantsTag?.[1] ? parseInt(participantsTag[1], 10) : null;
  });

  // Participants (hosts, speakers, etc.)
  participants = computed(() => {
    const event = this.event();
    if (!event) return [];

    return event.tags
      .filter(tag => tag[0] === 'p')
      .map(tag => ({
        pubkey: tag[1],
        relay: tag[2] || '',
        role: tag[3] || 'Participant',
        proof: tag[4] || null,
      }));
  });

  // Hashtags
  hashtags = computed(() => {
    const event = this.event();
    if (!event) return [];

    return event.tags
      .filter(tag => tag[0] === 't')
      .map(tag => tag[1]);
  });

  // Extract URL from alt tag
  altUrl = computed(() => {
    const event = this.event();
    if (!event) return null;

    const altTag = event.tags.find(tag => tag[0] === 'alt');
    if (!altTag?.[1]) return null;

    // Extract URL from the alt text (format: "Watch live on <URL>")
    const urlMatch = altTag[1].match(/https?:\/\/[^\s]+/);
    return urlMatch?.[0] || null;
  });

  // Status badge color
  statusColor = computed(() => {
    const status = this.status();
    switch (status) {
      case 'live':
        return 'accent';
      case 'ended':
        return 'basic';
      default:
        return 'primary';
    }
  });

  // Status icon
  statusIcon = computed(() => {
    const status = this.status();
    switch (status) {
      case 'live':
        return 'radio_button_checked';
      case 'ended':
        return 'stop_circle';
      default:
        return 'schedule';
    }
  });

  // Check if the live event is happening now
  isLive = computed(() => {
    return this.status() === 'live';
  });

  // Navigate to streaming URL
  openStream(): void {
    const url = this.streamingUrl();
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  // Open event page or alt URL
  openEventPage(): void {
    const altUrlValue = this.altUrl();

    if (altUrlValue) {
      // If alt URL exists, open that instead
      window.open(altUrlValue, '_blank', 'noopener,noreferrer');
    } else {
      // Fallback to event page
      const event = this.event();
      if (event) {
        this.router.navigate(['/e', event.id]);
      }
    }
  }
}
