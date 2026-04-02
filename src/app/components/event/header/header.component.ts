import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { LocalSettingsService } from '../../../services/local-settings.service';
import { PowService } from '../../../services/pow.service';
import { Event, nip19 } from 'nostr-tools';
import { EventPointer } from 'nostr-tools/nip19';
import { firstValueFrom } from 'rxjs';
import { NostrRecord } from '../../../interfaces';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { AccountStateService } from '../../../services/account-state.service';
import { DataService } from '../../../services/data.service';
import { LayoutService } from '../../../services/layout.service';
import { NostrService } from '../../../services/nostr.service';
import { EventService } from '../../../services/event';
import { LoggerService } from '../../../services/logger.service';
import { UserRelaysService } from '../../../services/relays/user-relays';
import { UtilitiesService } from '../../../services/utilities.service';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../confirm-dialog/confirm-dialog.component';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { EventMenuComponent } from '../event-menu/event-menu.component';
import { resolveClientLogo } from '../../../utils/client-logo-map';
import { DeleteEventService } from '../../../services/delete-event.service';

@Component({
  selector: 'app-event-header',
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatMenuModule,
    MatTooltipModule,
    UserProfileComponent,
    EventMenuComponent,
    AgoPipe,
    RouterLink,
  ],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EventHeaderComponent {
  readonly layout = inject(LayoutService);
  readonly router = inject(Router);
  accountState = inject(AccountStateService);
  dialog = inject(MatDialog);
  data = inject(DataService);
  nostrService = inject(NostrService);
  snackBar = inject(MatSnackBar);
  eventService = inject(EventService);
  utilities = inject(UtilitiesService);
  private logger = inject(LoggerService);
  private userRelaysService = inject(UserRelaysService);
  private powService = inject(PowService);
  private localSettings = inject(LocalSettingsService);
  private deleteEventService = inject(DeleteEventService);
  event = input.required<Event>();
  compact = input<boolean>(false);
  /** Whether this event has been edited (NIP-41) */
  isEdited = input<boolean>(false);
  /** Timestamp of the most recent edit (for tooltip) */
  editedAt = input<number | undefined>(undefined);
  record = signal<NostrRecord | null>(null);
  expirationTimestamp = computed<number | null>(() => {
    const event = this.event();
    return event ? this.utilities.getEventExpiration(event) : null;
  });

  hasExpiration = computed<boolean>(() => {
    const expirationTimestamp = this.expirationTimestamp();
    return expirationTimestamp !== null && expirationTimestamp > Math.floor(Date.now() / 1000);
  });

  publishedLabel = computed<string>(() => {
    const event = this.event();
    if (!event) {
      return '';
    }

    return this.utilities.getRelativeTime(event.created_at);
  });

  expirationLabel = computed<string>(() => {
    const expirationTimestamp = this.expirationTimestamp();
    if (expirationTimestamp === null || expirationTimestamp <= Math.floor(Date.now() / 1000)) {
      return '';
    }

    return `Expires in ${this.formatExpirationDistance(expirationTimestamp)}`;
  });

  hasPoW = computed<boolean>(() => {
    const event = this.event();
    return !!event?.tags?.some(tag => tag[0] === 'nonce');
  });

  powDifficulty = computed<number>(() => {
    if (!this.hasPoW()) return 0;
    return this.powService.countLeadingZeroBits(this.event().id);
  });

  powTooltip = computed<string>(() => {
    const difficulty = this.powDifficulty();
    const event = this.event();
    const nonceTag = event?.tags?.find(tag => tag[0] === 'nonce');
    const committed = nonceTag?.[2] ? parseInt(nonceTag[2], 10) || 0 : 0;
    const label = difficulty < 10 ? 'Minimal' : difficulty < 15 ? 'Low' : difficulty < 20 ? 'Moderate' : difficulty < 25 ? 'Strong' : difficulty < 30 ? 'Very Strong' : 'Extreme';
    if (committed > 0 && committed !== difficulty) {
      return `PoW: ${difficulty} bits (${label}) | Target: ${committed} bits`;
    }
    return `PoW: ${difficulty} bits (${label})`;
  });

  clientLogo = computed<string | null>(() => {
    if (!this.localSettings.showClientTag()) return null;
    const event = this.event();
    const clientTag = event?.tags?.find(tag => tag[0] === 'client' && tag[1]);
    return resolveClientLogo(clientTag?.[1]);
  });

  clientName = computed<string>(() => {
    const event = this.event();
    const clientTag = event?.tags?.find(tag => tag[0] === 'client' && tag[1]);
    const clientName = clientTag?.[1]?.trim() || '';
    return clientName.replace(/\b\w/g, char => char.toUpperCase());
  });

  isOurEvent = computed<boolean>(() => {
    const event = this.event();
    if (!event) {
      return false;
    }

    return event.pubkey === this.accountState.pubkey();
  });

  nevent = computed<string>(() => {
    const event = this.event();
    if (!event) {
      return '';
    }

    const relays = this.userRelaysService.getRelaysForPubkey(event.pubkey);
    const eventPointer: EventPointer = {
      id: event.id,
      author: event.pubkey,
      kind: event.kind,
      relays: relays.length > 0 ? relays : undefined,
    };
    try {
      return nip19.neventEncode(eventPointer);
    } catch (error) {
      debugger;
      this.logger.error('[EventHeader] Failed to encode nevent', {
        error,
        event,
        eventPointer,
        relayCount: relays.length,
      });
      throw error;
    }
  });

  eventUrl = computed<string>(() => {
    const event = this.event();
    if (!event) {
      return '#';
    }

    const neventId = this.nevent();
    // Generate the proper route based on event kind
    if (event.kind === 30023) { // LongFormArticle
      return `/a/${neventId}`;
    } else {
      return `/e/${neventId}`;
    }
  });

  constructor() {
    effect(() => {
      const event = this.event();

      if (!event) {
        return;
      }

      const record = this.data.toRecord(event);
      this.record.set(record);

      // Trigger relay discovery for author so nevent computed has relay hints
      this.userRelaysService.ensureRelaysForPubkey(event.pubkey);
    });
  }

  openEventWithNevent() {
    const neventId = this.nevent();
    if (!neventId) {
      return;
    }

    const event = this.event();
    this.layout.openEvent(neventId, event);
  }

  openEventAndStopPropagation(mouseEvent: MouseEvent) {
    // Allow right-click (button 2) and middle-click (button 1) for "open in new tab"
    // Only handle left-click (button 0) for programmatic navigation
    if (mouseEvent.button !== 0) {
      return;
    }

    const currentEvent = this.event();
    if (!currentEvent) return;

    // Prevent default navigation for left-click so we can use router
    mouseEvent.preventDefault();
    mouseEvent.stopPropagation();

    // Open event in right panel based on kind
    const neventId = this.nevent();
    if (currentEvent.kind === 30023) {
      this.layout.openArticle(neventId);
    } else {
      this.layout.openGenericEvent(neventId, currentEvent);
    }
  }

  navigateToEvent() {
    const currentEvent = this.event();
    if (!currentEvent) return;

    const neventId = this.nevent();
    if (currentEvent.kind === 30023) {
      // Open article in right panel
      this.layout.openArticle(neventId);
    } else {
      // Open event in right panel
      this.layout.openGenericEvent(neventId, currentEvent);
    }
  }

  async deleteEvent() {
    const event = this.event();
    if (!event) {
      return;
    }

    const confirmedDelete = await this.deleteEventService.confirmDeletion({
      event,
      title: 'Delete event',
      entityLabel: 'event',
      confirmText: 'Delete event',
    });
    if (confirmedDelete) {
      const deleteEvent = this.nostrService.createRetractionEventWithMode(event, confirmedDelete.referenceMode);

      const result = await this.nostrService.signAndPublish(deleteEvent);
      if (result.success) {
        // Delete from local database after successful deletion request
        // This ensures the user doesn't see the event cached locally
        await this.eventService.deleteEventFromLocalStorage(event.id);

        this.snackBar.open('Note deleted successfully', 'Dismiss', {
          duration: 3000,
        });
      }
    }
  }

  private formatExpirationDistance(expirationTimestamp: number): string {
    const diff = Math.max(0, expirationTimestamp - Math.floor(Date.now() / 1000));

    if (diff < 5) {
      return 'a few seconds';
    }

    const minute = 60;
    const hour = minute * 60;
    const day = hour * 24;
    const week = day * 7;
    const month = day * 30;
    const year = day * 365;

    if (diff < minute) {
      return `${Math.floor(diff)} seconds`;
    }

    if (diff < minute * 2) {
      return 'a minute';
    }

    if (diff < hour) {
      return `${Math.floor(diff / minute)} minutes`;
    }

    if (diff < hour * 2) {
      return 'an hour';
    }

    if (diff < day) {
      return `${Math.floor(diff / hour)} hours`;
    }

    if (diff < day * 2) {
      return 'a day';
    }

    if (diff < week) {
      return `${Math.floor(diff / day)} days`;
    }

    if (diff < week * 2) {
      return 'a week';
    }

    if (diff < month) {
      return `${Math.floor(diff / week)} weeks`;
    }

    if (diff < month * 2) {
      return 'a month';
    }

    if (diff < year) {
      return `${Math.floor(diff / month)} months`;
    }

    if (diff < year * 2) {
      return 'a year';
    }

    return `${Math.floor(diff / year)} years`;
  }
}
