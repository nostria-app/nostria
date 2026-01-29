import { Component, inject, signal, effect, computed, OnInit, OnDestroy, input } from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
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
import { MigrationService, MigrationResult } from '../../../services/migration.service';
import { Subscription } from 'rxjs';

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
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    FormsModule,
    InfoTooltipComponent,
  ],
  templateUrl: './backup.component.html',
  styleUrl: './backup.component.scss',
  host: { class: 'panel-with-sticky-header' },
})
export class BackupComponent implements OnInit, OnDestroy {
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
  private readonly route = inject(ActivatedRoute);
  readonly migrationService = inject(MigrationService);

  // Input properties for migration (used when opened via RightPanelService)
  migrationRelays = input<string[]>();
  startMigration = input<boolean>();

  private routeSubscription: Subscription | null = null;

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

  // Migration signals
  showMigrationSection = signal(false);
  oldRelayUrls = signal<string[]>([]);
  manualRelayUrl = signal('');
  migrationDepth = signal<'basic' | 'extended' | 'deep'>('basic');
  migrationResults = signal<MigrationResult[]>([]);

  // Expose migration progress from service
  migrationProgress = computed(() => this.migrationService.progress());
  isMigrating = computed(() => this.migrationService.isRunning());
  migrationProgressPercent = computed(() => this.migrationService.progressPercent());

  constructor() {
    effect(async () => {
      if (this.app.initialized() && this.app.authenticated()) {
        await this.loadBackupStats();
      }
    });
  }

  ngOnInit(): void {
    // Check for migration inputs (from RightPanelService)
    const inputRelays = this.migrationRelays();
    if (this.startMigration() && inputRelays && inputRelays.length > 0) {
      this.oldRelayUrls.set(inputRelays);
      this.showMigrationSection.set(true);
      this.logger.info('Migration initiated from relays page (via inputs)', { relays: inputRelays });
      return; // Skip query params check if inputs are provided
    }

    // Fallback: Check for migration query params from relays page (for direct URL navigation)
    this.routeSubscription = this.route.queryParams.subscribe(params => {
      if (params['migration'] === 'true' && params['relays']) {
        try {
          const relays = JSON.parse(params['relays']);
          if (Array.isArray(relays) && relays.length > 0) {
            this.oldRelayUrls.set(relays);
            this.showMigrationSection.set(true);
            this.logger.info('Migration initiated from relays page (via query params)', { relays });
          }
        } catch (e) {
          this.logger.error('Failed to parse relay URLs from query params', e);
        }
      }
    });
  }

  ngOnDestroy(): void {
    if (this.routeSubscription) {
      this.routeSubscription.unsubscribe();
    }
    // Cancel any ongoing migration
    this.migrationService.cancel();
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

  // Migration methods

  toggleMigrationSection(): void {
    this.showMigrationSection.update(v => !v);
  }

  parseRelayUrl(url: string): string | null {
    let relayUrl = url.trim();
    if (!relayUrl) return null;

    // Add wss:// if no protocol specified
    if (!relayUrl.startsWith('wss://') && !relayUrl.startsWith('ws://')) {
      relayUrl = `wss://${relayUrl}`;
    }

    // Add trailing slash if just domain
    try {
      const parsedUrl = new URL(relayUrl);
      if (parsedUrl.pathname === '/') {
        relayUrl = relayUrl.endsWith('/') ? relayUrl : `${relayUrl}/`;
      }
      return relayUrl;
    } catch {
      return null;
    }
  }

  addManualRelay(): void {
    const url = this.parseRelayUrl(this.manualRelayUrl());
    if (!url) {
      this.showMessage('Please enter a valid relay URL');
      return;
    }

    // Check if already in list
    if (this.oldRelayUrls().includes(url)) {
      this.showMessage('This relay is already in the list');
      return;
    }

    this.oldRelayUrls.update(relays => [...relays, url]);
    this.manualRelayUrl.set('');
    this.showMessage('Relay added to migration list');
  }

  removeOldRelay(url: string): void {
    this.oldRelayUrls.update(relays => relays.filter(r => r !== url));
  }

  async migrateFromSingleRelay(relayUrl: string): Promise<void> {
    if (this.isMigrating()) {
      this.showMessage('Migration already in progress');
      return;
    }

    this.migrationResults.set([]);
    const result = await this.migrationService.migrateFromRelay(relayUrl, this.migrationDepth());
    this.migrationResults.set([result]);

    if (result.errors.length > 0) {
      this.showMessage(`Migration completed with ${result.errors.length} errors`, 5000);
    } else {
      this.showMessage(`Successfully migrated ${result.eventsPublished} events`);
    }

    // Refresh stats after migration
    await this.loadBackupStats();
  }

  async migrateFromAllRelays(): Promise<void> {
    if (this.isMigrating()) {
      this.showMessage('Migration already in progress');
      return;
    }

    const relays = this.oldRelayUrls();
    if (relays.length === 0) {
      this.showMessage('No relays to migrate from');
      return;
    }

    this.migrationResults.set([]);
    const results = await this.migrationService.migrateFromRelays(relays, this.migrationDepth());
    this.migrationResults.set(results);

    const totalPublished = results.reduce((sum, r) => sum + r.eventsPublished, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

    if (totalErrors > 0) {
      this.showMessage(`Migration completed: ${totalPublished} events migrated, ${totalErrors} errors`, 5000);
    } else {
      this.showMessage(`Successfully migrated ${totalPublished} events from ${relays.length} relays`);
    }

    // Refresh stats after migration
    await this.loadBackupStats();
  }

  cancelMigration(): void {
    this.migrationService.cancel();
    this.showMessage('Migration cancelled');
  }

  formatRelayUrl(url: string): string {
    return url.replace(/^wss:\/\//, '');
  }

  getKindDescription(kind: number): string {
    const descriptions: Record<number, string> = {
      1: 'Notes',
      6: 'Reposts',
      7: 'Reactions',
      16: 'Generic reposts',
      20: 'Pictures',
      21: 'Videos',
      22: 'Audio',
      1063: 'File metadata',
      1111: 'Comments',
      9802: 'Highlights',
      30023: 'Articles',
      30024: 'Draft articles',
      31922: 'Calendar events (date)',
      31923: 'Calendar events (time)',
      31924: 'Calendars',
      31925: 'RSVPs',
      10000: 'Mute list',
      10001: 'Pin list',
      30000: 'Follow sets',
      30001: 'Lists',
      30003: 'Bookmarks',
      30008: 'Profile badges',
      30009: 'Badge definitions',
      8: 'Badge awards',
      1984: 'Reports',
      9735: 'Zap receipts',
      30078: 'App data',
    };
    return descriptions[kind] || `Kind ${kind}`;
  }

  getDepthKinds(depth: 'basic' | 'extended' | 'deep'): number[] {
    return this.migrationService.getEventKinds(depth);
  }
}
