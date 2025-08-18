import { effect, inject, Injectable } from '@angular/core';
import { MediaService } from './media.service';
import { AccountStateService } from './account-state.service';
import { NostriaService } from '../interfaces';
import { BadgeService } from './badge.service';
import { NotificationService } from './notification.service';
import { NostrService } from './nostr.service';
import { MessagingService } from './messaging.service';
import { DiscoveryRelayServiceEx } from './relays/discovery-relay';
import { AccountRelayServiceEx } from './relays/account-relay';

/** Service that handles changing account, will clear and load data in different services. */
@Injectable({
  providedIn: 'root',
})
export class StateService implements NostriaService {
  accountState = inject(AccountStateService);
  media = inject(MediaService);
  badge = inject(BadgeService);
  notification = inject(NotificationService);
  nostr = inject(NostrService);
  // relay = inject(RelayService);
  messaging = inject(MessagingService);
  discoveryRelay = inject(DiscoveryRelayServiceEx);
  accountRelay = inject(AccountRelayServiceEx);

  constructor() {
    effect(async () => {
      if (this.accountState.account()) {
        this.clear();
        await this.load();
      }
    });
  }

  async load() {
    const pubkey = this.accountState.pubkey();

    // This is never called for anonymous accounts.
    await this.discoveryRelay.load();
    await this.accountRelay.setAccount(pubkey);
    await this.accountState.load();

    this.accountState.loadSubscriptions();
    await this.nostr.load();

    // Load notifications from storage
    if (!this.notification.notificationsLoaded()) {
      await this.notification.loadNotifications();
    }

    await this.media.load();
  }

  clear() {
    this.accountState.clear();
    this.messaging.clear();
    this.nostr.clear();
    this.badge.clear();
    this.media.clear();
  }
}
