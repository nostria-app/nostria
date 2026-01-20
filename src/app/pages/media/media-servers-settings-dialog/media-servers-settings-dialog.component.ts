import { Component, inject, signal, output, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { CustomDialogComponent } from '../../../components/custom-dialog/custom-dialog.component';
import { MediaService } from '../../../services/media.service';
import { LoggerService } from '../../../services/logger.service';
import { AccountRelayService } from '../../../services/relays/account-relay';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmDialogComponent } from '../../../components/confirm-dialog/confirm-dialog.component';
import { RelayPingResultsDialogComponent } from '../../settings/relays/relay-ping-results-dialog.component';

// Suggested media servers
const SUGGESTED_SERVERS = [
  { name: 'Nostria (Europe)', url: 'https://mibo.eu.nostria.app/' },
  { name: 'Nostria (USA)', url: 'https://mibo.us.nostria.app/' },
  { name: 'Blossom Band', url: 'https://blossom.band/' },
  { name: 'Primal', url: 'https://blossom.primal.net/' },
  { name: 'F7Z', url: 'https://blossom.f7z.io/' },
];

// Nostria media server regions for auto-detection
const NOSTRIA_MEDIA_REGIONS = [
  { id: 'eu', name: 'Europe', mediaServer: 'https://mibo.eu.nostria.app' },
  { id: 'us', name: 'North America', mediaServer: 'https://mibo.us.nostria.app' },
];

@Component({
  selector: 'app-media-servers-settings-dialog',
  imports: [
    CustomDialogComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    MatSnackBarModule,
    MatCardModule,
    MatTooltipModule,
    FormsModule,
    DragDropModule,
  ],
  templateUrl: './media-servers-settings-dialog.component.html',
  styleUrl: './media-servers-settings-dialog.component.scss',
})
export class MediaServersSettingsDialogComponent implements OnInit {
  closed = output<{ saved: boolean } | null>();

  mediaService = inject(MediaService);
  private logger = inject(LoggerService);
  private snackBar = inject(MatSnackBar);
  private accountRelay = inject(AccountRelayService);
  private dialog = inject(MatDialog);

  // State
  isLoading = signal(true);
  isSaving = signal(false);
  isSettingUp = signal(false);
  testingServer = signal<string | null>(null);
  testResults = signal<Map<string, { success: boolean; message: string }>>(new Map());

  // Editable server list (local copy)
  servers = signal<string[]>([]);
  newServerUrl = signal('');

  // Suggested servers
  suggestedServers = SUGGESTED_SERVERS;

  ngOnInit(): void {
    this.loadServers();
  }

  private async loadServers(): Promise<void> {
    try {
      // Load servers from media service
      const currentServers = this.mediaService.mediaServers();
      this.servers.set([...currentServers]);
    } catch (error) {
      this.logger.error('Error loading media servers:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Normalizes a media server URL
   */
  private normalizeUrl(url: string): string | null {
    if (!url) return null;

    let normalized = url.trim();

    // Auto-prefix with https:// if no protocol
    if (!normalized.match(/^https?:\/\//i)) {
      normalized = `https://${normalized}`;
    }

    // Ensure trailing slash if it's a root URL
    try {
      const urlObj = new URL(normalized);
      if (urlObj.pathname === '' || urlObj.pathname === '/') {
        urlObj.pathname = '/';
        normalized = urlObj.toString();
      }
      return normalized;
    } catch {
      return null;
    }
  }

  addServer(): void {
    const url = this.normalizeUrl(this.newServerUrl().trim());
    if (!url) {
      this.snackBar.open('Please enter a valid server URL', 'Dismiss', { duration: 3000 });
      return;
    }

    if (this.servers().includes(url)) {
      this.snackBar.open('This server is already in the list', 'Dismiss', { duration: 3000 });
      return;
    }

    this.servers.update(servers => [...servers, url]);
    this.newServerUrl.set('');
  }

  removeServer(server: string): void {
    this.servers.update(servers => servers.filter(s => s !== server));
    // Clear test result for removed server
    this.testResults.update(results => {
      const newResults = new Map(results);
      newResults.delete(server);
      return newResults;
    });
  }

  addSuggestedServer(url: string): void {
    const normalizedUrl = this.normalizeUrl(url);
    if (normalizedUrl && !this.servers().includes(normalizedUrl)) {
      this.servers.update(servers => [...servers, normalizedUrl]);
    }
  }

  reorderServers(event: CdkDragDrop<string[]>): void {
    if (event.previousIndex === event.currentIndex) return;

    const newOrder = [...this.servers()];
    moveItemInArray(newOrder, event.previousIndex, event.currentIndex);
    this.servers.set(newOrder);
  }

  async testServer(url: string): Promise<void> {
    this.testingServer.set(url);

    try {
      const startTime = performance.now();
      const response = await fetch(url, { method: 'HEAD' });
      const pingTime = Math.round(performance.now() - startTime);

      if (response.ok) {
        this.testResults.update(results => {
          const newResults = new Map(results);
          newResults.set(url, { success: true, message: `Connected (${pingTime}ms)` });
          return newResults;
        });
      } else {
        this.testResults.update(results => {
          const newResults = new Map(results);
          newResults.set(url, { success: false, message: `Error: ${response.status}` });
          return newResults;
        });
      }
    } catch {
      this.testResults.update(results => {
        const newResults = new Map(results);
        newResults.set(url, { success: false, message: 'Connection failed' });
        return newResults;
      });
    } finally {
      this.testingServer.set(null);
    }
  }

  /**
   * Quick setup for Nostria media server with region detection
   */
  async quickSetup(): Promise<void> {
    this.isSettingUp.set(true);

    try {
      // Get user's account relays to detect region
      const userRelays = this.accountRelay.getRelayUrls();

      // Try to detect user's region from their relays
      let detectedRegion: typeof NOSTRIA_MEDIA_REGIONS[0] | null = null;

      for (const relay of userRelays) {
        for (const region of NOSTRIA_MEDIA_REGIONS) {
          if (relay.includes(`.${region.id}.nostria.app`)) {
            detectedRegion = region;
            break;
          }
        }
        if (detectedRegion) break;
      }

      if (detectedRegion) {
        // Region detected - confirm with user
        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: 'Add Nostria Media Server',
            message: `We detected you're using the ${detectedRegion.name} region. Would you like to add the ${detectedRegion.name} Nostria media server?`,
            confirmText: 'Add Server',
            cancelText: 'Cancel',
            confirmColor: 'primary',
          },
        });

        const confirmed = await dialogRef.afterClosed().toPromise();
        if (confirmed) {
          const normalizedUrl = this.normalizeUrl(detectedRegion.mediaServer);
          if (normalizedUrl && !this.servers().includes(normalizedUrl)) {
            this.servers.update(servers => [...servers, normalizedUrl]);
            this.snackBar.open(`Added ${detectedRegion.name} Nostria media server`, 'Close', { duration: 3000 });
          }
        }
      } else {
        // No region detected - ping all and let user choose
        this.snackBar.open('Checking Nostria media server regions...', 'Close', { duration: 2000 });

        const pingResults = await Promise.allSettled(
          NOSTRIA_MEDIA_REGIONS.map(async region => {
            const pingTime = await this.checkServerPing(region.mediaServer);
            return {
              region: region.name,
              regionId: region.id,
              mediaServer: region.mediaServer,
              pingTime,
            };
          })
        );

        const successfulPings = pingResults
          .filter((result): result is PromiseFulfilledResult<{
            region: string;
            regionId: string;
            mediaServer: string;
            pingTime: number;
          }> => result.status === 'fulfilled')
          .map(result => result.value)
          .sort((a, b) => a.pingTime - b.pingTime);

        if (successfulPings.length === 0) {
          this.snackBar.open('No reachable Nostria media servers found', 'Close', { duration: 3000 });
          return;
        }

        // Show dialog with results
        const dialogResults = successfulPings.map(result => ({
          url: `${result.region} (${result.mediaServer})`,
          pingTime: result.pingTime,
          isAlreadyAdded: this.servers().includes(this.normalizeUrl(result.mediaServer) || ''),
          regionData: result,
        }));

        const dialogRef = this.dialog.open(RelayPingResultsDialogComponent, {
          width: '500px',
          data: { results: dialogResults },
        });

        dialogRef.afterClosed().subscribe(result => {
          if (result?.selected) {
            const selectedRegion = result.selected.regionData;
            const normalizedUrl = this.normalizeUrl(selectedRegion.mediaServer);
            if (normalizedUrl && !this.servers().includes(normalizedUrl)) {
              this.servers.update(servers => [...servers, normalizedUrl]);
              this.snackBar.open(
                `Added ${selectedRegion.region} Nostria media server (${selectedRegion.pingTime}ms latency)`,
                'Close',
                { duration: 3000 }
              );
            }
          }
        });
      }
    } catch (error) {
      this.logger.error('Error during quick setup:', error);
      this.snackBar.open('Error during setup. Please try again.', 'Close', { duration: 3000 });
    } finally {
      this.isSettingUp.set(false);
    }
  }

  private async checkServerPing(serverUrl: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const startTime = performance.now();
      const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

      fetch(serverUrl, { method: 'HEAD' })
        .then(() => {
          clearTimeout(timeout);
          resolve(Math.round(performance.now() - startTime));
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  async saveServers(): Promise<void> {
    if (this.servers().length === 0) {
      this.snackBar.open('Please add at least one server', 'Dismiss', { duration: 3000 });
      return;
    }

    this.isSaving.set(true);

    try {
      // Get current servers from service
      const currentServers = this.mediaService.mediaServers();
      const newServers = this.servers();

      // Determine what changed
      const addedServers = newServers.filter(s => !currentServers.includes(s));
      const removedServers = currentServers.filter(s => !newServers.includes(s));
      const orderChanged = JSON.stringify(currentServers) !== JSON.stringify(newServers);

      // Apply changes
      for (const server of removedServers) {
        await this.mediaService.removeMediaServer(server);
      }

      for (const server of addedServers) {
        await this.mediaService.addMediaServer(server);
      }

      // If order changed but servers are the same, reorder
      if (orderChanged && addedServers.length === 0 && removedServers.length === 0) {
        await this.mediaService.reorderMediaServers(newServers);
      }

      this.snackBar.open('Media server settings saved!', 'Dismiss', { duration: 3000 });
      this.closed.emit({ saved: true });
    } catch (error) {
      this.logger.error('Error saving media servers:', error);
      this.snackBar.open('Failed to save settings. Please try again.', 'Dismiss', { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  onCancel(): void {
    this.closed.emit(null);
  }

  // Get suggested servers that aren't already added
  get availableSuggestedServers(): typeof SUGGESTED_SERVERS {
    return this.suggestedServers.filter(s => {
      const normalizedUrl = this.normalizeUrl(s.url);
      return normalizedUrl && !this.servers().includes(normalizedUrl);
    });
  }

  getTestResult(server: string): { success: boolean; message: string } | undefined {
    return this.testResults().get(server);
  }

  getServerDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return url;
    }
  }
}
