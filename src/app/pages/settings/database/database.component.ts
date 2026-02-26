import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { DatabaseService } from '../../../services/database.service';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { ImageCacheService } from '../../../services/image-cache.service';
import { AiService } from '../../../services/ai.service';
import { NotificationService } from '../../../services/notification.service';
import { ContentNotificationService } from '../../../services/content-notification.service';
import { AccountLocalStateService } from '../../../services/account-local-state.service';
import { AccountStateService } from '../../../services/account-state.service';
import { ApplicationService } from '../../../services/application.service';
import { EmojiSetService } from '../../../services/emoji-set.service';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { RightPanelService } from '../../../services/right-panel.service';

interface StoreStats {
  storeName: string;
  count: number;
}

@Component({
  selector: 'app-database-settings',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatMenuModule,
    MatTooltipModule,
  ],
  templateUrl: './database.component.html',
  styleUrl: './database.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'panel-with-sticky-header' },
})
export class DatabaseSettingsComponent implements OnInit {
  private database = inject(DatabaseService);
  private nostr = inject(NostrService);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);
  private imageCacheService = inject(ImageCacheService);
  private aiService = inject(AiService);
  private notificationService = inject(NotificationService);
  private contentNotificationService = inject(ContentNotificationService);
  private accountLocalState = inject(AccountLocalStateService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private emojiSetService = inject(EmojiSetService);
  private dialog = inject(MatDialog);
  private rightPanel = inject(RightPanelService);

  isLoading = signal(false);
  isClearing = signal(false);

  // Overall storage
  totalSize = signal('0 KB');
  storageQuota = signal('0 KB');
  storagePercent = signal(0);

  // Shared database
  sharedDbName = signal('');
  sharedDbStats = signal<StoreStats[]>([]);
  sharedDbTotalRecords = signal(0);

  // Account database
  hasAccountDb = signal(false);
  accountDbName = signal('');
  accountDbPubkeyShort = signal('');
  accountDbStats = signal<StoreStats[]>([]);
  accountDbTotalRecords = signal(0);

  // All databases list
  allDatabases = signal<{ name: string; type: 'shared' | 'account' | 'legacy' }[]>([]);

  ngOnInit(): void {
    this.refreshStats();
  }

  goBack(): void {
    this.rightPanel.goBack();
  }

  formatStoreName(storeName: string): string {
    const nameMap: Record<string, string> = {
      events: 'Events',
      info: 'Info Records',
      relays: 'Relay Configs',
      notifications: 'Notifications',
      observedRelays: 'Observed Relays',
      pubkeyRelayMappings: 'Pubkey-Relay Mappings',
      badgeDefinitions: 'Badge Definitions',
      eventsCache: 'Feed Cache',
      messages: 'Messages',
    };
    return nameMap[storeName] || storeName;
  }

  formatStoreDescription(storeName: string, dbType: 'shared' | 'account'): string {
    const descriptions: Record<string, Record<string, string>> = {
      shared: {
        events: 'Profiles (kind 0), contacts (kind 3), relay lists (kind 10002)',
        relays: 'User relay configurations',
        observedRelays: 'Relay connection stats and NIP-11 info',
        pubkeyRelayMappings: 'Maps pubkeys to their known relays',
        badgeDefinitions: 'Badge definition events',
      },
      account: {
        events: 'Feed events, reactions, reposts, and other per-account events',
        info: 'Trust metrics, settings, and key-value data',
        notifications: 'Social notifications (reactions, zaps, replies)',
        eventsCache: 'Feed column cache (90-day retention)',
        messages: 'Decrypted direct messages (NIP-04/NIP-44)',
      },
    };
    return descriptions[dbType]?.[storeName] || '';
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  async refreshStats(): Promise<void> {
    this.isLoading.set(true);

    try {
      // Overall storage estimate
      const estimate = await this.database.getStorageEstimate();
      const usage = estimate.usage || 0;
      const quota = estimate.quota || 0;
      this.totalSize.set(this.formatSize(usage));
      this.storageQuota.set(this.formatSize(quota));
      this.storagePercent.set(quota > 0 ? Math.round((usage / quota) * 100) : 0);

      // Shared DB stats
      this.sharedDbName.set(this.database.getSharedDbName());
      const sharedStats = await this.database.getSharedDbStats();
      this.sharedDbStats.set(sharedStats);
      this.sharedDbTotalRecords.set(sharedStats.reduce((sum, s) => sum + s.count, 0));

      // Account DB stats
      const hasAccount = this.database.hasAccountDb();
      this.hasAccountDb.set(hasAccount);
      if (hasAccount) {
        this.accountDbName.set(this.database.getAccountDbName() || '');
        const pubkey = this.database.getAccountDbPubkey();
        this.accountDbPubkeyShort.set(pubkey ? pubkey.slice(0, 8) + '...' : '');
        const accountStats = await this.database.getAccountDbStats();
        this.accountDbStats.set(accountStats);
        this.accountDbTotalRecords.set(accountStats.reduce((sum, s) => sum + s.count, 0));
      }

      // All databases
      const allDbs = await this.database.listAllDatabases();
      this.allDatabases.set(allDbs);
    } catch (error) {
      this.logger.error('Error refreshing database stats', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  async clearSharedData(): Promise<void> {
    if (this.isClearing()) return;
    this.isClearing.set(true);

    try {
      await this.database.clearSharedData();
      await this.refreshStats();
      this.snackBar.open('Shared database cleared', 'Close', { duration: 3000 });
    } catch (error) {
      this.logger.error('Error clearing shared data', error);
      this.snackBar.open('Failed to clear shared database', 'Close', { duration: 3000 });
    } finally {
      this.isClearing.set(false);
    }
  }

  async clearAccountDataAction(): Promise<void> {
    if (this.isClearing()) return;
    this.isClearing.set(true);

    try {
      await this.database.clearAccountData();
      this.notificationService.clearNotifications();
      this.contentNotificationService.resetLastCheckTimestamp();
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        this.accountLocalState.setMessagesLastCheck(pubkey, 0);
      }
      await this.refreshStats();
      this.snackBar.open('Account database cleared', 'Close', { duration: 3000 });
    } catch (error) {
      this.logger.error('Error clearing account data', error);
      this.snackBar.open('Failed to clear account database', 'Close', { duration: 3000 });
    } finally {
      this.isClearing.set(false);
    }
  }

  async clearSpecificCache(cacheType: string): Promise<void> {
    if (this.isClearing()) return;
    this.isClearing.set(true);

    try {
      let message = 'Cache cleared';

      switch (cacheType) {
        case 'events':
          await this.database.clearEvents();
          message = 'Events cache cleared';
          break;
        case 'notifications':
          await this.database.clearAllNotifications();
          this.notificationService.clearNotifications();
          this.contentNotificationService.resetLastCheckTimestamp();
          localStorage.removeItem('nostria-notification-filters');
          this.contentNotificationService.checkForNewNotifications(7).catch(error => {
            this.logger.error('Failed to fetch fresh notifications', error);
          });
          message = 'Notifications cleared';
          break;
        case 'messages': {
          await this.database.clearAllMessages();
          const pubkey = this.accountState.pubkey();
          if (pubkey) {
            this.accountLocalState.setMessagesLastCheck(pubkey, 0);
          }
          message = 'Messages cleared';
          break;
        }
        case 'relays':
          await this.database.clearRelaysData();
          message = 'Relays data cleared';
          break;
        case 'images':
          await this.imageCacheService.clearAllCache();
          message = 'Image cache cleared';
          break;
        case 'ai-models':
          await this.aiService.clearAllCache();
          message = 'AI models deleted';
          break;
        case 'emoji':
          this.emojiSetService.clearAllCaches();
          message = 'Emoji cache cleared';
          break;
      }

      await this.refreshStats();
      this.snackBar.open(message, 'Close', { duration: 3000 });
    } catch (error) {
      this.logger.error('Error clearing cache', error);
      this.snackBar.open('Failed to clear cache', 'Close', { duration: 3000 });
    } finally {
      this.isClearing.set(false);
    }
  }

  async clearSpecificState(stateType: string): Promise<void> {
    if (this.isClearing()) return;
    this.isClearing.set(true);

    try {
      let message = 'State cleared';

      switch (stateType) {
        case 'notification-dismissals': {
          const pubkey = this.accountState.pubkey();
          if (!pubkey) {
            this.snackBar.open('No account state to clear', 'Close', { duration: 3000 });
            return;
          }
          this.accountLocalState.clearNotificationDismissals(pubkey);
          message = 'Notification dismissals cleared';
          break;
        }
      }

      this.snackBar.open(message, 'Close', { duration: 3000 });
    } catch (error) {
      this.logger.error('Error clearing state', error);
      this.snackBar.open('Failed to clear state', 'Close', { duration: 3000 });
    } finally {
      this.isClearing.set(false);
    }
  }

  async clearAllCache(): Promise<void> {
    if (this.isClearing()) return;
    this.isClearing.set(true);

    try {
      await this.database.clearAllData();
      await this.imageCacheService.clearAllCache();
      await this.aiService.clearAllCache();
      this.notificationService.clearNotifications();
      this.contentNotificationService.resetLastCheckTimestamp();
      const pubkey = this.accountState.pubkey();
      if (pubkey) {
        this.accountLocalState.setMessagesLastCheck(pubkey, 0);
      }
      localStorage.removeItem('nostria-notification-filters');
      this.app.reload();
    } catch (error) {
      this.logger.error('Error clearing all cache', error);
      this.snackBar.open('Failed to clear all cache', 'Close', { duration: 3000 });
      this.isClearing.set(false);
    }
  }

  wipeData(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Confirm Data Deletion',
        message: 'Are you sure you want to delete all app data? This action cannot be undone.',
        confirmButtonText: 'Delete All Data',
      },
    });

    dialogRef.afterClosed().subscribe(async confirmed => {
      if (confirmed) {
        await this.app.wipe();
      }
    });
  }
}
