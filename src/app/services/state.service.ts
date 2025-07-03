import { effect, inject, Injectable } from '@angular/core';
import { MediaService } from './media.service';
import { AccountStateService } from './account-state.service';
import { NostriaService } from '../interfaces';
import { BadgeService } from './badge.service';
import { NotificationService } from './notification.service';
import { NostrService } from './nostr.service';
import { RelayService } from './relay.service';
import { MessagingService } from './messaging.service';

/** Service that handles changing account, will clear and load data in different services. */
@Injectable({
  providedIn: 'root'
})
export class StateService implements NostriaService {
  accountState = inject(AccountStateService);
  media = inject(MediaService);
  badge = inject(BadgeService);
  notification = inject(NotificationService);
  nostr = inject(NostrService);
  relay = inject(RelayService);
  messaging = inject(MessagingService);

  constructor() {
    effect(async () => {
      if (this.accountState.account()) {
        this.clear();
        await this.load();
      }
    });
  }

  async load() {
    this.accountState.loadSubscriptions();
    await this.nostr.load();

    // Load notifications from storage
    if (!this.notification.notificationsLoaded()) {
      await this.notification.loadNotifications();
    }

    await this.media.load();
  }

  clear() {
    this.messaging.clear();
    this.nostr.clear();
    this.badge.clear();
    this.media.clear();
  }
}
