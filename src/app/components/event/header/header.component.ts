import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
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
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../confirm-dialog/confirm-dialog.component';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { EventMenuComponent } from '../event-menu/event-menu.component';

@Component({
  selector: 'app-event-header',
  standalone: true,
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatMenuModule,
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
  event = input.required<Event>();
  compact = input<boolean>(false);
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

  openEventAndStopPropagation(event: MouseEvent) {
    // Allow right-click (button 2) and middle-click (button 1) for "open in new tab"
    // Only handle left-click (button 0) for programmatic navigation
    if (event.button !== 0) {
      return;
    }

    const currentEvent = this.event();

    // Prevent default navigation for left-click so we can use router
    event.preventDefault();
    event.stopPropagation();

    // Always navigate to the event page - never open dialog from date link click
    // The dialog should only be opened when clicking the card itself (for kind 1 events)
    const url = this.eventUrl();
    this.router.navigate([url], { state: { event: currentEvent } });
  }

  navigateToEvent() {
    const currentEvent = this.event();
    const url = this.eventUrl();
    this.router.navigate([url], { state: { event: currentEvent } });
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
        this.snackBar.open('Note deletion was requested', 'Dismiss', {
          duration: 3000,
        });
      }
    }
  }
}
