import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Event, nip19 } from 'nostr-tools';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { LayoutService } from '../../services/layout.service';
import { DataService } from '../../services/data.service';
import { NostrRecord } from '../../interfaces';
import { AgoPipe } from '../../pipes/ago.pipe';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { UtilitiesService } from '../../services/utilities.service';

interface ReferencedEventRef {
  id: string;
  relay: string;
  nevent: string;
}

interface LoadedEvent {
  record: NostrRecord | null;
  loading: boolean;
}

@Component({
  selector: 'app-wot-event',
  imports: [
    CommonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    UserProfileComponent,
    AgoPipe,
    TimestampPipe,
  ],
  templateUrl: './wot-event.component.html',
  styleUrl: './wot-event.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WotEventComponent {
  private layout = inject(LayoutService);
  private data = inject(DataService);
  private utilities = inject(UtilitiesService);

  event = input.required<Event>();

  /** Map of event ID -> loaded event data */
  loadedEvents = signal<Map<string, LoadedEvent>>(new Map());

  /** The d-tag identifier for this parameterized replaceable event */
  identifier = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 'd');
    return tag?.[1] || '';
  });

  /** Referenced event IDs from e-tags */
  referencedEvents = computed(() => {
    return this.event().tags
      .filter(t => t[0] === 'e' && !!t[1])
      .map(t => {
        const id = t[1];
        const relay = t[2] || '';
        let nevent = '';
        try {
          nevent = nip19.neventEncode({
            id,
            relays: relay ? [relay] : undefined,
          });
        } catch {
          nevent = '';
        }
        return { id, relay, nevent } as ReferencedEventRef;
      });
  });

  /** Fetch referenced events when the event input changes */
  private loadEventsEffect = effect(() => {
    const refs = this.referencedEvents();
    if (refs.length === 0) return;

    // Set all to loading state immediately
    const initial = new Map<string, LoadedEvent>();
    for (const ref of refs) {
      initial.set(ref.id, { record: null, loading: true });
    }
    this.loadedEvents.set(initial);

    // Fetch each event
    this.fetchReferencedEvents(refs);
  });

  /** Status tag (s) - e.g., "verified", "spam", "trusted" */
  status = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 's');
    return tag?.[1] || '';
  });

  /** Capitalized status for display */
  statusDisplay = computed(() => this.capitalize(this.status()));

  /** Client that created this attestation */
  client = computed(() => {
    const tag = this.event().tags.find(t => t[0] === 'client');
    return tag?.[1] || '';
  });

  /** Content text (attestation comment) */
  content = computed(() => this.utilities.normalizeRenderedEventContent(this.event().content || ''));

  /** Whether this is a positive/trust attestation */
  isPositive = computed(() => {
    const s = this.status().toLowerCase();
    return s === 'verified' || s === 'trusted' || s === 'safe' || s === 'valid';
  });

  /** Whether this is a negative/distrust attestation */
  isNegative = computed(() => {
    const s = this.status().toLowerCase();
    return s === 'spam' || s === 'bot' || s === 'malicious' || s === 'blocked' || s === 'invalid';
  });

  /** Icon to display based on status */
  statusIcon = computed(() => {
    if (this.isPositive()) return 'verified';
    if (this.isNegative()) return 'gpp_bad';
    return 'shield';
  });

  /** All custom tags that aren't standard structural ones (d, e, s, client) */
  extraTags = computed(() => {
    const knownTags = new Set(['d', 'e', 's', 'client']);
    return this.event().tags
      .filter(t => !knownTags.has(t[0]) && !!t[1])
      .map(t => ({ key: t[0], value: t[1] }));
  });

  /** Get the loaded event data for a given event ID */
  getLoadedEvent(id: string): LoadedEvent | undefined {
    return this.loadedEvents().get(id);
  }

  /** Truncate text to a max length for display */
  truncateContent(text: string, maxLength = 200): string {
    text = this.utilities.normalizeRenderedEventContent(text);
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  /** Navigate to a referenced event */
  navigateToEvent(ref: ReferencedEventRef): void {
    if (ref.nevent) {
      this.layout.openEventAsPrimary(ref.nevent);
    }
  }

  /** Capitalize the first letter of each word */
  private capitalize(value: string): string {
    if (!value) return '';
    return value.replace(/\b\w/g, char => char.toUpperCase());
  }

  /** Fetch referenced events asynchronously and update the loadedEvents signal */
  private async fetchReferencedEvents(refs: ReferencedEventRef[]): Promise<void> {
    for (const ref of refs) {
      try {
        const record = await this.data.getEventById(ref.id, { save: true });
        const current = new Map(this.loadedEvents());
        current.set(ref.id, { record, loading: false });
        this.loadedEvents.set(current);
      } catch (error) {
        console.warn(`[WotEvent] Failed to load referenced event ${ref.id}:`, error);
        const current = new Map(this.loadedEvents());
        current.set(ref.id, { record: null, loading: false });
        this.loadedEvents.set(current);
      }
    }
  }
}
