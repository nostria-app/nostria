import { Component, inject, OnInit } from '@angular/core';
import { NostrService } from '../../services/nostr.service';
import { kinds } from 'nostr-tools';
import { NotificationService } from '../../services/notification.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { NotificationListComponent } from '../../components/notification-list/notification-list.component';

@Component({
  selector: 'app-notifications',
  standalone: true,
  imports: [
    NotificationListComponent,
  ],
  templateUrl: './notifications.component.html',
  styleUrls: ['./notifications.component.scss'],
})
export class NotificationsComponent implements OnInit {
  private notificationService = inject(NotificationService);
  private accountRelay = inject(AccountRelayService);
  private nostrService = inject(NostrService);

  async ngOnInit(): Promise<void> {
    await this.recordNotificationsView();
  }

  async recordNotificationsView(): Promise<void> {
    const tags = [['d', 'client:notifications:seen']];

    const unsignedEvent = this.nostrService.createEvent(kinds.Application, '', tags);
    const signedEvent = await this.nostrService.signEvent(unsignedEvent);

    // We don't want to show in notifications the app settings publishing.
    await this.accountRelay.publish(signedEvent);
  }
}
