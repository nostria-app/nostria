import { Injectable, inject, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { ZapService, GiftPremiumData } from './zap.service';
import { AccountStateService } from './account-state.service';
import { LoggerService } from './logger.service';
import type { Event } from 'nostr-tools';

export interface GiftPremiumNotification {
  giftData: GiftPremiumData;
  amount: number | null;
  zapReceipt: Event;
  timestamp: number;
  sender: string | undefined;
  seen: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class GiftPremiumNotificationService {
  private zapService = inject(ZapService);
  private accountState = inject(AccountStateService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  // Signal for tracking gift premium notifications
  private notifications = signal<GiftPremiumNotification[]>([]);
  private isChecking = signal(false);

  // Public readonly signals
  readonly giftNotifications = this.notifications.asReadonly();
  readonly unreadCount = signal(0);

  /**
   * Check for new gift premium zaps when user logs in
   */
  async checkForGiftPremiumZaps(pubkey?: string): Promise<void> {
    if (this.isChecking()) {
      return;
    }

    const userPubkey = pubkey || this.accountState.pubkey();
    if (!userPubkey) {
      this.logger.warn('Cannot check for gift premium zaps: no user pubkey');
      return;
    }

    this.isChecking.set(true);

    try {
      this.logger.debug('Checking for gift premium zaps...');

      // Get gift premium zaps for the user
      const giftZaps = await this.zapService.getGiftPremiumZapsForUser(userPubkey);

      if (giftZaps.length === 0) {
        this.logger.debug('No gift premium zaps found');
        this.isChecking.set(false);
        return;
      }

      // Load seen status from storage
      const seenGifts = this.loadSeenGifts(userPubkey);

      // Create notifications
      const newNotifications: GiftPremiumNotification[] = giftZaps.map(gift => {
        const zapId = gift.zapReceipt.id;
        const seen = seenGifts.includes(zapId);

        // Extract sender pubkey from zap receipt
        const sender = this.extractSenderFromZapReceipt(gift.zapReceipt);

        return {
          giftData: gift.giftData,
          amount: gift.amount,
          zapReceipt: gift.zapReceipt,
          timestamp: gift.zapReceipt.created_at,
          sender,
          seen,
        };
      });

      // Sort by timestamp, newest first
      newNotifications.sort((a, b) => b.timestamp - a.timestamp);

      this.notifications.set(newNotifications);

      // Count unread
      const unread = newNotifications.filter(n => !n.seen).length;
      this.unreadCount.set(unread);

      // Show notification for the most recent unread gift
      if (unread > 0) {
        const latestGift = newNotifications.find(n => !n.seen);
        if (latestGift) {
          this.showGiftNotification(latestGift);
        }
      }

      this.logger.debug(`Found ${giftZaps.length} gift premium zaps, ${unread} unread`);
    } catch (error) {
      this.logger.error('Failed to check for gift premium zaps:', error);
    } finally {
      this.isChecking.set(false);
    }
  }

  /**
   * Mark a gift notification as seen
   */
  async markAsSeen(notification: GiftPremiumNotification): Promise<void> {
    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) {
      return;
    }

    try {
      notification.seen = true;

      // Update the notifications signal
      const updated = this.notifications().map(n =>
        n.zapReceipt.id === notification.zapReceipt.id ? { ...n, seen: true } : n
      );
      this.notifications.set(updated);

      // Update unread count
      const unread = updated.filter(n => !n.seen).length;
      this.unreadCount.set(unread);

      // Save to storage
      const seenGifts = this.loadSeenGifts(userPubkey);
      if (!seenGifts.includes(notification.zapReceipt.id)) {
        seenGifts.push(notification.zapReceipt.id);
        this.saveSeenGifts(userPubkey, seenGifts);
      }
    } catch (error) {
      this.logger.error('Failed to mark gift as seen:', error);
    }
  }

  /**
   * Mark all gift notifications as seen
   */
  async markAllAsSeen(): Promise<void> {
    const userPubkey = this.accountState.pubkey();
    if (!userPubkey) {
      return;
    }

    try {
      const updated = this.notifications().map(n => ({ ...n, seen: true }));
      this.notifications.set(updated);
      this.unreadCount.set(0);

      const allIds = updated.map(n => n.zapReceipt.id);
      this.saveSeenGifts(userPubkey, allIds);
    } catch (error) {
      this.logger.error('Failed to mark all gifts as seen:', error);
    }
  }

  /**
   * Show a snackbar notification for a received gift
   */
  private showGiftNotification(notification: GiftPremiumNotification): void {
    const subscriptionName =
      notification.giftData.subscription === 'premium' ? 'Premium' : 'Premium+';
    const duration =
      notification.giftData.duration === 1 ? '1 month' : `${notification.giftData.duration} months`;

    let message = `🎁 You received ${subscriptionName} for ${duration}!`;
    if (notification.giftData.message) {
      message += ` Message: "${notification.giftData.message}"`;
    }

    this.snackBar.open(message, 'View', {
      duration: 10000,
      horizontalPosition: 'center',
      verticalPosition: 'top',
    });
  }

  /**
   * Extract sender pubkey from zap receipt description
   */
  private extractSenderFromZapReceipt(zapReceipt: Event): string | undefined {
    try {
      const descriptionTags = zapReceipt.tags.filter(tag => tag[0] === 'description');
      if (descriptionTags.length === 1) {
        const zapRequest = JSON.parse(descriptionTags[0][1]);
        return zapRequest.pubkey;
      }
    } catch (error) {
      this.logger.warn('Failed to extract sender from zap receipt:', error);
    }
    return undefined;
  }

  /**
   * Load seen gift IDs from storage
   */
  private loadSeenGifts(pubkey: string): string[] {
    try {
      const key = `gift-premium-seen-${pubkey}`;
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      this.logger.warn('Failed to load seen gifts from storage:', error);
      return [];
    }
  }

  /**
   * Save seen gift IDs to storage
   */
  private saveSeenGifts(pubkey: string, seenIds: string[]): void {
    try {
      const key = `gift-premium-seen-${pubkey}`;
      localStorage.setItem(key, JSON.stringify(seenIds));
    } catch (error) {
      this.logger.error('Failed to save seen gifts to storage:', error);
    }
  }

  /**
   * Clear all notifications (e.g., on logout)
   */
  clearNotifications(): void {
    this.notifications.set([]);
    this.unreadCount.set(0);
  }
}
