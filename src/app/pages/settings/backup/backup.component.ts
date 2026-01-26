import { Component, inject, signal, effect, computed } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { DatabaseService } from '../../../services/database.service';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import JSZip from '@progress/jszip-esm';
import { ApplicationService } from '../../../services/application.service';
import { AccountStateService } from '../../../services/account-state.service';
import { kinds } from 'nostr-tools';
import { UtilitiesService } from '../../../services/utilities.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { InfoTooltipComponent } from '../../../components/info-tooltip/info-tooltip.component';
import { FollowingBackupService } from '../../../services/following-backup.service';
import { FollowingHistoryDialogComponent } from './following-history-dialog/following-history-dialog.component';
import { RightPanelService } from '../../../services/right-panel.service';
import { MatTooltipModule } from '@angular/material/tooltip';

interface BackupStats {
  eventsCount: number;
  relaysCount: number;
  totalSize: number;
  formattedSize: string;
}

@Component({
  selector: 'app-backup',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
    InfoTooltipComponent,
  ],
  templateUrl: './backup.component.html',
  styleUrl: './backup.component.scss',
})
export class BackupComponent {
  private database = inject(DatabaseService);
  private nostr = inject(NostrService);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);
  private app = inject(ApplicationService);
  private accountState = inject(AccountStateService);
  private readonly utilities = inject(UtilitiesService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly followingBackupService = inject(FollowingBackupService);
  private readonly dialog = inject(MatDialog);
  private readonly rightPanel = inject(RightPanelService);

  goBack(): void {
    this.rightPanel.goBack();
  }

  stats = signal<BackupStats>({
    eventsCount: 0,
    relaysCount: 0,
    totalSize: 0,
    formattedSize: '0 KB',
  });

  isSaving = signal<boolean>(false);
  isImporting = signal<boolean>(false);
  progress = signal<number>(0);
  importing = signal<boolean>(false);
  importProgress = signal<number>(0);
  fileInputRef: HTMLInputElement | null = null;

  // Following list backup signals
  followingBackupsCount = computed(() => this.followingBackupService.getBackups().length);
  currentFollowingCount = computed(() => this.accountState.followingList().length);

  constructor() {
    effect(async () => {
      if (this.app.initialized() && this.app.authenticated()) {
        await this.loadBackupStats();
      }
    });
  }

  async loadBackupStats(): Promise<void> {
    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) return;

      const userEvents = await this.database.getUserEvents(pubkey);
      // const userRelays = await this.database.getUserRelays(pubkey);

      // Estimate size by converting events to JSON and measuring string length
      // This is just an approximation
      const eventsJson = JSON.stringify(userEvents);
      const eventsSize = new Blob([eventsJson]).size;

      this.stats.set({
        eventsCount: userEvents.length,
        relaysCount: 0,
        // relaysCount: userRelays?.relays?.length || 0,
        totalSize: eventsSize,
        formattedSize: this.database.formatSize(eventsSize),
      });
    } catch (error) {
      this.logger.error('Error loading backup stats', error);
      this.showMessage('Failed to load backup statistics');
    }
  }

  async saveBackup(): Promise<void> {
    if (this.isSaving()) return;

    this.isSaving.set(true);
    this.progress.set(0);

    try {
      const pubkey = this.accountState.pubkey();
      if (!pubkey) {
        this.showMessage('No active user found');
        return;
      }

      // Fetch all user data
      const userEvents = await this.database.getUserEvents(pubkey);
      // const userRelays = await this.database.getUserRelays(pubkey);
      // const userMetadata = await this.database.getUserMetadata(pubkey);

      if (userEvents.length === 0) {
        this.showMessage('No events found to back up');
        this.isSaving.set(false);
        return;
      }

      // Create a JSON structure with all user data
      const backupData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        pubkey: pubkey,
        // metadata: userMetadata,
        // relays: userRelays,
        events: userEvents,
      };

      const zip = new JSZip();

      // Create a ZIP file containing the JSON data
      zip.file('backup.json', JSON.stringify(backupData, null, 2));

      // Generate the ZIP file
      const content = await zip.generateAsync(
        {
          type: 'blob',
          compression: 'DEFLATE',
          compressionOptions: { level: 9 },
        },
        metadata => {
          this.progress.set(metadata.percent);
        }
      );

      // Create and trigger download
      const url = URL.createObjectURL(content);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `nostria-backup-${timestamp}.zip`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this.showMessage('Backup saved successfully');
    } catch (error) {
      this.logger.error('Error saving backup', error);
      this.showMessage('Failed to save backup');
    } finally {
      this.isSaving.set(false);
    }
  }

  initiateImport(): void {
    // Create a file input element
    if (!this.fileInputRef) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.zip';
      input.addEventListener('change', this.handleFileSelection.bind(this));
      this.fileInputRef = input;
    }

    // Trigger file selection
    this.fileInputRef.click();
  }

  async handleFileSelection(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;

    if (!input.files || input.files.length === 0) {
      return;
    }

    const file = input.files[0];
    await this.importBackup(file);

    // Reset file input for future use
    input.value = '';
  }

  async importBackup(file: File): Promise<void> {
    if (this.isImporting()) return;

    this.isImporting.set(true);
    this.importProgress.set(0);

    try {
      // Read the zip file
      const zip = new JSZip();
      const zipData = await zip.loadAsync(file);

      // Find the backup.json file in the zip
      const backupFile = zipData.file('backup.json');

      if (!backupFile) {
        throw new Error('Invalid backup file format. Missing backup.json');
      }

      // Extract and parse the backup data
      const backupJsonStr = await backupFile.async('string');
      const backupData = JSON.parse(backupJsonStr);

      // Validate backup data
      if (!backupData.version || !backupData.pubkey || !Array.isArray(backupData.events)) {
        throw new Error('Invalid backup file format');
      }

      // Check if the backup is for the current user
      const currentPubkey = this.accountState.pubkey();
      if (backupData.pubkey !== currentPubkey) {
        this.showMessage('Warning: This backup is for a different user', 5000);
      }

      // Import the events
      const totalEvents = backupData.events.length;
      let importedCount = 0;

      for (const event of backupData.events) {
        await this.database.saveEvent(event);
        importedCount++;
        this.importProgress.set((importedCount / totalEvents) * 100);
      }

      const relayListEvent = await this.database.getEventByPubkeyAndKind(
        currentPubkey,
        kinds.RelayList
      );

      if (relayListEvent) {
        const relays = this.utilities.getRelayUrls(relayListEvent);

        for (const event of backupData.events) {
          await this.accountRelay.publishToRelay(event, relays);
        }
      }

      // Refresh stats
      await this.loadBackupStats();

      this.showMessage(`Successfully imported ${importedCount} events`);
    } catch (error) {
      this.logger.error('Error importing backup', error);
      this.showMessage(
        'Failed to import backup: ' + (error instanceof Error ? error.message : 'Unknown error')
      );
    } finally {
      this.isImporting.set(false);
    }
  }

  openFollowingHistory(): void {
    const dialogRef = this.dialog.open(FollowingHistoryDialogComponent, {
      width: '600px',
      maxWidth: '90vw',
    });

    // Dialog closed, no need to manually refresh as computed signals update automatically
    dialogRef.afterClosed().subscribe();
  }

  private showMessage(message: string, duration = 3000): void {
    this.snackBar.open(message, 'Close', {
      duration: duration,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
    });
  }
}
