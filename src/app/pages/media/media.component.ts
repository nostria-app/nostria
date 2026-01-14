import { Component, inject, signal, effect, computed } from '@angular/core';

import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTabsModule } from '@angular/material/tabs';
import {
  MatDialogModule,
  MatDialog,
} from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { Router, ActivatedRoute } from '@angular/router';
import { MediaService, MediaItem } from '../../services/media.service';
import { MediaUploadDialogComponent } from './media-upload-dialog/media-upload-dialog.component';
import { MediaServerDialogComponent } from './media-server-dialog/media-server-dialog.component';
import { VideoRecordDialogComponent } from './video-record-dialog/video-record-dialog.component';
import { ApplicationStateService } from '../../services/application-state.service';
import { NostrService } from '../../services/nostr.service';
import { TimestampPipe } from '../../pipes/timestamp.pipe';
import { ApplicationService } from '../../services/application.service';
import { MediaPreviewDialogComponent } from '../../components/media-preview-dialog/media-preview.component';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { LocalStorageService } from '../../services/local-storage.service';
import { AccountStateService } from '../../services/account-state.service';
import { RegionService } from '../../services/region.service';
import { AccountRelayService } from '../../services/relays/account-relay';
import { LoggerService } from '../../services/logger.service';
import { RelayPingResultsDialogComponent } from '../settings/relays/relay-ping-results-dialog.component';
import { InfoTooltipComponent } from '../../components/info-tooltip/info-tooltip.component';
import { MediaPublishDialogComponent, MediaPublishOptions } from './media-publish-dialog/media-publish-dialog.component';
import { PublishService } from '../../services/publish.service';
import { nip19 } from 'nostr-tools';
import { LayoutService } from '../../services/layout.service';
import { TwoColumnLayoutService } from '../../services/two-column-layout.service';

@Component({
  selector: 'app-media',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatTabsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatTableModule,
    TimestampPipe,
    MatTooltipModule,
    DragDropModule,
    InfoTooltipComponent,
  ],
  templateUrl: './media.component.html',
  styleUrls: ['./media.component.scss'],
})
export class MediaComponent {
  mediaService = inject(MediaService);
  nostr = inject(NostrService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  appState = inject(ApplicationStateService);
  app = inject(ApplicationService);
  private readonly localStorage = inject(LocalStorageService);
  private readonly accountState = inject(AccountStateService);
  private readonly regionService = inject(RegionService);
  private readonly accountRelay = inject(AccountRelayService);
  private readonly twoColumnLayout = inject(TwoColumnLayoutService);
  private readonly logger = inject(LoggerService);
  private readonly publishService = inject(PublishService);

  // View state
  activeTab = signal<'images' | 'videos' | 'files' | 'servers'>('images');
  selectedItems = signal<string[]>([]);

  // Sort options
  sortOption = signal<'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'size-asc' | 'size-desc'>('newest');

  // For automatic media server setup
  isSettingUpMediaServer = signal(false);

  // Computed media lists
  images = signal<MediaItem[]>([]);
  videos = signal<MediaItem[]>([]);
  files = signal<MediaItem[]>([]);

  // Computed total storage used
  totalStorageBytes = computed(() => {
    const allMedia = this.mediaService.mediaItems();
    return allMedia.reduce((total, item) => total + (item.size || 0), 0);
  });

  // Table columns for files display
  displayedColumns: string[] = ['select', 'name', 'mirrors', 'type', 'size', 'uploaded', 'actions'];

  constructor() {
    this.twoColumnLayout.setWideLeft();
    // Restore the active tab from localStorage if available
    const savedTab = this.localStorage.getItem(this.appState.MEDIA_ACTIVE_TAB);
    if (savedTab && ['images', 'videos', 'files', 'servers'].includes(savedTab)) {
      this.activeTab.set(savedTab as 'images' | 'videos' | 'files' | 'servers');
    }

    // Update filtered lists whenever media items change
    effect(() => {
      const allMedia = this.mediaService.mediaItems();
      const sortedImages = this.sortMediaItems(allMedia.filter(item => item.type?.startsWith('image') || false));
      const sortedVideos = this.sortMediaItems(allMedia.filter(item => item.type?.startsWith('video') || false));
      const sortedFiles = this.sortMediaItems(allMedia.filter(
        item => !item.type || (!item.type.startsWith('image') && !item.type.startsWith('video'))
      ));
      this.images.set(sortedImages);
      this.videos.set(sortedVideos);
      this.files.set(sortedFiles);
      this.selectedItems.set([]);
    });

    effect(async () => {
      if (this.accountState.initialized()) {
        // This is currently triggered twice...
        await this.mediaService.loadMedia();
      }
    });

    // effect(async () => {
    //   if (this.accountState.accountChanging()) {
    //     console.log('APP INITIALIZED, FETCHING MEDIA SERVERS');
    //     const userServerList = await this.nostr.getMediaServers(this.accountState.pubkey());
    //     console.log('USER SERVER LIST', userServerList);

    //     if (userServerList) {
    //       const servers = this.nostr.getTags(userServerList, standardizedTag.server);
    //       this.mediaService.setMediaServers(servers);
    //     }

    //     // Fetch the media servers (from cache or relay).
    //     await this.mediaService.initialize();

    //     // Only fetch files if it's been more than 10 minutes since last fetch
    //     const tenMinutesInMs = 10 * 60 * 1000; // 10 minutes in milliseconds
    //     const currentTime = Date.now();
    //     const lastFetchTime = this.mediaService.getLastFetchTime(); if (currentTime - lastFetchTime > tenMinutesInMs) {
    //       await this.mediaService.getFiles();
    //     }
    //   }

    //   // if (this.app.initialized() && this.app.authenticated()) {

    //   // }
    // });

    // Check for upload query parameter and trigger upload dialog
    this.route.queryParamMap.subscribe(params => {
      const uploadParam = params.get('upload');
      const tabParam = params.get('tab');

      // Handle tab parameter to open a specific tab
      if (tabParam && ['images', 'videos', 'files', 'servers'].includes(tabParam)) {
        this.activeTab.set(tabParam as 'images' | 'videos' | 'files' | 'servers');
      }

      if (uploadParam === 'true') {
        // Remove the query parameter from URL without navigation
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: {},
          replaceUrl: true,
        });

        // Open upload dialog after a small delay to ensure navigation is complete
        setTimeout(() => {
          this.openUploadDialog();
        }, 100);
      }
    });
  }

  layout = inject(LayoutService);

  // openRecordVideoDialog(): void {
  //   this.layout.openRecordVideoDialog((item) => this.publishSingleItemFromCard(item));
  // }

  openUploadDialog(): void {
    const dialogRef = this.dialog.open(MediaUploadDialogComponent, {
      width: '500px',
      panelClass: 'responsive-dialog',
      disableClose: true, // Prevent dialog from closing while uploading
    });

    dialogRef.afterClosed().subscribe(async result => {
      if (result && result.file) {
        try {
          // Set uploading state to true
          this.mediaService.uploading.set(true);

          // Pass the selected servers to the uploadFile method
          const uploadResult = await this.mediaService.uploadFile(
            result.file,
            result.uploadOriginal,
            result.servers
          );

          // Set the uploading state to false
          this.mediaService.uploading.set(false);

          // Handle the result based on status
          if (uploadResult.status === 'duplicate') {
            this.snackBar.open('This file already exists in your media library.', 'Close', {
              duration: 3000,
            });
          } else if (uploadResult.status === 'success') {
            this.snackBar.open('Media uploaded successfully', 'Close', {
              duration: 3000,
            });
          }
        } catch (error) {
          // Set the uploading state to false on error
          this.mediaService.uploading.set(false);

          this.snackBar.open('Failed to upload media', 'Close', {
            duration: 3000,
          });
        }
      }
    });
  }

  dismissError(): void {
    this.mediaService.clearError();
  }

  openServerDialog(server?: string): void {
    const dialogRef = this.dialog.open(MediaServerDialogComponent, {
      width: '500px',
      panelClass: 'responsive-dialog',
      data: server,
    });

    dialogRef.afterClosed().subscribe(async result => {
      if (!result) return;

      try {
        if (server) {
          // Update existing server
          await this.mediaService.updateMediaServer(server, result);
          this.snackBar.open('Media server updated', 'Close', {
            duration: 3000,
          });
        } else {
          // Add new server
          await this.mediaService.addMediaServer(result);
          this.snackBar.open('Media server added', 'Close', { duration: 3000 });
        }
      } catch (error) {
        this.snackBar.open(
          error instanceof Error ? error.message : 'Failed to save media server',
          'Close',
          { duration: 3000 }
        );
      }
    });
  }

  async removeServer(url: string): Promise<void> {
    if (confirm('Are you sure you want to remove this media server?')) {
      try {
        await this.mediaService.removeMediaServer(url);
        this.snackBar.open('Media server removed', 'Close', { duration: 3000 });
      } catch (error) {
        this.snackBar.open('Failed to remove media server', 'Close', {
          duration: 3000,
        });
      }
    }
  }

  /**
   * Setup Nostria media server for users with zero media servers.
   * Detects the region from user's relay configuration and suggests the appropriate media server.
   */
  async setupNostriaMediaServer(): Promise<void> {
    this.isSettingUpMediaServer.set(true);
    this.logger.info('Starting Nostria media server setup');

    try {
      // Get user's account relays to detect region
      const userRelays = this.accountRelay.getRelayUrls();

      // Nostria media server regions
      const nostriaMediaRegions = [
        { id: 'eu', name: 'Europe', mediaServer: 'https://mibo.eu.nostria.app' },
        { id: 'us', name: 'North America', mediaServer: 'https://mibo.us.nostria.app' },
        // { id: 'af', name: 'Africa', mediaServer: 'https://mibo.af.nostria.app' },
      ];

      // Try to detect user's region from their relays
      let detectedRegion: { id: string; name: string; mediaServer: string } | null = null;

      for (const relay of userRelays) {
        for (const region of nostriaMediaRegions) {
          if (relay.includes(`.${region.id}.nostria.app`)) {
            detectedRegion = region;
            break;
          }
        }
        if (detectedRegion) break;
      }

      // If we detected a region, use it directly
      if (detectedRegion) {
        this.logger.info('Detected user region from relays', { region: detectedRegion.name });

        const dialogRef = this.dialog.open(ConfirmDialogComponent, {
          data: {
            title: 'Add Nostria Media Server',
            message: `We detected you're using the ${detectedRegion.name} region. Would you like to add the ${detectedRegion.name} Nostria media server (${detectedRegion.mediaServer})?`,
            confirmText: 'Add Server',
            cancelText: 'Cancel',
            confirmColor: 'primary',
          },
        });

        const confirmed = await dialogRef.afterClosed().toPromise();

        if (confirmed) {
          try {
            await this.mediaService.addMediaServer(detectedRegion.mediaServer);
            this.snackBar.open(
              `Successfully added ${detectedRegion.name} Nostria media server`,
              'Close',
              { duration: 3000 }
            );
          } catch (error) {
            this.logger.error('Failed to add media server', error);
            this.snackBar.open('Error adding media server. Please try again.', 'Close', {
              duration: 3000,
            });
          }
        }
      } else {
        // No region detected, ping all regions and let user choose
        this.logger.info('No region detected from relays, checking all media server regions');
        this.snackBar.open('Checking Nostria media server regions for latency...', 'Close', {
          duration: 2000,
        });

        const pingResults = await Promise.allSettled(
          nostriaMediaRegions.map(async region => {
            const pingTime = await this.checkMediaServerPing(region.mediaServer);
            return {
              region: region.name,
              regionId: region.id,
              mediaServer: region.mediaServer,
              pingTime,
            };
          })
        );

        const successfulPings = pingResults
          .map(result => {
            if (result.status === 'fulfilled') {
              return result.value;
            }
            return null;
          })
          .filter(result => result !== null)
          .sort((a, b) => a!.pingTime - b!.pingTime);

        if (successfulPings.length === 0) {
          this.snackBar.open('No reachable Nostria media servers found. Please try again later.', 'Close', {
            duration: 3000,
          });
          this.isSettingUpMediaServer.set(false);
          return;
        }

        // Show dialog with results
        const dialogResults = successfulPings.map(result => ({
          url: `${result!.region} (${result!.mediaServer})`,
          pingTime: result!.pingTime,
          isAlreadyAdded: false,
          regionData: result,
        }));

        const dialogRef = this.dialog.open(RelayPingResultsDialogComponent, {
          width: '500px',
          data: {
            results: dialogResults,
          },
        });

        dialogRef.afterClosed().subscribe(async result => {
          if (result?.selected) {
            const selectedRegion = result.selected.regionData;

            try {
              await this.mediaService.addMediaServer(selectedRegion.mediaServer);
              this.snackBar.open(
                `Successfully added ${selectedRegion.region} Nostria media server (${selectedRegion.pingTime}ms latency)`,
                'Close',
                { duration: 3000 }
              );
            } catch (error) {
              this.logger.error('Failed to add media server', error);
              this.snackBar.open('Error adding media server. Please try again.', 'Close', {
                duration: 3000,
              });
            }
          }

          this.isSettingUpMediaServer.set(false);
        });
        return; // Exit early since we opened dialog
      }
    } catch (error) {
      this.logger.error('Error during media server setup', error);
      this.snackBar.open('Error checking media server latency. Please try again.', 'Close', {
        duration: 3000,
      });
    } finally {
      this.isSettingUpMediaServer.set(false);
    }
  }

  /**
   * Check the latency to a media server by making a HEAD request
   */
  private async checkMediaServerPing(serverUrl: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const startTime = performance.now();

      const timeout = setTimeout(() => {
        reject(new Error('Timeout'));
      }, 5000); // 5 second timeout

      fetch(serverUrl, { method: 'HEAD' })
        .then(() => {
          const pingTime = Math.round(performance.now() - startTime);
          clearTimeout(timeout);
          resolve(pingTime);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  async testServer(url: string): Promise<void> {
    try {
      const result = await this.mediaService.testMediaServer(url);
      if (result.success) {
        this.snackBar.open(result.message, 'Close', { duration: 3000 });
      } else {
        this.snackBar.open(`Test failed: ${result.message}`, 'Close', {
          duration: 3000,
        });
      }
    } catch (error) {
      this.snackBar.open('Failed to test media server', 'Close', {
        duration: 3000,
      });
    }
  }

  editServer(server: string): void {
    this.openServerDialog(server);
  }

  async reorderServers(event: CdkDragDrop<string[]>): Promise<void> {
    // Get current servers
    const currentServers = this.mediaService.mediaServers();

    // Skip if index didn't change (item dropped in same position)
    if (event.previousIndex === event.currentIndex) {
      return;
    }

    // Create a new array with the updated order
    const newOrder = [...currentServers];
    moveItemInArray(newOrder, event.previousIndex, event.currentIndex);

    // Check if the order actually changed by comparing arrays
    const orderChanged = newOrder.some((server, index) => server !== currentServers[index]);

    if (orderChanged) {
      try {
        await this.mediaService.reorderMediaServers(newOrder);
        this.snackBar.open('Server order updated', 'Close', { duration: 3000 });
      } catch (error) {
        this.snackBar.open('Failed to reorder servers', 'Close', {
          duration: 3000,
        });
      }
    }
  }

  getPrimaryServer(): string | undefined {
    const servers = this.mediaService.mediaServers();
    return servers.length > 0 ? servers[0] : undefined;
  }

  openDetailsDialog(item: MediaItem): void {
    // Save the current active tab before navigating
    this.localStorage.setItem(this.appState.MEDIA_ACTIVE_TAB, this.activeTab());

    // Navigate to details page instead of opening dialog
    this.router.navigate(['/media', 'details', item.sha256]);
  }

  openMediaPreview(event: Event, item: MediaItem): void {
    // Stop event propagation to prevent toggling selection
    event.stopPropagation();

    this.dialog.open(MediaPreviewDialogComponent, {
      data: {
        mediaUrl: item.url,
        mediaType: item.type,
        mediaTitle: item.url || 'Media',
      },
      maxWidth: '100vw',
      maxHeight: '100vh',
      width: '100vw',
      height: '100vh',
      panelClass: 'image-dialog-panel',
    });
  }

  navigateToDetails(event: Event, item: MediaItem): void {
    // Ensure the event doesn't propagate to parent elements
    event.preventDefault();
    event.stopPropagation();

    // Save the current active tab before navigating
    this.localStorage.setItem(this.appState.MEDIA_ACTIVE_TAB, this.activeTab());

    // Navigate to details page with the item ID
    this.router.navigate(['/media', 'details', item.sha256]);
  }

  toggleItemSelection(sha256: string): void {
    this.selectedItems.update(items => {
      if (items.includes(sha256)) {
        return items.filter(itemSha256 => itemSha256 !== sha256);
      } else {
        return [...items, sha256];
      }
    });
  }

  selectAll(): void {
    const currentMedia =
      this.activeTab() === 'images'
        ? this.images()
        : this.activeTab() === 'videos'
          ? this.videos()
          : this.files();
    this.selectedItems.set(currentMedia.map(item => item.sha256));
  }

  clearSelection(): void {
    this.selectedItems.set([]);
  }

  async deleteSelected(sha256?: string): Promise<void> {
    const itemsToDelete = sha256 ? [sha256] : this.selectedItems();
    const confirmMessage =
      itemsToDelete.length === 1
        ? 'Are you sure you want to delete this item?'
        : `Are you sure you want to delete ${itemsToDelete.length} items?`;

    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Confirm Delete',
        message: confirmMessage,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmColor: 'warn',
      },
    });

    const result = await dialogRef.afterClosed().toPromise();
    if (result) {
      try {
        // Check if batch operations are disabled
        if (
          itemsToDelete.length > 1 &&
          !this.mediaService.batchOperationsTemporarilyDisabledDueToBug
        ) {
          // Use batch delete when feature is enabled
          await this.mediaService.deleteFiles(itemsToDelete);
        } else {
          // Fall back to individual deletes when disabled or for single items
          let deletedCount = 0;

          for (const id of itemsToDelete) {
            try {
              await this.mediaService.deleteFile(id);
              deletedCount++;
            } catch (err) {
              console.error(`Failed to delete item ${id}:`, err);
            }
          }

          if (deletedCount === 0 && itemsToDelete.length > 0) {
            throw new Error('Failed to delete any items');
          }
        }

        this.snackBar.open(
          `${itemsToDelete.length} ${itemsToDelete.length === 1 ? 'item' : 'items'} deleted`,
          'Close',
          { duration: 3000 }
        );
        this.selectedItems.set([]);
      } catch (error) {
        this.snackBar.open('Failed to delete some items', 'Close', {
          duration: 3000,
        });
      }
    }
  }

  async downloadSelected(sha256?: string): Promise<void> {
    let itemsToDownload: string[];

    if (sha256) {
      itemsToDownload = this.selectedItems();
    } else {
      itemsToDownload = this.selectedItems();
    }

    if (itemsToDownload.length === 0) return;

    try {
      // Set a status message during download
      this.snackBar.open(`Starting download of ${itemsToDownload.length} file(s)...`, 'Close', {
        duration: 3000,
      });

      // For each selected item, fetch and download
      for (const id of itemsToDownload) {
        const item = await this.mediaService.getFileById(id);
        if (item && item.url) {
          try {
            // Fetch the file content
            const response = await fetch(item.url);
            const blob = await response.blob();

            // Create a download link with proper filename
            const filename = this.getFileName(item.url);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;

            // Trigger download and clean up
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            // Small delay between downloads to prevent browser issues
            await new Promise(resolve => setTimeout(resolve, 300));
          } catch (err) {
            console.error(`Failed to download ${item.url}:`, err);
          }
        }
      }

      this.snackBar.open(`Download of ${itemsToDownload.length} file(s) initiated`, 'Close', {
        duration: 3000,
      });
    } catch (error) {
      this.snackBar.open('Failed to download some items', 'Close', {
        duration: 3000,
      });
    }
  }

  async mirrorSelected(): Promise<void> {
    const itemsToMirror = this.selectedItems();
    if (itemsToMirror.length === 0) return;

    try {
      // Collect items to mirror and those already fully mirrored
      const toMirror: MediaItem[] = [];
      const alreadyMirrored: MediaItem[] = [];

      // First collect the items and check mirroring status
      for (const id of itemsToMirror) {
        const item = await this.mediaService.getFileById(id);
        if (item && item.url) {
          if (this.mediaService.isFullyMirrored(item)) {
            alreadyMirrored.push(item);
          } else {
            toMirror.push(item);
          }
        }
      }

      if (toMirror.length > 0) {
        // Check if batch operations are disabled
        if (!this.mediaService.batchOperationsTemporarilyDisabledDueToBug) {
          // Use batch mirroring when feature is enabled
          await this.mediaService.mirrorFiles(toMirror);
        } else {
          // Fall back to individual mirrors when disabled
          let mirroredCount = 0;

          for (const item of toMirror) {
            try {
              await this.mediaService.mirrorFile(item.sha256, item.url);
              mirroredCount++;
            } catch (err) {
              console.error(`Failed to mirror item ${item.sha256}:`, err);
            }
          }

          if (mirroredCount === 0 && toMirror.length > 0) {
            throw new Error('Failed to mirror any items');
          }
        }
      }

      // Show appropriate message based on results
      if (toMirror.length > 0 && alreadyMirrored.length > 0) {
        this.snackBar.open(
          `Mirrored ${toMirror.length} file(s), ${alreadyMirrored.length} already fully mirrored`,
          'Close',
          { duration: 3000 }
        );
      } else if (toMirror.length > 0) {
        this.snackBar.open(`Mirrored ${toMirror.length} file(s) successfully`, 'Close', {
          duration: 3000,
        });
      } else if (alreadyMirrored.length > 0) {
        this.snackBar.open(`All selected files are already fully mirrored`, 'Close', {
          duration: 3000,
        });
      }
    } catch (error) {
      this.snackBar.open('Failed to mirror some items', 'Close', {
        duration: 3000,
      });
    }
  }

  isFullyMirrored(item: MediaItem): boolean {
    // Use the centralized method from MediaService
    return this.mediaService.isFullyMirrored(item);
  }

  async mirrorItem(sha256: string, url: string, servers?: string[]): Promise<void> {
    // Don't attempt mirroring if already mirrored to all available servers
    const item = await this.mediaService.getFileById(sha256);
    if (item && this.mediaService.isFullyMirrored(item)) {
      this.snackBar.open('Media is already mirrored to all your servers', 'Close', {
        duration: 3000,
      });
      return;
    }

    try {
      await this.mediaService.mirrorFile(sha256, url);
      this.snackBar.open('Media mirrored successfully', 'Close', {
        duration: 3000,
      });
    } catch (error) {
      this.snackBar.open('Failed to mirror media', 'Close', { duration: 3000 });
    }
  }

  async reportItem(sha256: string): Promise<void> {
    const reason = prompt('Please provide a reason for reporting this media:');
    if (reason) {
      try {
        await this.mediaService.reportFile(sha256, reason);
        this.snackBar.open('Media reported successfully', 'Close', {
          duration: 3000,
        });
      } catch (error) {
        this.snackBar.open('Failed to report media', 'Close', {
          duration: 3000,
        });
      }
    }
  }

  refreshMedia(): void {
    // This method is called when the user clicks refresh
    // No changes needed here as it should always fetch fresh data
    this.mediaService.getFiles();
  }

  isSelected(sha256: string): boolean {
    return this.selectedItems().includes(sha256);
  }

  setActiveTab(tab: 'images' | 'videos' | 'files' | 'servers'): void {
    this.activeTab.set(tab);
    // Store the selected tab in localStorage
    this.localStorage.setItem(this.appState.MEDIA_ACTIVE_TAB, tab);

    if (tab !== 'servers') {
      this.selectedItems.set([]);
    }
  }

  setSortOption(option: 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'size-asc' | 'size-desc'): void {
    this.sortOption.set(option);
    // Re-sort the current lists
    this.images.update(items => this.sortMediaItems(items));
    this.videos.update(items => this.sortMediaItems(items));
    this.files.update(items => this.sortMediaItems(items));
  }

  private sortMediaItems(items: MediaItem[]): MediaItem[] {
    const sortOption = this.sortOption();

    // For name sorting, pre-compute filenames to avoid repeated URL parsing
    if (sortOption === 'name-asc' || sortOption === 'name-desc') {
      const itemsWithNames = items.map(item => ({
        item,
        name: this.getFileName(item.url)
      }));

      itemsWithNames.sort((a, b) => {
        return sortOption === 'name-asc'
          ? a.name.localeCompare(b.name)
          : b.name.localeCompare(a.name);
      });

      return itemsWithNames.map(x => x.item);
    }

    return [...items].sort((a, b) => {
      switch (sortOption) {
        case 'newest':
          return (b.uploaded || 0) - (a.uploaded || 0);
        case 'oldest':
          return (a.uploaded || 0) - (b.uploaded || 0);
        case 'size-asc':
          return (a.size || 0) - (b.size || 0);
        case 'size-desc':
          return (b.size || 0) - (a.size || 0);
        default:
          return 0;
      }
    });
  }

  getSortLabel(): string {
    switch (this.sortOption()) {
      case 'newest':
        return 'Newest First';
      case 'oldest':
        return 'Oldest First';
      case 'name-asc':
        return 'Name (A-Z)';
      case 'name-desc':
        return 'Name (Z-A)';
      case 'size-asc':
        return 'Size (Small-Large)';
      case 'size-desc':
        return 'Size (Large-Small)';
      default:
        return 'Sort';
    }
  }

  getMediaTypeIcon(type: string): string {
    return type === 'image' ? 'image' : type === 'video' ? 'videocam' : 'insert_drive_file';
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatDuration(seconds: number): string {
    if (!seconds) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  // Helper to get filename from URL
  getFileName(url: string): string {
    if (!url) return 'Unknown';
    const urlParts = url.split('/');
    return urlParts[urlParts.length - 1];
  }

  async publishSelected(): Promise<void> {
    const itemsToPublish = this.selectedItems();
    if (itemsToPublish.length === 0) return;

    // Fetch the first item to show in the dialog
    const firstItem = await this.mediaService.getFileById(itemsToPublish[0]);
    if (!firstItem) {
      this.snackBar.open('Failed to load media item', 'Close', { duration: 3000 });
      return;
    }

    // For now, if multiple items are selected, publish them one by one
    if (itemsToPublish.length > 1) {
      const confirmed = confirm(
        `You have selected ${itemsToPublish.length} items. Do you want to publish them one by one?`
      );
      if (!confirmed) return;

      let successCount = 0;
      let failCount = 0;
      let lastSuccessfulEventId: string | null = null;

      for (const itemId of itemsToPublish) {
        const item = await this.mediaService.getFileById(itemId);
        if (!item) continue;

        const eventId = await this.publishSingleItemWithoutNavigation(item);
        if (eventId) {
          successCount++;
          lastSuccessfulEventId = eventId;
        } else {
          failCount++;
        }
      }

      if (successCount > 0) {
        this.snackBar.open(
          `Published ${successCount} item(s)${failCount > 0 ? `, ${failCount} failed` : ''}`,
          'Close',
          { duration: 5000 }
        );

        // Navigate to the last successfully published event
        if (lastSuccessfulEventId) {
          this.router.navigate([{ outlets: { right: ['e', lastSuccessfulEventId] } }]);
        }
      } else {
        this.snackBar.open('Failed to publish items', 'Close', { duration: 3000 });
      }

      this.selectedItems.set([]);
    } else {
      // Single item - show dialog and publish
      const result = await this.layout.publishSingleItem(firstItem);
      if (result) {
        this.selectedItems.set([]);
      }
    }
  }

  async publishSingleItemFromCard(item: MediaItem): Promise<void> {
    await this.layout.publishSingleItem(item);
  }

  private async publishSingleItemWithoutNavigation(item: MediaItem): Promise<string | null> {
    // Open the publish dialog
    const dialogRef = this.dialog.open(MediaPublishDialogComponent, {
      data: {
        mediaItem: item,
      },
      maxWidth: '650px',
      width: '100%',
      panelClass: 'responsive-dialog',
    });

    const result: MediaPublishOptions | null = await dialogRef.afterClosed().toPromise();

    if (!result) {
      return null; // User cancelled
    }

    try {
      // Build the event
      const event = await this.buildMediaEvent(item, result);

      // Sign and publish the event
      const signedEvent = await this.nostr.signEvent(event);
      const publishResult = await this.publishService.publish(signedEvent, {
        useOptimizedRelays: false, // Publish to ALL account relays for media events
      });

      if (publishResult.success) {
        // Return the nevent ID for navigation
        const neventId = nip19.neventEncode({
          id: signedEvent.id,
          author: signedEvent.pubkey,
          kind: signedEvent.kind,
        });
        return neventId;
      } else {
        return null;
      }
    } catch (error) {
      console.error('Error publishing media:', error);
      return null;
    }
  }

  // private async publishSingleItem(item: MediaItem): Promise<boolean> {
  //   // Open the publish dialog
  //   const dialogRef = this.dialog.open(MediaPublishDialogComponent, {
  //     data: {
  //       mediaItem: item,
  //     },
  //     maxWidth: '650px',
  //     width: '100%',
  //     panelClass: 'responsive-dialog',
  //   });

  //   const result: MediaPublishOptions | null = await dialogRef.afterClosed().toPromise();

  //   if (!result) {
  //     return false; // User cancelled
  //   }

  //   try {
  //     // Show publishing message
  //     this.snackBar.open('Publishing to Nostr...', '', { duration: 2000 });

  //     // Build the event
  //     const event = await this.buildMediaEvent(item, result);

  //     // Sign and publish the event
  //     const signedEvent = await this.nostr.signEvent(event);
  //     const publishResult = await this.publishService.publish(signedEvent, {
  //       useOptimizedRelays: false, // Publish to ALL account relays for media events
  //     });

  //     if (publishResult.success) {
  //       this.snackBar.open('Successfully published to Nostr!', 'Close', {
  //         duration: 3000,
  //       });

  //       // Navigate to the published event
  //       const neventId = nip19.neventEncode({
  //         id: signedEvent.id,
  //         author: signedEvent.pubkey,
  //         kind: signedEvent.kind,
  //       });
  //       this.router.navigate(['/e', neventId], { state: { event: signedEvent } });

  //       return true;
  //     } else {
  //       this.snackBar.open('Failed to publish to some relays', 'Close', {
  //         duration: 5000,
  //       });
  //       return false;
  //     }
  //   } catch (error) {
  //     console.error('Error publishing media:', error);
  //     this.snackBar.open('Failed to publish media', 'Close', {
  //       duration: 3000,
  //     });
  //     return false;
  //   }
  // }

  private async buildMediaEvent(item: MediaItem, options: MediaPublishOptions) {
    const tags: string[][] = [];

    // For kind 1 (regular note), build a simpler event structure
    if (options.kind === 1) {
      // Build content with description and media URL
      let content = options.content || '';
      if (content && !content.endsWith('\n')) {
        content += '\n';
      }
      content += item.url;

      // Add imeta tag according to NIP-92 for media attachment
      const imetaTag = ['imeta'];
      imetaTag.push(`url ${item.url}`);
      if (item.type) {
        imetaTag.push(`m ${item.type}`);
      }
      imetaTag.push(`x ${item.sha256}`);
      if (item.size) {
        imetaTag.push(`size ${item.size}`);
      }
      if (options.alt) {
        imetaTag.push(`alt ${options.alt}`);
      }
      // Add mirror URLs as fallback
      if (item.mirrors && item.mirrors.length > 0) {
        item.mirrors.forEach(mirrorUrl => {
          imetaTag.push(`fallback ${mirrorUrl}`);
        });
      }
      tags.push(imetaTag);

      // Add hashtags
      options.hashtags.forEach(tag => {
        tags.push(['t', tag]);
      });

      // Add content warning if provided
      if (options.contentWarning) {
        tags.push(['content-warning', options.contentWarning]);
      }

      // Add location if provided
      if (options.location) {
        tags.push(['location', options.location]);
      }

      // Add geohash if provided
      if (options.geohash) {
        tags.push(['g', options.geohash]);
      }

      // Add client tag (Nostria)
      tags.push(['client', 'nostria']);

      // Create the event
      return this.nostr.createEvent(1, content, tags);
    }

    // Add d-tag for addressable events (kinds 34235, 34236)
    if ((options.kind === 34235 || options.kind === 34236) && options.dTag) {
      tags.push(['d', options.dTag]);
    }

    // Upload thumbnail blob if provided (for videos)
    let thumbnailUrl = options.thumbnailUrl;
    const thumbnailUrls: string[] = []; // Collect all thumbnail URLs (main + mirrors)
    if (options.thumbnailBlob && (options.kind === 21 || options.kind === 22 || options.kind === 34235 || options.kind === 34236)) {
      try {
        const thumbnailFile = new File([options.thumbnailBlob], 'thumbnail.jpg', { type: 'image/jpeg' });
        const uploadResult = await this.mediaService.uploadFile(
          thumbnailFile,
          false,
          this.mediaService.mediaServers()
        );

        if (uploadResult.status === 'success' && uploadResult.item) {
          thumbnailUrl = uploadResult.item.url;

          // Collect all thumbnail URLs: main URL + all mirrors (deduplicated)
          const allUrls = [uploadResult.item.url];
          if (uploadResult.item.mirrors && uploadResult.item.mirrors.length > 0) {
            allUrls.push(...uploadResult.item.mirrors);
          }

          // Deduplicate URLs
          const uniqueUrls = [...new Set(allUrls)];
          thumbnailUrls.push(...uniqueUrls);
        }
      } catch (error) {
        console.error('Failed to upload thumbnail during publish:', error);
      }
    } else if (thumbnailUrl) {
      // If thumbnail URL is provided but no blob was uploaded, use just that URL
      thumbnailUrls.push(thumbnailUrl);
    }

    // Add title tag if provided
    if (options.title && options.title.trim().length > 0) {
      tags.push(['title', options.title]);
    }

    // Build imeta tag according to NIP-92/94
    const imetaTag = ['imeta'];

    // Add URL
    imetaTag.push(`url ${item.url}`);

    // Add MIME type
    if (item.type) {
      imetaTag.push(`m ${item.type}`);
    }

    // Add SHA-256 hash
    imetaTag.push(`x ${item.sha256}`);

    // Add file size
    if (item.size) {
      imetaTag.push(`size ${item.size}`);
    }

    // Add alt text if provided
    if (options.alt) {
      imetaTag.push(`alt ${options.alt}`);
    }

    // Add dimensions if provided (for images or video thumbnails)
    if (options.imageDimensions && options.kind === 20) {
      imetaTag.push(`dim ${options.imageDimensions.width}x${options.imageDimensions.height}`);
    }

    // Add blurhash for images if provided
    if (options.blurhash && options.kind === 20) {
      imetaTag.push(`blurhash ${options.blurhash}`);
    }

    // For videos, add all thumbnail image URLs if provided (NIP-71)
    if (thumbnailUrls.length > 0 && (options.kind === 21 || options.kind === 22 || options.kind === 34235 || options.kind === 34236)) {
      thumbnailUrls.forEach(url => {
        imetaTag.push(`image ${url}`);
      });

      // Add thumbnail dimensions if available
      if (options.thumbnailDimensions) {
        imetaTag.push(`dim ${options.thumbnailDimensions.width}x${options.thumbnailDimensions.height}`);
      }
    }

    // For videos, add blurhash if provided (NIP-71)
    if (options.blurhash && (options.kind === 21 || options.kind === 22 || options.kind === 34235 || options.kind === 34236)) {
      imetaTag.push(`blurhash ${options.blurhash}`);
    }

    // For videos, add duration if provided
    if (options.duration !== undefined && (options.kind === 21 || options.kind === 22 || options.kind === 34235 || options.kind === 34236)) {
      imetaTag.push(`duration ${options.duration}`);
    }

    // Add mirror URLs as fallback
    if (item.mirrors && item.mirrors.length > 0) {
      item.mirrors.forEach(mirrorUrl => {
        imetaTag.push(`fallback ${mirrorUrl}`);
      });
    }

    tags.push(imetaTag);

    // Add published_at timestamp
    tags.push(['published_at', Math.floor(Date.now() / 1000).toString()]);

    // Add alt tag separately if provided (for accessibility)
    if (options.alt) {
      tags.push(['alt', options.alt]);
    }

    // Add content warning if provided
    if (options.contentWarning) {
      tags.push(['content-warning', options.contentWarning]);
    }

    // Add hashtags
    options.hashtags.forEach(tag => {
      tags.push(['t', tag]);
    });

    // Add location if provided
    if (options.location) {
      tags.push(['location', options.location]);
    }

    // Add geohash if provided
    if (options.geohash) {
      tags.push(['g', options.geohash]);
    }

    // Add origin tag for addressable events (NIP-71)
    if ((options.kind === 34235 || options.kind === 34236) && options.origin) {
      const originTag = ['origin', options.origin.platform];
      if (options.origin.externalId) {
        originTag.push(options.origin.externalId);
      }
      if (options.origin.url) {
        originTag.push(options.origin.url);
      }
      tags.push(originTag);
    }

    // Add MIME type as m tag for filtering (for images)
    if (item.type && options.kind === 20) {
      tags.push(['m', item.type]);
    }

    // Add x tag with hash for queryability
    tags.push(['x', item.sha256]);

    // Add client tag (Nostria)
    tags.push(['client', 'nostria']);

    // Create the event
    const event = this.nostr.createEvent(
      options.kind,
      options.content,
      tags
    );

    return event;
  }
}
