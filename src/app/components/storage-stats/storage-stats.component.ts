import { Component, effect, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { DatabaseService } from '../../services/database.service';
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
  private database = inject(DatabaseService);
  nostr = inject(NostrService);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);

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

  private formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  async refreshStats(): Promise<void> {
    try {
      const eventsCount = await this.database.countEvents();
      const storageEstimate = await this.database.getStorageEstimate();
      this.stats.set({
        relaysCount: 0, // Relays are managed separately
        eventsCount,
        estimatedSize: storageEstimate.usage || 0,
      });
    } catch (error) {
      this.logger.error('Error refreshing stats', error);
    }
  }

  async clearCache(): Promise<void> {
    if (this.isClearing()) {
      return;
    }

    this.isClearing.set(true);

    try {
      await this.database.clearEvents();
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
