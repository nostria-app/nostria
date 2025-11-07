import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { type Event, nip19, kinds } from 'nostr-tools';
import { firstValueFrom } from 'rxjs';
import type { NostrRecord } from '../../../interfaces';
import { AccountStateService } from '../../../services/account-state.service';
import { DataService } from '../../../services/data.service';
import { NostrService } from '../../../services/nostr.service';
import {
  ConfirmDialogComponent,
  type ConfirmDialogData,
} from '../../confirm-dialog/confirm-dialog.component';
import {
  EventDetailsDialogComponent,
  type EventDetailsDialogData,
} from '../../event-details-dialog/event-details-dialog.component';
import { LayoutService } from '../../../services/layout.service';
import type { ReportTarget } from '../../../services/reporting.service';
import { CommonModule } from '@angular/common';
import { BookmarkService } from '../../../services/bookmark.service';
import { PinnedService } from '../../../services/pinned.service';
import { ProfileStateService } from '../../../services/profile-state.service';

@Component({
  selector: 'app-event-menu',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatDividerModule,
    MatMenuModule,
  ],
  templateUrl: './event-menu.component.html',
  styleUrl: './event-menu.component.scss',
})
export class EventMenuComponent {
  layout = inject(LayoutService);
  accountState = inject(AccountStateService);
  profileState = inject(ProfileStateService);
  dialog = inject(MatDialog);
  data = inject(DataService);
  nostrService = inject(NostrService);
  snackBar = inject(MatSnackBar);
  bookmark = inject(BookmarkService);
  pinned = inject(PinnedService);

  event = input.required<Event>();
  view = input<'icon' | 'full'>('icon');

  record = signal<NostrRecord | null>(null);

  isOurEvent = computed<boolean>(() => {
    const event = this.event();
    if (!event) {
      return false;
    }

    return event.pubkey === this.accountState.pubkey();
  });

  // Check if we're on our own profile page
  isOnOwnProfile = computed<boolean>(() => {
    const profilePubkey = this.profileState.pubkey();
    return profilePubkey === this.accountState.pubkey();
  });

  // Check if this is a kind:1 event (text note)
  isTextNote = computed<boolean>(() => {
    const event = this.event();
    return event?.kind === kinds.ShortTextNote;
  });

  // Check if pin/unpin options should be shown
  showPinOptions = computed<boolean>(() => {
    return this.isOnOwnProfile() && this.isTextNote() && this.isOurEvent();
  });

  onBookmarkClick(event: MouseEvent) {
    event.stopPropagation();
    const targetItem = this.record();
    if (targetItem) {
      this.bookmark.toggleBookmark(targetItem.event.id);
    }
  }

  eventLink = computed<string>(() => {
    const event = this.event();
    if (!event) {
      return '';
    }

    const neventId = nip19.neventEncode({
      id: event.id,
      author: event.pubkey,
    });

    // const url = new URL(window.location.href);
    const url = new URL('https://nostria.app/');

    url.search = '';
    url.pathname = `/e/${neventId}`;
    return url.toString();
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

  reportContent() {
    const event = this.event();
    if (!event) {
      return;
    }

    const reportTarget: ReportTarget = {
      type: 'content',
      pubkey: event.pubkey,
      eventId: event.id,
    };

    this.layout.showReportDialog(reportTarget);
  }

  async onPinClick(event: MouseEvent) {
    event.stopPropagation();
    const targetEvent = this.event();
    if (!targetEvent) {
      return;
    }

    if (this.pinned.isPinned(targetEvent.id)) {
      await this.pinned.unpinNote(targetEvent.id);
      this.snackBar.open('Note unpinned', 'Close', { duration: 3000 });
    } else {
      await this.pinned.pinNote(targetEvent.id);
      this.snackBar.open('Note pinned to profile', 'Close', { duration: 3000 });
    }
  }

  openEventDetails() {
    const event = this.event();
    if (!event) {
      return;
    }

    this.dialog.open(EventDetailsDialogComponent, {
      data: {
        event: event,
      } as EventDetailsDialogData,
      width: '80vw',
      maxWidth: '800px',
      maxHeight: '90vh',
    });
  }
}
