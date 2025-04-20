import { Injectable, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { NostrService } from './nostr.service';
import { StorageService } from './storage.service';
import { LoggerService } from './logger.service';
import { EventTemplate, finalizeEvent } from 'nostr-tools';
import { RelayService } from './relay.service';
import { MEDIA_SERVERS_EVENT_KIND } from '../interfaces';
import { NostrTagKey, standardizedTag, StandardizedTagType } from '../standardized-tags';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

export interface MediaItem {
  sha256: string; // SHA-256 hash of file (NIP-94)
  type: string;
  url: string;
  size: number;
  uploaded: number;
  // thumbnailUrl?: string;
  // title?: string;
  // description?: string;
  // uploadDate: Date;
  // size: number;
  // width?: number;
  // height?: number;
  // duration?: number; // For videos, in seconds
  // mimetype: string;
  // eventId?: string; // Reference to the Nostr event that contains this media
  // dim?: string; // Dimensions in NIP-94 format (e.g., "1200x800")
  // blurhash?: string; // BlurHash for image preview
}

// export interface MediaServer {
//   url: string;
//   // name?: string;
//   // description?: string;
//   status: 'active' | 'error' | 'unknown';
//   capabilities?: string[];
//   error?: string;
//   lastChecked?: number;
// }

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
  providedIn: 'root'
})
export class MediaService {
  private readonly nostrService = inject(NostrService);
  readonly relay = inject(RelayService);
  private readonly storage = inject(StorageService);
  private readonly logger = inject(LoggerService);

  // State management
  private _mediaItems = signal<MediaItem[]>([]);
  loading = signal<boolean>(false);
  uploading = signal<boolean>(false); // New signal for upload status
  private _error = signal<string | null>(null);
  private _mediaServers = signal<string[]>([]);
  private lastFetchTime = signal<number>(0);

  // Public signals
  readonly mediaItems = this._mediaItems.asReadonly();
  readonly error = this._error.asReadonly();
  readonly mediaServers = this._mediaServers.asReadonly();

  constructor() {
    // Initial loading of media items
    // this.getFiles();
    // Load saved media servers
    // this.loadMediaServers();
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
  async updateMetadata(id: string, metadata: { title?: string, description?: string }): Promise<MediaItem> {
    const response = await fetch(`/api/media/${id}/metadata`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metadata)
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
    let mediaServerEvent = await this.storage.getEventByPubkeyAndKind(this.nostrService.pubkey(), MEDIA_SERVERS_EVENT_KIND);

    if (!mediaServerEvent) {
      mediaServerEvent = await this.relay.getEventByPubkeyAndKind(this.nostrService.pubkey(), MEDIA_SERVERS_EVENT_KIND);
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

      const currentUser = this.nostrService.activeAccount();
      if (!currentUser) {
        throw new Error('User not logged in');
      }

      const pubkey = currentUser.pubkey;

      // Try each server until we get a response
      let mediaItems: MediaItem[] = [];
      let firstError: Error | null = null;

      for (const server of servers) {
        try {
          const headers = await this.getAuthHeaders('List Files', 'list');

          const url = server.endsWith('/') ? server : `${server}/`;
          const response = await fetch(`${url}list/${pubkey}`, {
            headers: headers
          });

          if (!response.ok) {
            throw new Error(`Failed to fetch media items: ${response.status}`);
          }

          const data = await response.json();
          mediaItems = data;

          // Update server status to active
          // this.updateServerStatus(server, 'active');

          // Successfully got media items, no need to try other servers
          break;
        } catch (err) {
          this.logger.error(`Failed to fetch media from server ${server}:`, err);

          // Save the first error to display if all servers fail
          if (!firstError) {
            firstError = err instanceof Error ? err : new Error('Unknown error occurred');
          }

          // Update server status
          // this.updateServerStatus(server, 'error', err instanceof Error ? err.message : 'Unknown error');
        }
      }

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
        // Parse capabilities
        // const info = await response.json();

        // Update server with capabilities
        // this._mediaServers.update(servers =>
        //   servers.map(server =>
        //     server === normalizedUrl
        //       ? {
        //         ...server,
        //         status: 'active',
        //         capabilities: info.capabilities || [],
        //         error: undefined,
        //         lastChecked: Date.now()
        //       }
        //       : server
        //   )
        // );

        return {
          success: true,
          message: `Connected successfully! Server: ${normalizedUrl}`
        };
      } else {
        // Try a simple HEAD request to check if server exists
        const headResponse = await fetch(normalizedUrl, { method: 'HEAD' });

        if (headResponse.ok) {
          // Update server status
          // this._mediaServers.update(servers =>
          //   servers.map(server =>
          //     server.url === normalizedUrl
          //       ? {
          //         ...server,
          //         status: 'active',
          //         error: 'Info endpoint not available',
          //         lastChecked: Date.now()
          //       }
          //       : server
          //   )
          // );

          return {
            success: true,
            message: 'Server exists but info endpoint not available. Limited functionality.'
          };
        }

        // Update server status
        // this.updateServerStatus(normalizedUrl, 'error', `HTTP ${response.status}: ${response.statusText}`);

        return {
          success: false,
          message: `Failed to connect: ${response.status} ${response.statusText}`
        };
      }
    } catch (error) {
      // Update server status
      // this.updateServerStatus(url, 'error', error instanceof Error ? error.message : 'Unknown error');

      return {
        success: false,
        message: `Connection error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async initialize() {

  }

  async publishMediaServers(): Promise<void> {
    try {
      this.loading.set(true);
      this._error.set(null);

      const currentUser = this.nostrService.activeAccount();
      if (!currentUser) {
        throw new Error('User not logged in');
      }

      const servers = this._mediaServers();

      // Create tags array from servers
      const tags: string[][] = servers.map(server => {
        return ['server', server];
      });

      const event = this.nostrService.createEvent(MEDIA_SERVERS_EVENT_KIND, '', tags);

      // Sign and publish the event
      const signedEvent = await this.nostrService.signEvent(event);

      // Save the event to our storage
      await this.storage.saveEvent(signedEvent);

      const result = await this.relay.publish(signedEvent);

      console.log('Result from publish:', result);
      this.logger.info('Media servers published to Nostr', { eventId: signedEvent.id });
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
    const action = (isPicture || isVideo) ? 'media' : 'upload';

    return { isPicture, isVideo, action };
  }

  async getFileBytes(file: File): Promise<Uint8Array> {
    const arrayBuffer = await file.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  async uploadFile(file: File, uploadOriginal: boolean): Promise<MediaItem | null> {
    this.uploading.set(true);
    this._error.set(null);

    try {
      // Check if we have any media servers configured
      const servers = this._mediaServers();
      if (servers.length === 0) {
        throw new Error('No media servers configured');
      }

      // Try each server until upload succeeds
      let uploadedMedia: MediaItem | null = null;
      let firstError: Error | null = null;

      for (const server of servers) {
        try {
          const url = server.endsWith('/') ? server : `${server}/`;

          const fileBytes = await this.getFileBytes(file);
          const hash = bytesToHex(sha256(fileBytes));

          let action = this.determineAction(file);

          // If the user chose to upload the original file, set the action to 'upload'
          if (uploadOriginal) {
            action.action = 'upload';
          }

          const headers = await this.getAuthHeaders('Upload File', action.action, hash);

          headers['X-SHA-256'] = hash;
          headers['X-Content-Type'] = file.type;
          headers['X-Content-Length'] = file.size.toString();

          const api = action.action === 'media' ? 'media' : 'upload';

          // First check if upload is allowed with HEAD request (BUD-06)
          const headResponse = await fetch(`${url}${api}`, {
            method: 'HEAD',
            headers: headers
          });

          if (!headResponse.ok) {
            const reason = headResponse.headers.get('x-reason');
            const response = await headResponse.text();
            console.log('Response:', response);

            throw new Error(`Upload not allowed on ${server}: Reason: ${reason}, Status: ${headResponse.status}`);
          }

          // Send the binary file directly
          const response = await fetch(`${url}${api}`, {
            method: 'PUT', // As per BUD-02 spec
            headers: {
              ...headers,
              'Content-Type': file.type,
              'Content-Length': file.size.toString(),
            },
            body: file // Send the file directly as binary data
          });

          if (!response.ok) {

            const reason = response.headers.get('x-reason');
            // const response = await headResponse.text();
            // console.log('Response:', response);

            if (response.status == 500) {
              const errorText = response.statusText;
              const responseText = await response.text();

              if (!uploadOriginal) {
                if (action.isVideo) {
                  this._error.set(`${reason}. This might happen because you upload a video file and the server cannot transcode it. Try uploading original instead.`);
                } else if (action.isPicture) {
                  this._error.set(`${reason}. This might happen because you upload a picture file and the server cannot optimize it. Try uploading original instead.`);
                }
              } else {
                this._error.set(`${reason}.`);
              }

              return null;
            }

            if (!reason) {
              throw new Error(`Failed to upload file on ${server}: ${response.status}`);
            }

            throw new Error(`Failed to upload file on ${server}: Reason: ${reason}, Status: ${headResponse.status}`);
          }

          uploadedMedia = await response.json();
          console.log('Uploaded media:', uploadedMedia);

          // Update server status to active
          // this.updateServerStatus(server.url, 'active');

          // Successfully uploaded, no need to try other servers
          break;
        } catch (err) {
          // this.logger.error(`Failed to upload to server ${server.url}:`, err);

          // Save the first error to display if all servers fail
          if (!firstError) {
            firstError = err instanceof Error ? err : new Error('Unknown error occurred');
          }

          // Update server status
          // this.updateServerStatus(server, 'error', err instanceof Error ? err.message : 'Unknown error');
        }
      }

      if (uploadedMedia) {
        // Update the media items list with the new item
        this._mediaItems.update(items => [...items, uploadedMedia!]);
        return uploadedMedia;
      } else if (firstError) {
        throw firstError;
      } else {
        throw new Error('Failed to upload file to any server');
      }
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      this.logger.error('Error uploading file:', err);
      throw err;
    } finally {
      this.uploading.set(false);
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

      // Try each server until delete succeeds
      let deleteSuccessful = false;
      let firstError: Error | null = null;

      for (const server of servers) {
        try {
          const url = server.endsWith('/') ? server : `${server}/`;

          const response = await fetch(`${url}${id}`, {
            method: 'DELETE',
            headers: await this.getAuthHeaders('Delete File', 'delete', id)
          });

          if (!response.ok) {
            throw new Error(`Failed to delete file from ${server}: ${response.status}`);
          }

          // Update server status to active
          // this.updateServerStatus(server.url, 'active');

          deleteSuccessful = true;
          break;
        } catch (err) {
          this.logger.error(`Failed to delete from server ${server}:`, err);

          if (!firstError) {
            firstError = err instanceof Error ? err : new Error('Unknown error occurred');
          }

          // Update server status
          // this.updateServerStatus(server.url, 'error', err instanceof Error ? err.message : 'Unknown error');
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

  async mirrorFile(id: string): Promise<void> {
    this.loading.set(true);
    this._error.set(null);

    try {
      // Check if we have any media servers configured
      const servers = this._mediaServers();
      if (servers.length === 0) {
        throw new Error('No media servers configured');
      }

      // Try each server until mirror succeeds
      let mirrorSuccessful = false;
      let firstError: Error | null = null;

      for (const server of servers) {
        try {
          const url = server.endsWith('/') ? server : `${server}/`;

          // First check if mirroring is allowed with HEAD request
          const headResponse = await fetch(`${url}mirror`, {
            method: 'HEAD',
            headers: await this.getAuthHeaders('Mirror File', 'upload')
          });

          if (!headResponse.ok) {
            throw new Error(`Mirroring not allowed on ${server}: ${headResponse.status}`);
          }

          const response = await fetch(`${url}mirror`, {
            method: 'PUT', // As per BUD-04 spec
            headers: {
              ...await this.getAuthHeaders('Mirror File', 'upload'),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sha256: id })
          });

          if (!response.ok) {
            throw new Error(`Failed to mirror file on ${server}: ${response.status}`);
          }

          // Get the updated media item
          const updatedMedia = await response.json();

          // Update the specific media item in the list
          this._mediaItems.update(items =>
            items.map(item => item.sha256 === id ? updatedMedia : item)
          );

          // Update server status to active
          // this.updateServerStatus(server.url, 'active');

          mirrorSuccessful = true;
          break;
        } catch (err) {
          this.logger.error(`Failed to mirror on server ${server}:`, err);

          if (!firstError) {
            firstError = err instanceof Error ? err : new Error('Unknown error occurred');
          }

          // Update server status
          // this.updateServerStatus(server.url, 'error', err instanceof Error ? err.message : 'Unknown error');
        }
      }

      if (!mirrorSuccessful && firstError) {
        throw firstError;
      } else if (!mirrorSuccessful) {
        throw new Error('Failed to mirror file on any server');
      }
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      this.logger.error('Error mirroring file:', err);
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

    //       // Update server status to active
    //       // this.updateServerStatus(server, 'active');

    //       reportSuccessful = true;
    //       break;
    //     } catch (err) {
    //       this.logger.error(`Failed to report on server ${server}:`, err);

    //       if (!firstError) {
    //         firstError = err instanceof Error ? err : new Error('Unknown error occurred');
    //       }

    //       // Update server status
    //       // this.updateServerStatus(server.url, 'error', err instanceof Error ? err.message : 'Unknown error');
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

  private async createSignedEvent(type: string, data: any): Promise<NostrEvent> {
    const currentUser = this.nostrService.activeAccount();
    if (!currentUser) {
      throw new Error('User not logged in');
    }

    // Create event for signing
    const event: Partial<NostrEvent> = {
      kind: 27235, // NIP-94 kind for file metadata
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['x', type],
        ['sha256', data.sha256 || ''],
      ],
      content: JSON.stringify(data),
    };

    // Add appropriate tags based on NIP-94
    if (data.title) {
      event.tags?.push(['title', data.title]);
    }

    if (data.description) {
      event.tags?.push(['description', data.description]);
    }

    return await this.signEvent(event);
  }

  private async signEvent(event: Partial<NostrEvent>): Promise<NostrEvent> {
    const currentUser = this.nostrService.activeAccount();
    if (!currentUser) {
      throw new Error('User not logged in');
    }

    // Try to use window.nostr (NIP-07) if available and user is using extension
    // if (window.nostr && currentUser.source === 'extension') {
    //   return await window.nostr.signEvent(event);
    // } 

    // Use nostr-tools if we have the private key
    if (currentUser.privkey) {
      // Import finalizeEvent & getPublicKey dynamically to avoid circular dependencies
      const { finalizeEvent } = await import('nostr-tools/pure');
      const { getPublicKey } = await import('nostr-tools/pure');
      const { hexToBytes } = await import('@noble/hashes/utils');

      // Convert hex private key to bytes
      const privateKeyBytes = hexToBytes(currentUser.privkey);

      // Verify the private key corresponds to our pubkey
      const derivedPubkey = getPublicKey(privateKeyBytes);
      if (derivedPubkey !== currentUser.pubkey) {
        throw new Error('Private key does not match public key');
      }

      // Finalize the event with our private key
      return finalizeEvent(event as EventTemplate, privateKeyBytes);
    }

    // For preview/remote accounts, we can't sign
    throw new Error('Cannot sign event: no private key available');
  }

  private async getAuthHeaders(reason: string, action: string | 'list' | 'upload' | 'media' | 'delete' | 'get', sha256?: string, skipContentType = false): Promise<Record<string, string>> {
    const currentUser = this.nostrService.activeAccount();
    if (!currentUser) {
      throw new Error('User not logged in');
    }

    const headers: Record<string, string> = {};

    // Don't attempt to add auth headers if the user is using the preview account
    if (currentUser.source !== 'preview') {
      const tags = [
        ['t', action],
        ["expiration", this.nostrService.futureDate(10).toString()]
      ];

      if (sha256) {
        tags.push(['x', sha256]);
      }

      const authEvent = this.nostrService.createEvent(24242, reason, tags);
      const signedEvent = await this.nostrService.signEvent(authEvent);

      if (!signedEvent) {
        throw new Error('Failed to sign event for authorization headers');
      }

      // Convert signed event to base64 string for Authorization header
      const base64Event = btoa(JSON.stringify(signedEvent));
      headers['Authorization'] = `Nostr ${base64Event}`
    }

    // if (!skipContentType) {
    //   headers['Content-Type'] = 'application/json';
    // }

    return headers;
  }

  // Add getter for last fetch time
  getLastFetchTime(): number {
    return this.lastFetchTime();
  }
}
