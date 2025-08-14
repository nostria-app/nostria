import { Component, effect, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { StorageService } from '../../services/storage.service';

import { NostrService } from '../../services/nostr.service';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { LoggerService } from '../../services/logger.service';

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
  ],
  templateUrl: './storage-stats.component.html',
  styleUrl: './storage-stats.component..scss',
})
export class StorageStatsComponent {
  private storage = inject(StorageService);
  nostr = inject(NostrService);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);

  isClearing = signal(false);
  stats = signal({
    relaysCount: 0,
    // userMetadataCount: 0,
    // userRelaysCount: 0,
    estimatedSize: 0,
  });
  formattedSize = signal('0 KB');
  // isLoggedIn = signal(false);

  constructor() {
    // effect(async () => {
    //   if (this.storage.initialized()) {
    //     // Initialize stats
    //     await this.refreshStats();
    //   }
    // });

    // Keep logged in status updated
    // effect(() => {
    //   this.isLoggedIn.set(this.nostr.isLoggedIn());
    // });

    // Update the formatted size when stats change
    effect(() => {
      const currentStats = this.stats();
      this.formattedSize.set(
        this.storage.formatSize(currentStats.estimatedSize)
      );
    });
  }

  async refreshStats(): Promise<void> {
    await this.storage.updateStats();
    this.stats.set(this.storage.dbStats());
  }

  async clearCache(): Promise<void> {
    if (this.isClearing()) {
      return;
    }

    this.isClearing.set(true);

    try {
      await this.nostr.clearCache();
      await this.refreshStats();

      this.snackBar.open('Cache cleared successfully', 'Close', {
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
