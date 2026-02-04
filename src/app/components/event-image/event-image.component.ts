import { Component, ChangeDetectionStrategy, computed, inject, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { type Event } from 'nostr-tools';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { UtilitiesService } from '../../services/utilities.service';

/**
 * A simplified event component optimized for screenshot/image capture.
 * 
 * Differences from regular event display:
 * - Shows full timestamp instead of relative time ("35 minutes ago")
 * - Simple text content (no parsed links, mentions, etc.)
 * - No footer section (no reactions, zaps, replies, reposts)
 * - No bookmark button
 * - No client indicator  
 * - Includes Nostria logo watermark and event ID
 */
@Component({
  selector: 'app-event-image',
  imports: [
    MatCardModule,
    TimestampPipe,
    UserProfileComponent,
  ],
  templateUrl: './event-image.component.html',
  styleUrl: './event-image.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventImageComponent {
  private utilities = inject(UtilitiesService);

  /** The event to render */
  event = input.required<Event>();

  /** Width of the rendered image in pixels */
  width = input<number>(500);

  /** The content string from the event */
  content = computed(() => this.event()?.content ?? '');

  /** The encoded event ID (nevent1... or naddr1...) */
  encodedEventId = computed(() => {
    const ev = this.event();
    if (!ev) return '';
    // Encode without relay hints to keep it shorter
    return this.utilities.encodeEventForUrl(ev, []);
  });
}
