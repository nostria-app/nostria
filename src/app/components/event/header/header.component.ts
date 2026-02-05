import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Event, nip19 } from 'nostr-tools';
import { EventPointer } from 'nostr-tools/nip19';
import { firstValueFrom } from 'rxjs';
import { NostrRecord } from '../../../interfaces';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { TimestampPipe } from '../../../pipes/timestamp.pipe';
import { AccountStateService } from '../../../services/account-state.service';
import { DataService } from '../../../services/data.service';
import { LayoutService } from '../../../services/layout.service';
import { NostrService } from '../../../services/nostr.service';
import { EventService } from '../../../services/event';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../confirm-dialog/confirm-dialog.component';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { EventMenuComponent } from '../event-menu/event-menu.component';

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
    TimestampPipe,
    RouterLink,
  ],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
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
  event = input.required<Event>();
  compact = input<boolean>(false);
  /** Whether this event has been edited (NIP-41) */
  isEdited = input<boolean>(false);
  /** Timestamp of the most recent edit (for tooltip) */
  editedAt = input<number | undefined>(undefined);
  record = signal<NostrRecord | null>(null);

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

    const eventPointer: EventPointer = {
      id: event.id,
      author: event.pubkey,
    };
    return nip19.neventEncode(eventPointer);
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

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete event',
        message: 'Are you sure?',
        confirmText: 'Delete event',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      } as ConfirmDialogData,
    });

    const confirmedDelete = await firstValueFrom(dialogRef.afterClosed());
    if (confirmedDelete) {
      const deleteEvent = this.nostrService.createRetractionEvent(event);

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
}
