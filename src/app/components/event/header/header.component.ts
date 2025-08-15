import {
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LayoutService } from '../../../services/layout.service';
import {
  PublishDialogComponent,
  PublishDialogData,
} from '../publish-dialog/publish-dialog.component';
import { Event } from 'nostr-tools';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { NostrRecord } from '../../../interfaces';
import { DataService } from '../../../services/data.service';
import { MatMenuModule } from '@angular/material/menu';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { DatePipe } from '@angular/common';
import { UserProfileComponent } from '../../user-profile/user-profile.component';
import { MatCardModule } from '@angular/material/card';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
} from '../../confirm-dialog/confirm-dialog.component';
import { NostrService } from '../../../services/nostr.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AccountStateService } from '../../../services/account-state.service';

@Component({
  selector: 'app-event-header',
  standalone: true,
  imports: [
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatDividerModule,
    MatMenuModule,
    UserProfileComponent,
    AgoPipe,
    DatePipe,
  ],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss'],
})
export class EventHeaderComponent {
  readonly layout = inject(LayoutService);
  accountState = inject(AccountStateService);
  dialog = inject(MatDialog);
  data = inject(DataService);
  nostrService = inject(NostrService);
  snackBar = inject(MatSnackBar);

  event = input.required<Event>();

  record = signal<NostrRecord | null>(null);

  isOurEvent = computed<boolean>(() => {
    const event = this.event();
    if (!event) {
      return false;
    }

    return event.pubkey === this.accountState.pubkey();
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

    dialogRef.afterClosed().subscribe(async result => {
      if (result) {
        const deleteEvent = this.nostrService.createRetractionEvent(event);

        const published = await this.nostrService.signAndPublish(deleteEvent);
        if (published) {
          this.snackBar.open('Note deletion was requested', 'Dismiss', {
            duration: 3000,
          });
        }
      }
    });
  }

  async publishEvent() {
    const event = this.event();
    if (!event) {
      return;
    }

    const dialogData: PublishDialogData = {
      event,
    };

    this.dialog.open(PublishDialogComponent, {
      data: dialogData,
      width: '600px',
      disableClose: false,
    });
  }
}
