import { Component, effect, inject, OnInit, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatMenuModule } from '@angular/material/menu';
import { DatabaseService } from '../../services/database.service';
import { NostrService } from '../../services/nostr.service';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { LoggerService } from '../../services/logger.service';
import { ImageCacheService } from '../../services/image-cache.service';
import { AiService } from '../../services/ai.service';
import { NotificationService } from '../../services/notification.service';
import { ContentNotificationService } from '../../services/content-notification.service';
import { AccountLocalStateService } from '../../services/account-local-state.service';
import { AccountStateService } from '../../services/account-state.service';

export type CacheType = 'all' | 'events' | 'notifications' | 'messages' | 'relays' | 'images' | 'ai-models';

@Component({
  selector: 'app-storage-stats',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatMenuModule,
  ],
  templateUrl: './storage-stats.component.html',
  styleUrl: './storage-stats.component..scss',
})
export class StorageStatsComponent implements OnInit {
  private database = inject(DatabaseService);
  nostr = inject(NostrService);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);
  private imageCacheService = inject(ImageCacheService);
  private aiService = inject(AiService);
  private notificationService = inject(NotificationService);
  private contentNotificationService = inject(ContentNotificationService);
  private accountLocalState = inject(AccountLocalStateService);
  private accountState = inject(AccountStateService);

  isClearing = signal(false);
  stats = signal({
    relaysCount: 0,
    eventsCount: 0,
    estimatedSize: 0,
  });
  formattedSize = signal('0 KB');

  constructor() {
    // Update the formatted size when stats change
    effect(() => {
      const currentStats = this.stats();
      this.formattedSize.set(this.formatSize(currentStats.estimatedSize));
    });
  }

  ngOnInit(): void {
    this.refreshStats();
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  async refreshStats(): Promise<void> {
    try {
      const eventsCount = await this.database.countEvents();
      const relaysCount = await this.database.countObservedRelays();
      const storageEstimate = await this.database.getStorageEstimate();
      this.stats.set({
        relaysCount,
        eventsCount,
        estimatedSize: storageEstimate.usage || 0,
      });
    } catch (error) {
      this.logger.error('Error refreshing stats', error);
    }
  }

  async clearCache(cacheType: CacheType): Promise<void> {
    if (this.isClearing()) {
      return;
    }

    this.isClearing.set(true);

    try {
      let successMessage = 'Cache cleared successfully';

      switch (cacheType) {
        case 'all': {
          await this.database.clearAllData();
          await this.imageCacheService.clearAllCache();
          await this.aiService.clearAllCache();
          this.notificationService.clearNotifications();
          this.contentNotificationService.resetLastCheckTimestamp();
          // Reset messages last check timestamp
          const allPubkey = this.accountState.pubkey();
          if (allPubkey) {
            this.accountLocalState.setMessagesLastCheck(allPubkey, 0);
          }
          localStorage.removeItem('nostria-notification-filters');
          successMessage = 'All cache cleared successfully';
          break;
        }
        case 'events':
          await this.database.clearEvents();
          successMessage = 'Events cache cleared successfully';
          break;
        case 'notifications':
          await this.database.clearAllNotifications();
          this.notificationService.clearNotifications();
          this.contentNotificationService.resetLastCheckTimestamp();
          localStorage.removeItem('nostria-notification-filters');
          // Fetch fresh notifications from relays (limit to last 7 days)
          this.contentNotificationService.checkForNewNotifications(7).catch(error => {
            this.logger.error('Failed to fetch fresh notifications', error);
          });
          successMessage = 'Notifications cache cleared successfully';
          break;
        case 'messages': {
          await this.database.clearAllMessages();
          // Reset the messages last check timestamp so messages reload from the beginning
          const pubkey = this.accountState.pubkey();
          if (pubkey) {
            this.accountLocalState.setMessagesLastCheck(pubkey, 0);
          }
          successMessage = 'Messages cache cleared successfully';
          break;
        }
        case 'relays':
          await this.database.clearRelaysData();
          successMessage = 'Relays cache cleared successfully';
          break;
        case 'images':
          await this.imageCacheService.clearAllCache();
          successMessage = 'Image cache cleared successfully';
          break;
        case 'ai-models':
          await this.aiService.clearAllCache();
          successMessage = 'AI models cleared successfully';
          break;
      }

      await this.refreshStats();

      this.snackBar.open(successMessage, 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    } catch (error) {
      this.logger.error('Error clearing cache', error);

      this.snackBar.open('Failed to clear cache', 'Close', {
        duration: 3000,
        horizontalPosition: 'center',
        verticalPosition: 'bottom',
      });
    } finally {
      this.isClearing.set(false);
    }
  }
}
