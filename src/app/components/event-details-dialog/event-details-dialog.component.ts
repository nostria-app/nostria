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
import { ChroniaCalendarService } from '../../services/chronia-calendar.service';
import { EthiopianCalendarService } from '../../services/ethiopian-calendar.service';

export interface EventDetailsDialogData {
  event: Event;
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
  dialogData: EventDetailsDialogData = { event: {} as Event };

  layout = inject(LayoutService);
  private localSettings = inject(LocalSettingsService);
  private chroniaCalendar = inject(ChroniaCalendarService);
  private ethiopianCalendar = inject(EthiopianCalendarService);
  showRawJson = signal(false);

  event = computed(() => this.dialogData.event);

  // Event metadata
  eventId = computed(() => this.event().id);
  eventKind = computed(() => this.event().kind);
  eventPubkey = computed(() => this.event().pubkey);
  eventCreatedAt = computed(() => new Date(this.event().created_at * 1000));
  eventSignature = computed(() => this.event().sig);

  // Extract client information from tags
  clientInfo = computed(() => {
    const event = this.event();
    const clientTag = event.tags.find(tag => tag[0] === standardizedTag.client);
    return clientTag ? clientTag[1] : null;
  });

  // Extract proof-of-work information
  proofOfWork = computed(() => {
    const event = this.event();
    const nonceTag = event.tags.find(tag => tag[0] === standardizedTag.nonce);
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
    const event = this.event();
    return event.tags
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
    const event = this.event();
    return event.tags
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
    const event = this.event();
    const knownTags = ['p', 'e', standardizedTag.client, standardizedTag.nonce];
    return event.tags.filter(tag => !knownTags.includes(tag[0]));
  });

  // Raw JSON for the event
  eventJson = computed(() => JSON.stringify(this.event(), null, 2));

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
    const kindDescriptions: Record<number, string> = {
      0: 'User Metadata',
      1: 'Short Text Note',
      2: 'Relay Recommendation',
      3: 'Contacts',
      4: 'Encrypted Direct Message',
      5: 'Event Deletion',
      6: 'Repost',
      7: 'Reaction',
      8: 'Badge Award',
      9: 'Group Chat Message',
      10: 'Group Chat Thread Reply',
      11: 'Group Thread',
      12: 'Group Thread Reply',
      40: 'Channel Creation',
      41: 'Channel Metadata',
      42: 'Channel Message',
      43: 'Channel Hide Message',
      44: 'Channel Mute User',
      1063: 'File Metadata',
      1311: 'Live Chat Message',
      1040: 'OpenTimestamps',
      9734: 'Zap Request',
      9735: 'Zap',
      10000: 'Mute List',
      10001: 'Pin List',
      10002: 'Relay List Metadata',
      30000: 'Categorized People List',
      30001: 'Categorized Bookmark List',
      30008: 'Profile Badges',
      30009: 'Badge Definition',
      30017: 'Create or update a stall',
      30018: 'Create or update a product',
      30023: 'Long-form Content',
      30024: 'Draft Long-form Content',
      30078: 'Application-specific Data',
      30311: 'Live Event',
      30315: 'User Statuses',
      30402: 'Classified Listing',
      30403: 'Draft Classified Listing',
      31989: 'App Recommendation',
      31990: 'App Handler',
      34235: 'Video Event'
    };

    return kindDescriptions[kind] || `Unknown Kind (${kind})`;
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