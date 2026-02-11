import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DiscoveryRelayService, ServerInfo } from '../../services/discovery-relay.service';
import { LoggerService } from '../../services/logger.service';
import { CustomDialogRef } from '../../services/custom-dialog.service';

@Component({
  selector: 'app-setup-new-account-dialog',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './setup-new-account-dialog.component.html',
  styleUrl: './setup-new-account-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SetupNewAccountDialogComponent {
  private dialogRef = inject(CustomDialogRef<SetupNewAccountDialogComponent>);
  private discoveryService = inject(DiscoveryRelayService);
  private logger = inject(LoggerService);

  // Region detection signals
  isDetectingRegion = signal(true);
  detectedRegion = signal('');
  selectedRegionId = signal<string | null>(null);
  showRegionSelector = signal(false);
  availableRegions = signal<{ name: string; latency: string; id: string }[]>([]);

  constructor() {
    // Start region detection when dialog opens
    this.startRegionDetection();
  }

  async startRegionDetection(): Promise<void> {
    this.isDetectingRegion.set(true);
    this.detectedRegion.set('');
    this.showRegionSelector.set(false);

    try {
      // First trigger the latency check to populate the servers with latency data
      await this.discoveryService.checkServerLatency();

      // Get all servers sorted by latency
      const serversWithLatency = this.discoveryService.getServersByLatency();

      // Convert ServerInfo to our UI format
      const regions = serversWithLatency.map((server: ServerInfo) => {
        const regionId = this.getRegionIdFromServer(server);

        return {
          name: server.region,
          latency: `${server.latency || 9999}ms`,
          id: regionId,
        };
      });

      this.availableRegions.set(regions);

      // The first server should be the fastest since they're sorted by latency
      const fastestRegion = regions[0];

      if (fastestRegion) {
        // Set the detected region and selected region
        this.detectedRegion.set(fastestRegion.name);
        this.selectedRegionId.set(fastestRegion.id);
      }

      // Simulate detection time for better UX (minimum display time)
      await new Promise(resolve => setTimeout(resolve, 1500));

      this.isDetectingRegion.set(false);
    } catch (error) {
      this.logger.error('Failed to detect region:', error);
      // Fallback to manual selection
      this.isDetectingRegion.set(false);
      this.showRegionSelector.set(true);
    }
  }

  toggleRegionSelector(): void {
    this.showRegionSelector.set(!this.showRegionSelector());
  }

  selectRegion(region: { name: string; id: string }): void {
    this.logger.debug('Region selected', { region });
    this.detectedRegion.set(region.name);
    this.selectedRegionId.set(region.id);
    this.showRegionSelector.set(false);
  }

  /**
   * Maps a ServerInfo object to a region ID
   */
  private getRegionIdFromServer(server: ServerInfo): string {
    // Extract region from the server URL or region property
    const url = server.url.toLowerCase();

    if (url.includes('.eu.') || server.region.toLowerCase().includes('europe')) {
      return 'eu';
    } else if (url.includes('.us.') || server.region.toLowerCase().includes('usa')) {
      return 'us';
    } else if (url.includes('.af.') || server.region.toLowerCase().includes('africa')) {
      return 'af';
    } else if (url.includes('.as.') || server.region.toLowerCase().includes('asia')) {
      return 'as';
    } else if (url.includes('.sa.') || server.region.toLowerCase().includes('south america')) {
      return 'sa';
    } else if (url.includes('.au.') || server.region.toLowerCase().includes('australia')) {
      return 'au';
    } else if (url.includes('.jp.') || server.region.toLowerCase().includes('japan')) {
      return 'jp';
    }

    // Default fallback
    return 'us';
  }

  confirm(): void {
    this.dialogRef.close({
      confirmed: true,
      region: this.selectedRegionId(),
    });
  }

  cancel(): void {
    this.dialogRef.close({
      confirmed: false,
    });
  }

  // Called by CustomDialogService when close button or backdrop is clicked
  onClose(): void {
    this.cancel();
  }
}
