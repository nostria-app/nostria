import {
  Component,
  effect,
  inject,
  signal,
  computed,
  untracked,
} from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Event, nip19 } from 'nostr-tools';

import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import { LayoutService } from '../../services/layout.service';
import { ZapService } from '../../services/zap.service';
import { DataService } from '../../services/data.service';
import { LoggerService } from '../../services/logger.service';
import { UtilitiesService } from '../../services/utilities.service';
import { RightPanelService } from '../../services/right-panel.service';
import { PanelNavigationService } from '../../services/panel-navigation.service';
import { ApplicationService } from '../../services/application.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { NostrRecord } from '../../interfaces';

import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { EventComponent } from '../../components/event/event.component';
import { AgoPipe } from '../../pipes/ago.pipe';

@Component({
  selector: 'app-zap-detail',
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    UserProfileComponent,
    EventComponent,
    AgoPipe,
  ],
  templateUrl: './zap-detail.component.html',
  styleUrl: './zap-detail.component.scss',
})
export class ZapDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private layout = inject(LayoutService);
  private zapService = inject(ZapService);
  private dataService = inject(DataService);
  private logger = inject(LoggerService);
  private utilities = inject(UtilitiesService);
  private rightPanel = inject(RightPanelService);
  private panelNav = inject(PanelNavigationService);
  private app = inject(ApplicationService);
  private accountRelay = inject(AccountRelayService);

  private routeParams = toSignal(this.route.paramMap);

  // State signals
  isLoading = signal(true);
  error = signal<string | null>(null);

  // Zap data
  zapReceipt = signal<Event | null>(null);
  zapAmount = signal<number | null>(null);
  zapComment = signal<string>('');
  zapTimestamp = signal<number | null>(null);

  // Sender (who sent the zap)
  senderPubkey = signal<string | null>(null);
  senderProfile = signal<NostrRecord | null>(null);

  // Recipient (who received the zap)
  recipientPubkey = signal<string | null>(null);
  recipientProfile = signal<NostrRecord | null>(null);

  // Zapped event (if this is an event zap, not a profile zap)
  zappedEventId = signal<string | null>(null);
  zappedEvent = signal<Event | null>(null);
  isProfileZap = computed(() => !this.zappedEventId());

  // Detect if rendered in right panel
  isInRightPanel = computed(() => this.route.outlet === 'right');

  constructor() {
    // Load zap when route params change
    effect(() => {
      if (this.app.initialized() && this.routeParams()) {
        untracked(async () => {
          const id = this.routeParams()?.get('id');
          if (id) {
            await this.loadZap(id);
          }
        });
      }
    });
  }

  /**
   * Load zap receipt by ID (nevent or hex)
   */
  async loadZap(zapId: string): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      // Decode the zap receipt ID
      let eventId = zapId;
      let relayHints: string[] = [];

      if (!this.utilities.isHex(zapId)) {
        const decoded = this.utilities.decode(zapId);
        if (decoded.type === 'nevent') {
          eventId = decoded.data.id;
          relayHints = decoded.data.relays || [];
        } else if (decoded.type === 'note') {
          eventId = decoded.data;
        } else {
          throw new Error('Invalid zap receipt ID format');
        }
      }

      this.logger.debug('Loading zap receipt:', eventId);

      // Fetch the zap receipt event (kind 9735)
      const zapReceipts = await this.accountRelay.getMany({
        ids: [eventId],
        kinds: [9735],
      });

      if (zapReceipts.length === 0) {
        throw new Error('Zap receipt not found');
      }

      const receipt = zapReceipts[0];
      this.zapReceipt.set(receipt);
      this.zapTimestamp.set(receipt.created_at);

      // Parse the zap receipt to get details
      const parsed = this.zapService.parseZapReceipt(receipt);
      this.zapAmount.set(parsed.amount);
      this.zapComment.set(parsed.comment);

      // Extract sender pubkey from the zap request
      if (parsed.zapRequest) {
        this.senderPubkey.set(parsed.zapRequest.pubkey);
      }

      // Extract recipient pubkey from 'p' tag
      const pTag = receipt.tags.find(t => t[0] === 'p');
      if (pTag && pTag[1]) {
        this.recipientPubkey.set(pTag[1]);
      }

      // Extract zapped event ID from 'e' tag (if present)
      const eTag = receipt.tags.find(t => t[0] === 'e');
      if (eTag && eTag[1]) {
        this.zappedEventId.set(eTag[1]);
      }

      // Load profiles and zapped event in parallel
      await this.loadAdditionalData();

      this.logger.info('Successfully loaded zap receipt:', eventId);
    } catch (err) {
      this.logger.error('Error loading zap receipt:', err);
      this.error.set(err instanceof Error ? err.message : 'Failed to load zap');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Load sender/recipient profiles and zapped event
   */
  private async loadAdditionalData(): Promise<void> {
    const promises: Promise<void>[] = [];

    // Load sender profile
    const sender = this.senderPubkey();
    if (sender) {
      promises.push(
        this.dataService.getProfile(sender).then(profile => {
          if (profile) {
            this.senderProfile.set(profile);
          }
        }).catch(err => {
          this.logger.warn('Failed to load sender profile:', err);
        })
      );
    }

    // Load recipient profile
    const recipient = this.recipientPubkey();
    if (recipient) {
      promises.push(
        this.dataService.getProfile(recipient).then(profile => {
          if (profile) {
            this.recipientProfile.set(profile);
          }
        }).catch(err => {
          this.logger.warn('Failed to load recipient profile:', err);
        })
      );
    }

    // Load zapped event
    const zappedId = this.zappedEventId();
    if (zappedId) {
      promises.push(
        this.accountRelay.getMany({
          ids: [zappedId],
          kinds: [1, 6, 7, 30023], // Common event kinds
        }).then(events => {
          if (events.length > 0) {
            this.zappedEvent.set(events[0]);
          }
        }).catch(err => {
          this.logger.warn('Failed to load zapped event:', err);
        })
      );
    }

    await Promise.all(promises);
  }

  /**
   * Navigate back
   */
  goBack(): void {
    // First check RightPanelService (for programmatic component-based panels)
    if (this.rightPanel.canGoBack()) {
      this.rightPanel.goBack();
      return;
    }

    // If in right panel outlet, use panel navigation
    if (this.isInRightPanel()) {
      this.panelNav.goBackRight();
      return;
    }

    // In primary outlet - check if there's left panel history to go back to
    if (this.panelNav.canGoBackLeft()) {
      this.panelNav.goBackLeft();
    } else {
      // No history - navigate to notifications as the default
      this.router.navigate(['/notifications']);
    }
  }

  /**
   * Open sender profile
   */
  openSenderProfile(): void {
    const pubkey = this.senderPubkey();
    if (pubkey) {
      this.layout.openProfile(pubkey);
    }
  }

  /**
   * Open recipient profile
   */
  openRecipientProfile(): void {
    const pubkey = this.recipientPubkey();
    if (pubkey) {
      this.layout.openProfile(pubkey);
    }
  }

  /**
   * Open the zapped event
   */
  openZappedEvent(): void {
    const event = this.zappedEvent();
    const eventId = this.zappedEventId();
    if (event && eventId) {
      this.layout.openEvent(eventId, event);
    }
  }

  /**
   * Format sats for display
   */
  formatSats(amount: number | null): string {
    if (amount === null) return '?';
    return amount.toLocaleString();
  }
}
