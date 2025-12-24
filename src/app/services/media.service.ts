import { Injectable, inject, signal } from '@angular/core';
import { NostrService } from './nostr.service';
import { DatabaseService } from './database.service';
import { LoggerService } from './logger.service';
import { MEDIA_SERVERS_EVENT_KIND, NostriaService } from '../interfaces';
import { standardizedTag } from '../standardized-tags';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ApplicationService } from './application.service';
import { RegionService } from './region.service';
import { AccountStateService } from './account-state.service';
import { AccountRelayService } from './relays/account-relay';

export interface MediaItem {
  sha256: string; // SHA-256 hash of file (NIP-94)
  type: string;
  url: string;
  size: number;
  uploaded: number;
  mirrors?: string[]; // Array of server URLs where this file is mirrored
}

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

@Injectable({
  providedIn: 'root',
})
export class MediaService implements NostriaService {
  private readonly nostrService = inject(NostrService);
  readonly accountRelay = inject(AccountRelayService);
  private readonly database = inject(DatabaseService);
  private readonly logger = inject(LoggerService);
  private readonly app = inject(ApplicationService);
  private readonly region = inject(RegionService);
  private readonly accountState = inject(AccountStateService);

  // State management
  private _mediaItems = signal<MediaItem[]>([]);
  loading = signal<boolean>(false);
  uploading = signal<boolean>(false); // New signal for upload status
  private _error = signal<string | null>(null);
  private _mediaServers = signal<string[]>([]);
  private lastFetchTime = signal<number>(0);

  // Temporary flag to disable batch operations due to server limitation
  readonly batchOperationsTemporarilyDisabledDueToBug = true;

  // Public signals
  readonly mediaItems = this._mediaItems.asReadonly();
  readonly error = this._error.asReadonly();
  readonly mediaServers = this._mediaServers.asReadonly();

  async load(pubkey: string = this.accountState.pubkey()) {
    // First try to get from storage (fast path)
    let userServerList = await this.nostrService.getMediaServers(pubkey);

    // If not in storage, try fetching from relay as fallback
    // This handles race conditions where the subscription hasn't received the event yet
    if (!userServerList) {
      this.logger.debug('Media servers not in storage, attempting relay fetch');
      userServerList = await this.accountRelay.getEventByPubkeyAndKind(
        pubkey,
        MEDIA_SERVERS_EVENT_KIND
      );

      // If found on relay, save to database for future use
      if (userServerList) {
        this.logger.debug('Found media servers on relay, saving to database');
        await this.database.saveEvent(userServerList);
      }
    }

    if (userServerList) {
      const servers = this.nostrService.getTags(userServerList, standardizedTag.server);
      this.setMediaServers(servers);
    } else {
      this.logger.debug(
        'No media servers found for user. This user might be a Nostria account or any other Nostr user.'
      );

      if (!this.accountState.account()?.hasActivated) {
        this.logger.debug(
          'User has not activated their account yet, so we will add regional media servers.'
        );

        const region = this.accountState.account()?.region || 'eu';
        const mediaServerUrl = this.region.getMediaServer(region, 0);
        this.setMediaServers([mediaServerUrl!]);
      }
    }
  }

  async loadMedia() {
    if (this.mediaServers().length > 0) {
      // Only fetch files if it's been more than 10 minutes since last fetch
      const tenMinutesInMs = 10 * 60 * 1000; // 10 minutes in milliseconds
      const currentTime = Date.now();
      const lastFetchTime = this.getLastFetchTime();
      if (currentTime - lastFetchTime > tenMinutesInMs) {
        await this.getFiles();
      }
    }
  }

  clear() {
    this._mediaItems.set([]);
    this.loading.set(false);
    this.uploading.set(false);
    this._error.set(null);
    this._mediaServers.set([]);
    this.lastFetchTime.set(0);
  }

  async getFileById(id: string): Promise<MediaItem> {
    const media = this.mediaItems();
    const item = media.find(m => m.sha256 === id);

    if (!item) {
      throw new Error('Media item not found');
    }

    return item;
  }

  // Add implementation for the missing updateMetadata method
  async updateMetadata(
    id: string,
    metadata: { title?: string; description?: string }
  ): Promise<MediaItem> {
    const response = await fetch(`/api/media/${id}/metadata`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    });

    if (!response.ok) {
      throw new Error('Failed to update metadata');
    }

    return response.json();
  }

  setMediaServers(servers: string[]): void {
    this._mediaServers.set(servers);
  }

  private async loadMediaServers(): Promise<void> {
    // First try to load from localStorage for faster initial load
    let mediaServerEvent = await this.database.getEventByPubkeyAndKind(
      this.accountState.pubkey(),
      MEDIA_SERVERS_EVENT_KIND
    );

    if (!mediaServerEvent) {
      mediaServerEvent = await this.accountRelay.getEventByPubkeyAndKind(
        this.accountState.pubkey(),
        MEDIA_SERVERS_EVENT_KIND
      );
    }

    if (mediaServerEvent) {
      const servers = this.nostrService.getTags(mediaServerEvent, standardizedTag.server);
      this._mediaServers.set(servers);
    }
  }

  async getFiles(): Promise<void> {
    this.loading.set(true);
    this._error.set(null);

    try {
      // First check if we have any media servers configured
      const servers = this._mediaServers();
      if (servers.length === 0) {
        this._mediaItems.set([]);
        return;
      }

      const pubkey = this.accountState.pubkey();

      // Generate auth headers once for all servers
      const headers = await this.getAuthHeaders('List Files', 'list');

      // Keep track of all items by sha256 to detect duplicates
      const itemsByHash: Record<string, MediaItem> = {};
      let firstError: Error | null = null;

      for (const server of servers) {
        try {
          const url = server.endsWith('/') ? server : `${server}/`;
          const response = await fetch(`${url}list/${pubkey}`, {
            headers: headers, // Reuse the same auth headers
          });

          if (!response.ok) {
            throw new Error(`Failed to fetch media items: ${response.status}`);
          }

          const data = await response.json();

          // Process each item to handle mirroring
          for (const item of data) {
            if (itemsByHash[item.sha256]) {
              // This is a mirrored item, add the full file URL to the mirrors array
              if (!itemsByHash[item.sha256].mirrors) {
                itemsByHash[item.sha256].mirrors = [];
              }
              if (!itemsByHash[item.sha256].mirrors!.includes(item.url)) {
                itemsByHash[item.sha256].mirrors!.push(item.url);
              }
            } else {
              // This is a new item
              item.mirrors = []; // Initialize mirrors array
              itemsByHash[item.sha256] = item;
            }
          }
        } catch (err) {
          this.logger.error(`Failed to fetch media from server ${server}:`, err);

          // Save the first error to display if all servers fail
          if (!firstError) {
            firstError = err instanceof Error ? err : new Error('Unknown error occurred');
          }
        }
      }

      const mediaItems = Object.values(itemsByHash);

      if (mediaItems.length > 0) {
        this._mediaItems.set(mediaItems);
      } else if (firstError) {
        throw firstError;
      }

      // Update the last fetch timestamp after successful retrieval
      this.lastFetchTime.set(Date.now());
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      this.logger.error('Error fetching media items:', err);
    } finally {
      this.loading.set(false);
    }
  }

  // Helper method to extract server URL from a file URL
  private extractServerUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      return `${parsedUrl.protocol}//${parsedUrl.host}/`;
    } catch {
      // Return the original URL if parsing fails
      return url;
    }
  }

  async addMediaServer(server: string): Promise<void> {
    // Normalize URL
    let normalizedUrl = server;
    if (!normalizedUrl.endsWith('/')) {
      normalizedUrl += '/';
    }

    // Check if server already exists
    const exists = this._mediaServers().some(s => s === normalizedUrl);

    if (exists) {
      throw new Error('Server with this URL already exists');
    }

    // Add the new server
    this._mediaServers.update(servers => [...servers, normalizedUrl]);

    // Publish to Nostr
    await this.publishMediaServers();
  }

  async updateMediaServer(original: string, server: string): Promise<void> {
    // Normalize URL
    let normalizedUrl = server;
    if (!normalizedUrl.endsWith('/')) {
      normalizedUrl += '/';
    }

    // Check if the new normalized URL already exists (excluding the original)
    const existingServers = this._mediaServers();
    const duplicateExists = existingServers.some(s => s === normalizedUrl && s !== original);

    if (duplicateExists) {
      throw new Error('Server with this URL already exists');
    }

    // Find and replace the original server
    const serverIndex = existingServers.findIndex(s => s === original);

    if (serverIndex !== -1) {
      // Replace the server at the found index
      this._mediaServers.update(servers =>
        servers.map((server, index) => (index === serverIndex ? normalizedUrl : server))
      );

      // Publish to Nostr
      await this.publishMediaServers();
    } else {
      throw new Error('Original server not found');
    }
  }

  async removeMediaServer(url: string): Promise<void> {
    this._mediaServers.update(servers => servers.filter(server => server !== url));

    // Publish to Nostr
    await this.publishMediaServers();
  }

  async testMediaServer(url: string): Promise<{ success: boolean; message: string }> {
    try {
      // Normalize URL
      const normalizedUrl = url.endsWith('/') ? url : `${url}/`;

      // Test connection by checking info endpoint
      const response = await fetch(`${normalizedUrl}`);

      if (response.ok) {
        return {
          success: true,
          message: `Connected successfully! Server: ${normalizedUrl}`,
        };
      } else {
        // Try a simple HEAD request to check if server exists
        const headResponse = await fetch(normalizedUrl, { method: 'HEAD' });

        if (headResponse.ok) {
          return {
            success: true,
            message: 'Server exists but info endpoint not available. Limited functionality.',
          };
        }

        return {
          success: false,
          message: `Failed to connect: ${response.status} ${response.statusText}`,
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Connection error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async publishMediaServers(): Promise<void> {
    try {
      this.loading.set(true);
      this._error.set(null);

      const servers = this._mediaServers();

      // Create tags array from servers
      const tags: string[][] = servers.map(server => {
        return ['server', server];
      });

      const event = this.nostrService.createEvent(MEDIA_SERVERS_EVENT_KIND, '', tags);

      // Sign and publish the event
      const signedEvent = await this.nostrService.signEvent(event);

      // Save the event to our storage
      await this.database.saveEvent(signedEvent);

      const result = await this.accountRelay.publish(signedEvent);

      this.logger.info('Media servers published to Nostr', {
        eventId: signedEvent.id,
      });
    } catch (error) {
      this._error.set(error instanceof Error ? error.message : 'Failed to publish media servers');
      this.logger.error('Error publishing media servers:', error);
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  determineAction(file: File) {
    // Check if file type is picture
    const isPicture = file.type.startsWith('image/');

    // Check if file type is video
    const isVideo = file.type.startsWith('video/');

    // Set action to "media" for pictures and videos, otherwise "upload"
    const action = isPicture || isVideo ? 'media' : 'upload';

    return { isPicture, isVideo, action };
  }

  async getFileBytes(file: File): Promise<Uint8Array> {
    const arrayBuffer = await file.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  async uploadFile(
    file: File,
    uploadOriginal: boolean,
    servers: string[],
    thumbnailUrl?: string
  ): Promise<{
    item: MediaItem | null;
    status: 'success' | 'duplicate' | 'error';
    message?: string;
  }> {
    this.uploading.set(true);
    this._error.set(null);

    let headers: Record<string, string> = {};

    try {
      let uploadedMedia: MediaItem | null = null;
      let firstError: Error | null = null;
      let hash = '';

      // Calculate file hash first to check for duplicates
      const fileBytes = await this.getFileBytes(file);
      hash = bytesToHex(sha256(fileBytes));

      // Check if file already exists with the same upload mode
      // This allows users to upload both original and optimized versions of the same file
      const existingFile = this.getFileByHash(hash);
      if (existingFile) {
        // Check if the existing file was uploaded with the same mode (original or optimized)
        const existingFileUrl = existingFile.url;
        const isExistingOriginal =
          existingFileUrl.includes('/upload/') || !existingFileUrl.includes('/media/');

        // Only consider it a duplicate if both are original or both are optimized
        if ((uploadOriginal && isExistingOriginal) || (!uploadOriginal && !isExistingOriginal)) {
          return {
            item: existingFile,
            status: 'duplicate',
            message: uploadOriginal
              ? 'Original file already exists in your media library'
              : 'Optimized version of this file already exists in your library',
          };
        }
        // Otherwise, allow upload of different version (original vs. optimized)
      }

      for (const server of servers) {
        try {
          const url = server.endsWith('/') ? server : `${server}/`;

          const action = this.determineAction(file);

          console.log(`Uploading to server: ${server}`);
          console.log(`File type: ${file.type}, Action: ${action.action}, isPicture: ${action.isPicture}, isVideo: ${action.isVideo}`);

          // If the user chose to upload the original file, set the action to 'upload'
          if (uploadOriginal) {
            action.action = 'upload';
            console.log(`Uploading original, action changed to: ${action.action}`);
          }

          headers = await this.getAuthHeaders('Upload File', action.action, hash);

          headers['X-SHA-256'] = hash;
          headers['X-Content-Type'] = file.type;
          headers['X-Content-Length'] = file.size.toString();

          const api = action.action === 'media' ? 'media' : 'upload';
          console.log(`Using API endpoint: ${url}${api}`);

          // First check if upload is allowed with HEAD request (BUD-06)
          const headResponse = await fetch(`${url}${api}`, {
            method: 'HEAD',
            headers: headers,
          });

          console.log(`HEAD response status: ${headResponse.status}`);

          if (!headResponse.ok) {
            const reason = headResponse.headers.get('x-reason');
            const response = await headResponse.text();
            console.error(`HEAD failed: Status ${headResponse.status}, Reason: ${reason}`);
            console.log('Response:', response);

            throw new Error(
              `Upload not allowed on ${server}: Reason: ${reason}, Status: ${headResponse.status}`
            );
          }

          console.log('HEAD request successful, proceeding with PUT...');
          console.log(`File size: ${file.size} bytes, type: ${file.type}`);

          // Send the binary file directly
          const response = await fetch(`${url}${api}`, {
            method: 'PUT', // As per BUD-02 spec
            headers: {
              ...headers,
              'Content-Type': file.type,
              'Content-Length': file.size.toString(),
            },
            body: file, // Send the file directly as binary data
          });

          console.log(`PUT response status: ${response.status}`);

          console.log(`PUT response status: ${response.status}`);

          if (!response.ok) {
            const reason = response.headers.get('x-reason');
            console.error(`PUT failed: Status ${response.status}, Reason: ${reason}`);

            if (response.status == 500) {
              const responseText = await response.text();
              console.error(`Server error response: ${responseText}`);

              if (!uploadOriginal) {
                if (action.isVideo) {
                  this._error.set(
                    `${reason}. This might happen because you upload a video file and the server cannot transcode it. Try uploading original instead.`
                  );
                } else if (action.isPicture) {
                  this._error.set(
                    `${reason}. This might happen because you upload a picture file and the server cannot optimize it. Try uploading original instead.`
                  );
                }
              } else {
                this._error.set(`${reason}.`);
              }

              return { item: null, status: 'error', message: `${reason}.` };
            }

            if (!reason) {
              console.error(`No reason header in error response: ${response.status}`);
              throw new Error(`Failed to upload file on ${server}: ${response.status}`);
            }

            throw new Error(
              `Failed to upload file on ${server}: Reason: ${reason}, Status: ${response.status}`
            );
          }

          uploadedMedia = await response.json();
          console.log('Upload successful! Uploaded media:', uploadedMedia);

          // After the first successful upload, we will simply call mirror on the other servers to ensure they do server-to-server transfer.
          if (uploadedMedia) {
            break;
          }
        } catch (err) {
          console.error('Upload error:', err);
          if (!firstError) {
            firstError = err instanceof Error ? err : new Error('Unknown error occurred');
          }
        }
      }

      if (uploadedMedia) {
        // Update the media items list with the new item (only if it doesn't already exist)
        this._mediaItems.update(items => {
          const exists = items.some(item => item.sha256 === uploadedMedia!.sha256);
          if (exists) {
            // Item already exists, don't add it again
            return items;
          }
          return [...items, uploadedMedia!];
        });

        this.logger.info('File uploaded successfully:', uploadedMedia);

        // Ask other servers to mirror the file - DO NOT await, let it run in background
        const otherServers = this.otherServers(uploadedMedia.url, servers);
        console.log('Asking to mirror on: ', otherServers);

        if (otherServers.length > 0) {
          // Fire and forget - mirroring happens in background
          // This significantly improves upload perceived performance
          const uploadedMediaForMirror = uploadedMedia;
          (async () => {
            try {
              // If the uploaded file is not original, we need to generate a new auth header because the action is different.
              let mirrorHeaders = headers;
              if (!uploadOriginal) {
                mirrorHeaders = await this.getAuthHeaders('Upload File', 'upload', uploadedMediaForMirror.sha256);
              }
              await this.mirrorFile(uploadedMediaForMirror.sha256, uploadedMediaForMirror.url, otherServers, mirrorHeaders);
              console.log('Background mirroring completed for:', uploadedMediaForMirror.sha256);
            } catch (err) {
              // Log but don't fail - mirroring is best-effort
              console.warn('Background mirroring failed:', err);
            }
          })();
        }

        return { item: uploadedMedia, status: 'success' };
      } else if (firstError) {
        throw firstError;
      } else {
        throw new Error('Failed to upload file to any server');
      }
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      this.logger.error('Error uploading file:', err);
      return {
        item: null,
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error occurred',
      };
    } finally {
      this.uploading.set(false);
    }
  }

  /**
   * Check if a file with the given hash exists in the media library
   * @param hash The SHA-256 hash to check for
   * @returns The media item if found, null otherwise
   */
  getFileByHash(hash: string): MediaItem | null {
    const mediaItems = this._mediaItems();
    return mediaItems.find(item => item.sha256 === hash) || null;
  }

  otherServers(url: string, servers?: string[]): string[] {
    if (servers && servers.length > 0) {
      return servers.filter(server => !url.startsWith(server));
    } else {
      return this._mediaServers().filter(server => !url.startsWith(server));
    }
  }

  async deleteFile(id: string): Promise<void> {
    this.loading.set(true);
    this._error.set(null);

    try {
      // Check if we have any media servers configured
      const servers = this._mediaServers();
      if (servers.length === 0) {
        throw new Error('No media servers configured');
      }

      // Generate auth headers once for all servers
      const headers = await this.getAuthHeaders('Delete File', 'delete', id);

      // Try each server until delete succeeds
      let deleteSuccessful = false;
      let firstError: Error | null = null;

      for (const server of servers) {
        try {
          const url = server.endsWith('/') ? server : `${server}/`;

          console.log('Deleting from server:', url, id);

          const response = await fetch(`${url}${id}`, {
            method: 'DELETE',
            headers: headers, // Reuse the same auth headers
          });

          if (!response.ok) {
            throw new Error(`Failed to delete file from ${server}: ${response.status}`);
          }

          deleteSuccessful = true;
        } catch (err) {
          this.logger.error(`Failed to delete from server ${server}:`, err);

          if (!firstError) {
            firstError = err instanceof Error ? err : new Error('Unknown error occurred');
          }
        }
      }

      if (deleteSuccessful) {
        // Remove the deleted item from the media items list
        this._mediaItems.update(items => items.filter(item => item.sha256 !== id));
      } else if (firstError) {
        throw firstError;
      } else {
        throw new Error('Failed to delete file from any server');
      }
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      this.logger.error('Error deleting file:', err);
      throw err;
    } finally {
      this.loading.set(false);
    }
  }

  async deleteFiles(ids: string[]): Promise<void> {
    this.loading.set(true);
    this._error.set(null);

    try {
      // Check if we have any media servers configured
      const servers = this._mediaServers();
      if (servers.length === 0) {
        throw new Error('No media servers configured');
      }

      // Generate a single auth header containing all file hashes
      const headers = await this.getAuthHeaders('Delete Multiple Files', 'delete', ids.join(','));

      let failedDeletes = 0;

      // Delete each file using the same auth headers
      for (const id of ids) {
        let deleteSuccessful = false;

        // Try each server for this file
        for (const server of servers) {
          try {
            const url = server.endsWith('/') ? server : `${server}/`;
            console.log('Deleting from server:', url, id);

            const response = await fetch(`${url}${id}`, {
              method: 'DELETE',
              headers: headers, // Reuse the same auth headers for all deletions
            });

            if (response.ok) {
              deleteSuccessful = true;
              break; // Move to next file after successful deletion
            }
          } catch (err) {
            this.logger.error(`Failed to delete file ${id} from server ${server}:`, err);
          }
        }

        if (!deleteSuccessful) {
          failedDeletes++;
        }
      }

      // Update the local state by removing all successfully deleted items
      if (failedDeletes < ids.length) {
        this._mediaItems.update(items => items.filter(item => !ids.includes(item.sha256)));
      }

      // If some or all deletions failed, throw an error
      if (failedDeletes === ids.length) {
        throw new Error('Failed to delete any files');
      } else if (failedDeletes > 0) {
        throw new Error(`Failed to delete ${failedDeletes} out of ${ids.length} files`);
      }
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      this.logger.error('Error deleting files:', err);
      throw err;
    } finally {
      this.loading.set(false);
    }
  }

  async mirrorFile(
    sha256: string,
    fileUrl: string,
    servers?: string[],
    headers?: Record<string, string>
  ): Promise<void> {
    this.loading.set(true);
    this._error.set(null);

    // Check if we have any media servers configured
    if (!servers || servers.length === 0) {
      servers = this.otherServers(fileUrl);
    }

    if (!headers) {
      headers = await this.getAuthHeaders('Upload File', 'upload', sha256);
    }

    try {
      // Mirror to all servers in the list
      let atLeastOneMirrorSuccessful = false;
      const errors: Error[] = [];

      for (const server of servers) {
        try {
          const url = server.endsWith('/') ? server : `${server}/`;

          // First check if mirroring is allowed with HEAD request to UPLOAD endpoint
          const headResponse = await fetch(`${url}upload`, {
            method: 'HEAD',
            headers: headers,
          });

          if (!headResponse.ok) {
            const reason = headResponse.headers.get('x-reason');
            throw new Error(
              `Mirroring not allowed on ${server}: Reason: ${reason}, Status: ${headResponse.status}`
            );
          }

          const response = await fetch(`${url}mirror`, {
            method: 'PUT', // As per BUD-04 spec
            headers: {
              ...headers,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url: fileUrl }),
          });

          if (!response.ok) {
            const reason = response.headers.get('x-reason');
            throw new Error(
              `Mirroring not allowed on ${server}: Reason: ${reason}, Status: ${response.status}`
            );
          }

          // Get the mirrored media item from the response
          const mirroredMedia = await response.json();

          // Store the full URL as the mirror URL (not just the server base URL)
          const mirrorUrl = mirroredMedia.url;

          // Update the media item by adding the mirror URL to its mirrors array
          this._mediaItems.update(items => {
            return items.map(item => {
              if (item.sha256 === sha256) {
                // Initialize mirrors array if it doesn't exist
                if (!item.mirrors) {
                  item.mirrors = [];
                }

                // Only add the mirror if it doesn't already exist in the mirrors array
                if (!item.mirrors.includes(mirrorUrl)) {
                  return {
                    ...item,
                    mirrors: [...item.mirrors, mirrorUrl],
                  };
                }
              }
              return item;
            });
          });

          atLeastOneMirrorSuccessful = true;
        } catch (err) {
          this.logger.error(`Failed to mirror on server ${server}:`, err);
          errors.push(err instanceof Error ? err : new Error('Unknown error occurred'));
        }
      }

      if (!atLeastOneMirrorSuccessful) {
        if (errors.length > 0) {
          throw errors[0];
        } else {
          throw new Error('Failed to mirror file on any server');
        }
      }
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      this.logger.error('Error mirroring file:', err);
      throw err;
    } finally {
      this.loading.set(false);
    }
  }

  async mirrorFiles(items: MediaItem[]): Promise<void> {
    if (items.length === 0) return;

    this.loading.set(true);
    this._error.set(null);

    try {
      // Create a comma-separated string of all file hashes for the auth header
      const fileHashes = items.map(item => item.sha256).join(',');

      // Generate a single auth header for all files
      const headers = await this.getAuthHeaders('Mirror Multiple Files', 'upload', fileHashes);

      let mirrorFailures = 0;

      // Process each item
      for (const item of items) {
        // Get servers that don't already have this item
        const serversForItem = this.otherServers(item.url);
        if (serversForItem.length === 0) continue; // Already on all servers

        let mirrorSuccessful = false;

        // Try to mirror on each server that doesn't have the file
        for (const server of serversForItem) {
          try {
            const url = server.endsWith('/') ? server : `${server}/`;

            // Check if mirroring is allowed
            const headResponse = await fetch(`${url}upload`, {
              method: 'HEAD',
              headers: headers,
            });

            if (!headResponse.ok) {
              continue; // Try next server
            }

            // Perform the mirror request
            const response = await fetch(`${url}mirror`, {
              method: 'PUT',
              headers: {
                ...headers,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ url: item.url }),
            });

            if (!response.ok) {
              continue; // Try next server
            }

            // Update the media item with the new mirror
            const mirroredMedia = await response.json();
            const mirrorUrl = mirroredMedia.url; // Store full URL, not just server base

            // Update the media item's mirrors array
            this._mediaItems.update(mediaItems => {
              return mediaItems.map(mediaItem => {
                if (mediaItem.sha256 === item.sha256) {
                  // Initialize mirrors array if needed
                  if (!mediaItem.mirrors) {
                    mediaItem.mirrors = [];
                  }

                  // Add new mirror if it doesn't exist
                  if (!mediaItem.mirrors.includes(mirrorUrl)) {
                    return {
                      ...mediaItem,
                      mirrors: [...mediaItem.mirrors, mirrorUrl],
                    };
                  }
                }
                return mediaItem;
              });
            });

            mirrorSuccessful = true;
            break; // Move to next item after success
          } catch (err) {
            this.logger.error(`Failed to mirror ${item.sha256} on server ${server}:`, err);
          }
        }

        if (!mirrorSuccessful) {
          mirrorFailures++;
        }
      }

      // Throw error if all mirrors failed
      if (mirrorFailures === items.length) {
        throw new Error('Failed to mirror any files');
      } else if (mirrorFailures > 0) {
        this._error.set(`Failed to mirror ${mirrorFailures} out of ${items.length} files`);
      }
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      this.logger.error('Error mirroring multiple files:', err);
      throw err;
    } finally {
      this.loading.set(false);
    }
  }

  async reportFile(id: string, reason: string): Promise<void> {
    // this._loading.set(true);
    // this._error.set(null);
    // try {
    //   // Check if we have any media servers configured
    //   const servers = this._mediaServers();
    //   if (servers.length === 0) {
    //     throw new Error('No media servers configured');
    //   }
    //   // Try each server until report succeeds
    //   let reportSuccessful = false;
    //   let firstError: Error | null = null;
    //   for (const server of servers) {
    //     try {
    //       const url = server.endsWith('/') ? server : `${server}/`;
    //       // Create a signed report event
    //       const reportEvent = await this.createSignedEvent('report', { sha256: id, reason });
    //       const response = await fetch(`${url}media`, {
    //         method: 'PUT', // Using media endpoint for reporting
    //         headers: {
    //           ...await this.getAuthHeaders('Report File'),
    //           'Content-Type': 'application/json'
    //         },
    //         body: JSON.stringify({
    //           event: reportEvent,
    //           action: 'report',
    //           sha256: id,
    //           reason
    //         })
    //       });
    //       if (!response.ok) {
    //         throw new Error(`Failed to report file on ${server}: ${response.status}`);
    //       }
    //       reportSuccessful = true;
    //       break;
    //     } catch (err) {
    //       this.logger.error(`Failed to report on server ${server}:`, err);
    //       if (!firstError) {
    //         firstError = err instanceof Error ? err : new Error('Unknown error occurred');
    //       }
    //     }
    //   }
    //   if (!reportSuccessful && firstError) {
    //     throw firstError;
    //   } else if (!reportSuccessful) {
    //     throw new Error('Failed to report file on any server');
    //   }
    // } catch (err) {
    //   this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
    //   this.logger.error('Error reporting file:', err);
    //   throw err;
    // } finally {
    //   this._loading.set(false);
    // }
  }

  private async getAuthHeaders(
    reason: string,
    action: string | 'list' | 'upload' | 'media' | 'delete' | 'get',
    sha256?: string,
    skipContentType = false
  ): Promise<Record<string, string>> {
    const currentUser = this.accountState.account();
    if (!currentUser) {
      throw new Error('User not logged in');
    }

    const headers: Record<string, string> = {};

    // Don't attempt to add auth headers if the user is using the preview account
    if (currentUser.source !== 'preview') {
      const tags = [
        ['t', action],
        ['expiration', this.nostrService.futureDate(10).toString()],
      ];

      if (sha256) {
        // If sha256 contains commas, it's a batch operation with multiple hashes
        if (sha256.includes(',')) {
          // Split the comma-separated string into individual hashes
          const hashes = sha256.split(',');

          // Add each hash as an 'x' tag to include all files in the authorization
          for (const hash of hashes) {
            if (hash) {
              tags.push(['x', hash]);
            }
          }
        } else {
          // Single file operation
          tags.push(['x', sha256]);
        }
      }

      const authEvent = this.nostrService.createEvent(24242, reason, tags);
      const signedEvent = await this.nostrService.signEvent(authEvent);

      if (!signedEvent) {
        throw new Error('Failed to sign event for authorization headers');
      }

      // Convert signed event to base64 string for Authorization header
      const base64Event = btoa(JSON.stringify(signedEvent));
      headers['Authorization'] = `Nostr ${base64Event}`;
    }

    return headers;
  }

  // Add getter for last fetch time
  getLastFetchTime(): number {
    return this.lastFetchTime();
  }

  /**
   * Checks if a media item is mirrored on all available media servers
   * @param item The media item to check
   * @returns True if the item is mirrored on all available servers, false otherwise
   */
  isFullyMirrored(item: MediaItem): boolean {
    // If there are no media servers configured, item can't be mirrored
    const availableServers = this.mediaServers();
    if (availableServers.length === 0) {
      return false;
    }

    // If the item doesn't have mirrors data, consider it not fully mirrored
    if (!item.mirrors || !Array.isArray(item.mirrors) || item.mirrors.length === 0) {
      return false;
    }

    // Extract domain from mirror URLs for comparison
    const extractDomain = (url: string): string => {
      try {
        const parsedUrl = new URL(url);
        return `${parsedUrl.protocol}//${parsedUrl.host}`;
      } catch {
        return url; // Return as is if it's not a valid URL
      }
    };

    // Normalize mirror URLs and server URLs for comparison
    // Include the original URL as part of the mirrors list
    const allMirrorUrls = [...item.mirrors];
    if (item.url) {
      allMirrorUrls.push(item.url);
    }

    const mirrorDomains = allMirrorUrls.map(mirror => extractDomain(mirror));
    const serverDomains = availableServers.map(server => extractDomain(server));

    // Check if all configured media servers are already in the item's mirrors
    return serverDomains.every(serverDomain =>
      mirrorDomains.some(mirrorDomain => mirrorDomain === serverDomain)
    );
  }

  /**
   * Reorders media servers and saves the new order
   * @param newOrder The new order of media servers
   */
  async reorderMediaServers(newOrder: string[]): Promise<void> {
    // Set the new order in the mediaServers signal
    this._mediaServers.set(newOrder);

    try {
      // Create a new event with the updated server order
      // This will create new tags with the reordered server URLs
      const tags: string[][] = [];

      // Add each server as a tag in the new order
      for (const server of newOrder) {
        tags.push([standardizedTag.server, server]);
      }

      // Save the reordered server list
      const event = this.nostrService.createEvent(MEDIA_SERVERS_EVENT_KIND, '', tags);
      const signedEvent = await this.nostrService.signEvent(event);
      await this.database.saveEvent(signedEvent);
      await this.accountRelay.publish(signedEvent);
    } catch (error) {
      this.logger.error('Failed to save server order:', error);
      throw new Error('Failed to save server order');
    }
  }

  /**
   * Clears the current error message
   */
  clearError(): void {
    this._error.set(null);
  }
}
