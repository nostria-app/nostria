import { Component, inject, input, signal, effect } from '@angular/core';
import { DataService } from '../../services/data.service';
import { Event } from 'nostr-tools';
import { NostrRecord } from '../../interfaces';
import { UserProfileComponent } from "../user-profile/user-profile.component";
import { LayoutService } from '../../services/layout.service';
import { ContentComponent } from '../content/content.component';
import { AgoPipe } from '../../pipes/ago.pipe';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { AccountRelayService } from '../../services/account-relay.service';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { PublishDialogComponent, PublishDialogData } from './publish-dialog/publish-dialog.component';
import { ApplicationService } from '../../services/application.service';

@Component({
  selector: 'app-event',
  imports: [
    UserProfileComponent,
    ContentComponent,
    AgoPipe,
    MatTooltipModule,
    DatePipe,
    MatDividerModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule],
  templateUrl: './event.component.html',
  styleUrl: './event.component.scss'
})
export class EventComponent {
  id = input<string | null | undefined>();
  type = input<'e' | 'a' | 'r' | 't'>('e');
  event = input<Event | null | undefined>(null);
  data = inject(DataService); record = signal<NostrRecord | null>(null);
  layout = inject(LayoutService);
  accountRelayService = inject(AccountRelayService);
  dialog = inject(MatDialog);
  app = inject(ApplicationService);

  constructor() {
    effect(() => {
      const event = this.event();

      if (!event) {
        return;
      }

      const record = this.data.toRecord(event);
      this.record.set(record);
    });

    effect(async () => {
      if (this.app.initialized()) {
        const eventId = this.id();
        const type = this.type();

        if (!eventId || !type) {
          return;
        }

        if (type === 'e' || type === 'a') {
          if (eventId) {
            const eventData = await this.data.getEventById(eventId);
            this.record.set(eventData);
            console.log('RECORD:', this.record());
          }
        };
      }
    });
  }

  openEvent(): void {
    const id = this.id();
    const type = this.type();

    if (!id) {
      return;
    }

    if (type === 'r') {
      window.open(id, '_blank');
    } else if (type === 'e') {
      this.layout.openEvent(id, this.record()?.event);
    } else if (type === 'a') {
      this.layout.openArticle(id, this.record()?.event);
    }
  }
  async publishEvent() {
    const event = this.record()?.event;
    if (!event) {
      return;
    }

    const dialogData: PublishDialogData = {
      event: event
    };

    this.dialog.open(PublishDialogComponent, {
      data: dialogData,
      width: '600px',
      disableClose: false
    });
  }
}
