import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { type Event, nip19 } from 'nostr-tools';
import { standardizedTag } from '../../standardized-tags';
import { LayoutService } from '../../services/layout.service';
import { CustomDialogRef } from '../../services/custom-dialog.service';
import { LocalSettingsService } from '../../services/local-settings.service';
import { getKindLabel } from '../../utils/kind-labels';
import { ChroniaCalendarService } from '../../services/chronia-calendar.service';
import { EthiopianCalendarService } from '../../services/ethiopian-calendar.service';
import { EventRelaySourcesService } from '../../services/event-relay-sources.service';

export interface EventDetailsDialogData {
  event: Event;
  relayUrls?: string[];
}

@Component({
  selector: 'app-event-details-dialog',
  imports: [
    CommonModule,
    MatButtonModule,
    MatTabsModule,
    MatListModule,
    MatIconModule,
    MatChipsModule,
    MatDividerModule,
    MatCardModule,
    MatTooltipModule,
  ],
  templateUrl: './event-details-dialog.component.html',
  styleUrl: './event-details-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventDetailsDialogComponent {
  dialogRef?: CustomDialogRef<EventDetailsDialogComponent>;
  private dialogDataState = signal<EventDetailsDialogData>({ event: {} as Event });

  set data(value: EventDetailsDialogData | undefined) {
    if (value) {
      this.dialogDataState.set(value);
    }
  }

  get data(): EventDetailsDialogData {
    return this.dialogDataState();
  }

  set dialogData(value: EventDetailsDialogData) {
    this.dialogDataState.set(value);
  }

  get dialogData(): EventDetailsDialogData {
    return this.dialogDataState();
  }

  layout = inject(LayoutService);
  private localSettings = inject(LocalSettingsService);
  private chroniaCalendar = inject(ChroniaCalendarService);
  private ethiopianCalendar = inject(EthiopianCalendarService);
  private eventRelaySources = inject(EventRelaySourcesService);
  showRawJson = signal(false);

  event = computed(() => this.dialogDataState().event);
  eventTags = computed(() => Array.isArray(this.event().tags) ? this.event().tags : []);

  // Event metadata
  eventId = computed(() => this.event().id);
  eventKind = computed(() => this.event().kind);
  eventPubkey = computed(() => this.event().pubkey);
  eventCreatedAt = computed(() => new Date(this.event().created_at * 1000));
  eventSignature = computed(() => this.event().sig);

  // Extract client information from tags
  clientInfo = computed(() => {
    const clientTag = this.eventTags().find(tag => tag[0] === standardizedTag.client);
    return clientTag ? clientTag[1] : null;
  });

  // Extract proof-of-work information
  proofOfWork = computed(() => {
    const nonceTag = this.eventTags().find(tag => tag[0] === standardizedTag.nonce);
    if (!nonceTag || nonceTag.length < 3) {
      return null;
    }

    return {
      nonce: nonceTag[1],
      difficulty: parseInt(nonceTag[2], 10) || 0
    };
  });

  // Extract mentioned accounts (p tags)
  mentionedAccounts = computed(() => {
    return this.eventTags()
      .filter(tag => tag[0] === 'p')
      .map(tag => ({
        pubkey: tag[1],
        relay: tag[2] || null,
        petname: tag[3] || null,
        npub: nip19.npubEncode(tag[1])
      }));
  });

  // Extract referenced events (e tags)
  referencedEvents = computed(() => {
    return this.eventTags()
      .filter(tag => tag[0] === 'e')
      .map(tag => ({
        eventId: tag[1],
        relay: tag[2] || null,
        marker: tag[3] || null,
        nevent: nip19.neventEncode({ id: tag[1] })
      }));
  });

  // Extract all other tags
  otherTags = computed(() => {
    const knownTags = ['p', 'e', standardizedTag.client, standardizedTag.nonce];
    return this.eventTags().filter(tag => !knownTags.includes(tag[0]));
  });

  // Raw JSON for the event
  eventJson = computed(() => JSON.stringify(this.event(), null, 2));

  relayUrls = computed(() => {
    const explicitRelayUrls = this.dialogDataState().relayUrls || [];
    if (explicitRelayUrls.length > 0) {
      return explicitRelayUrls;
    }

    return this.eventRelaySources.getRelayUrls(this.eventId());
  });

  close(): void {
    this.dialogRef?.close();
  }

  copyEventId(): void {
    this.layout.copyToClipboard(this.eventId(), 'hex');
  }

  copyNeventId(): void {
    this.layout.copyToClipboard(this.eventId(), 'nevent', this.eventPubkey(), this.eventKind());
  }

  copyPubkey(): void {
    this.layout.copyToClipboard(this.eventPubkey(), 'hex');
  }

  copyNpub(): void {
    this.layout.copyToClipboard(this.eventPubkey(), 'nprofile');
  }

  copyRawJson(): void {
    this.layout.copyToClipboard(this.event(), 'json');
  }

  toggleRawJson(): void {
    this.showRawJson.update(value => !value);
  }

  getKindDescription(kind: number): string {
    return getKindLabel(kind);
  }

  formatCreatedAt(): string {
    const date = this.eventCreatedAt();
    const calendarType = this.localSettings.calendarType();

    if (calendarType === 'chronia') {
      const chroniaDate = this.chroniaCalendar.fromDate(date);
      return this.chroniaCalendar.format(chroniaDate, 'full');
    }

    if (calendarType === 'ethiopian') {
      const ethiopianDate = this.ethiopianCalendar.fromDate(date);
      return this.ethiopianCalendar.format(ethiopianDate, 'full');
    }

    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    });
  }
}
