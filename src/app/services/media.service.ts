import { Injectable, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';
import { NostrService } from './nostr.service';
import { StorageService } from './storage.service';
import { LoggerService } from './logger.service';
import { EventTemplate } from 'nostr-tools';

export interface MediaItem {
  id: string;
  sha256: string; // SHA-256 hash of file (NIP-94)
  type: 'image' | 'video';
  url: string;
  thumbnailUrl?: string;
  title?: string;
  description?: string;
  uploadDate: Date;
  size: number;
  width?: number;
  height?: number;
  duration?: number; // For videos, in seconds
  mimetype: string;
  eventId?: string; // Reference to the Nostr event that contains this media
  dim?: string; // Dimensions in NIP-94 format (e.g., "1200x800")
  blurhash?: string; // BlurHash for image preview
}

export interface MediaServer {
  url: string;
  name?: string;
  description?: string;
  status: 'active' | 'error' | 'unknown';
  capabilities?: string[];
  error?: string;
  lastChecked?: number;
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

const MEDIA_SERVERS_EVENT_KIND = 10063;
const SERVERS_STORAGE_KEY = 'nostria-media-servers';

@Injectable({
  providedIn: 'root'
})
export class MediaService {
  private readonly nostrService = inject(NostrService);
  private readonly storage = inject(StorageService);
  private readonly logger = inject(LoggerService);

  // State management
  private _mediaItems = signal<MediaItem[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);
  private _mediaServers = signal<MediaServer[]>([]);

  // Public signals
  readonly mediaItems = this._mediaItems.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly mediaServers = this._mediaServers.asReadonly();

  constructor() {
    // Initial loading of media items
    this.getFiles();
    // Load saved media servers
    this.loadMediaServers();
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

  private async loadMediaServers(): Promise<void> {
    // First try to load from localStorage for faster initial load
    const savedServers = localStorage.getItem(SERVERS_STORAGE_KEY);
    if (savedServers) {
      try {
        const servers = JSON.parse(savedServers) as MediaServer[];
        this._mediaServers.set(servers);
      } catch (error) {
        this.logger.error('Failed to parse saved media servers', error);
      }
    }

    // Then try to get from Nostr
    try {
      const currentUser = this.nostrService.activeAccount();
      if (!currentUser) return;

      const event = await this.storage.getEventByPubkeyAndKind(currentUser.pubkey, MEDIA_SERVERS_EVENT_KIND);
      if (!event) return;

      // Extract servers from tags
      const servers: MediaServer[] = event.tags
        .filter(tag => tag.length >= 2 && tag[0] === 'server')
        .map(tag => {
          const url = tag[1];

          // Check if we have a name (optional 3rd element in tag)
          const name = tag.length >= 3 ? tag[2] : undefined;

          // Check if we already have this server in our current list
          const existingServer = this._mediaServers().find(s => s.url === url);

          return {
            url,
            name,
            status: existingServer?.status || 'unknown',
            capabilities: existingServer?.capabilities,
            error: existingServer?.error,
            lastChecked: existingServer?.lastChecked
          };
        });

      this._mediaServers.set(servers);

      // Also save to localStorage
      localStorage.setItem(SERVERS_STORAGE_KEY, JSON.stringify(servers));
    } catch (error) {
      this.logger.error('Failed to load media servers from Nostr', error);
    }
  }

  async getFiles(): Promise<void> {
    this._loading.set(true);
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
          const url = server.url.endsWith('/') ? server.url : `${server.url}/`;
          const response = await fetch(`${url}list/${pubkey}`, {
            headers: await this.getAuthHeaders()
          });

          if (!response.ok) {
            throw new Error(`Failed to fetch media items: ${response.status}`);
          }

          const data = await response.json();
          mediaItems = data;

          // Update server status to active
          this.updateServerStatus(server.url, 'active');

          // Successfully got media items, no need to try other servers
          break;
        } catch (err) {
          this.logger.error(`Failed to fetch media from server ${server.url}:`, err);

          // Save the first error to display if all servers fail
          if (!firstError) {
            firstError = err instanceof Error ? err : new Error('Unknown error occurred');
          }

          // Update server status
          this.updateServerStatus(server.url, 'error', err instanceof Error ? err.message : 'Unknown error');
        }
      }

      if (mediaItems.length > 0) {
        this._mediaItems.set(mediaItems);
      } else if (firstError) {
        throw firstError;
      }
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      this.logger.error('Error fetching media items:', err);
    } finally {
      this._loading.set(false);
    }
  }

  private updateServerStatus(url: string, status: MediaServer['status'], errorMessage?: string): void {
    this._mediaServers.update(servers =>
      servers.map(server =>
        server.url === url
          ? {
            ...server,
            status,
            error: errorMessage,
            lastChecked: Date.now()
          }
          : server
      )
    );

    // Update localStorage
    localStorage.setItem(SERVERS_STORAGE_KEY, JSON.stringify(this._mediaServers()));
  }

  async addMediaServer(server: MediaServer): Promise<void> {
    // Normalize URL
    let normalizedUrl = server.url;
    if (!normalizedUrl.endsWith('/')) {
      normalizedUrl += '/';
    }

    // Check if server already exists
    const exists = this._mediaServers().some(s => s.url === normalizedUrl);
    if (exists) {
      throw new Error('Server with this URL already exists');
    }

    // Add the new server
    this._mediaServers.update(servers => [...servers, {
      ...server,
      url: normalizedUrl,
      lastChecked: Date.now()
    }]);

    // Save to localStorage
    localStorage.setItem(SERVERS_STORAGE_KEY, JSON.stringify(this._mediaServers()));

    // Publish to Nostr
    await this.publishMediaServers();
  }

  async updateMediaServer(updatedServer: MediaServer): Promise<void> {
    this._mediaServers.update(servers =>
      servers.map(server =>
        server.url === updatedServer.url
          ? { ...updatedServer, lastChecked: Date.now() }
          : server
      )
    );

    // Save to localStorage
    localStorage.setItem(SERVERS_STORAGE_KEY, JSON.stringify(this._mediaServers()));

    // Publish to Nostr
    await this.publishMediaServers();
  }

  async removeMediaServer(url: string): Promise<void> {
    this._mediaServers.update(servers => servers.filter(server => server.url !== url));

    // Save to localStorage
    localStorage.setItem(SERVERS_STORAGE_KEY, JSON.stringify(this._mediaServers()));

    // Publish to Nostr
    await this.publishMediaServers();
  }

  async testMediaServer(url: string): Promise<{ success: boolean; message: string }> {
    try {
      // Normalize URL
      const normalizedUrl = url.endsWith('/') ? url : `${url}/`;

      // Test connection by checking info endpoint
      const response = await fetch(`${normalizedUrl}info`);

      if (response.ok) {
        // Parse capabilities
        const info = await response.json();

        // Update server with capabilities
        this._mediaServers.update(servers =>
          servers.map(server =>
            server.url === normalizedUrl
              ? {
                ...server,
                status: 'active',
                capabilities: info.capabilities || [],
                error: undefined,
                lastChecked: Date.now()
              }
              : server
          )
        );

        return {
          success: true,
          message: `Connected successfully! Server: ${info.name || 'Unknown'} ${info.version || ''}`
        };
      } else {
        // Try a simple HEAD request to check if server exists
        const headResponse = await fetch(normalizedUrl, { method: 'HEAD' });

        if (headResponse.ok) {
          // Update server status
          this._mediaServers.update(servers =>
            servers.map(server =>
              server.url === normalizedUrl
                ? {
                  ...server,
                  status: 'active',
                  error: 'Info endpoint not available',
                  lastChecked: Date.now()
                }
                : server
            )
          );

          return {
            success: true,
            message: 'Server exists but info endpoint not available. Limited functionality.'
          };
        }

        // Update server status
        this.updateServerStatus(normalizedUrl, 'error', `HTTP ${response.status}: ${response.statusText}`);

        return {
          success: false,
          message: `Failed to connect: ${response.status} ${response.statusText}`
        };
      }
    } catch (error) {
      // Update server status
      this.updateServerStatus(url, 'error', error instanceof Error ? error.message : 'Unknown error');

      return {
        success: false,
        message: `Connection error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async publishMediaServers(): Promise<void> {
    try {
      this._loading.set(true);
      this._error.set(null);

      const currentUser = this.nostrService.activeAccount();
      if (!currentUser) {
        throw new Error('User not logged in');
      }

      const servers = this._mediaServers();

      // Create tags array from servers
      const tags: string[][] = servers.map(server => {
        // Add name as optional 3rd element if available
        return server.name
          ? ['server', server.url, server.name]
          : ['server', server.url];
      });

      // Create the event
      const event: Partial<NostrEvent> = {
        kind: MEDIA_SERVERS_EVENT_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: '', // Content can be empty, as servers are in tags
      };

      // Sign and publish the event
      const signedEvent = await this.signEvent(event);

      // Save the event to our storage
      await this.storage.saveEvent(signedEvent);

      this.logger.info('Media servers published to Nostr', { eventId: signedEvent.id });

      // If we have an active Nostr pool, publish the event
      // TODO: FIX PUBLISHING!
      // const relayService = this.nostrService.getUserRelays();
      // const pool = this.nostrService.getUserPool();

      // if (relayService && pool) {
      //   await pool.publish(relayService, signedEvent);
      // }
    } catch (error) {
      this._error.set(error instanceof Error ? error.message : 'Failed to publish media servers');
      this.logger.error('Error publishing media servers:', error);
      throw error;
    } finally {
      this._loading.set(false);
    }
  }

  async uploadFile(file: File, metadata: { title?: string, description?: string }): Promise<MediaItem> {
    this._loading.set(true);
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
          const url = server.url.endsWith('/') ? server.url : `${server.url}/`;

          // First check if upload is allowed with HEAD request (BUD-06)
          const headResponse = await fetch(`${url}upload`, {
            method: 'HEAD',
            headers: await this.getAuthHeaders()
          });

          if (!headResponse.ok) {
            throw new Error(`Upload not allowed on ${server.url}: ${headResponse.status}`);
          }

          const formData = new FormData();
          formData.append('file', file);

          // Prepare NIP-94 metadata tags
          if (metadata.title) formData.append('title', metadata.title);
          if (metadata.description) formData.append('description', metadata.description);

          // Add signed event for authentication
          const signedEvent = await this.createSignedEvent('upload', file);
          formData.append('event', JSON.stringify(signedEvent));

          const response = await fetch(`${url}upload`, {
            method: 'PUT', // As per BUD-02 spec
            headers: await this.getAuthHeaders(true), // Skip content-type as FormData sets it
            body: formData
          });

          if (!response.ok) {
            throw new Error(`Failed to upload file to ${server.url}: ${response.status}`);
          }

          uploadedMedia = await response.json();

          // Update server status to active
          this.updateServerStatus(server.url, 'active');

          // Successfully uploaded, no need to try other servers
          break;
        } catch (err) {
          this.logger.error(`Failed to upload to server ${server.url}:`, err);

          // Save the first error to display if all servers fail
          if (!firstError) {
            firstError = err instanceof Error ? err : new Error('Unknown error occurred');
          }

          // Update server status
          this.updateServerStatus(server.url, 'error', err instanceof Error ? err.message : 'Unknown error');
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
      this._loading.set(false);
    }
  }

  async deleteFile(id: string): Promise<void> {
    this._loading.set(true);
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
          const url = server.url.endsWith('/') ? server.url : `${server.url}/`;

          const response = await fetch(`${url}${id}`, {
            method: 'DELETE',
            headers: await this.getAuthHeaders()
          });

          if (!response.ok) {
            throw new Error(`Failed to delete file from ${server.url}: ${response.status}`);
          }

          // Update server status to active
          this.updateServerStatus(server.url, 'active');

          deleteSuccessful = true;
          break;
        } catch (err) {
          this.logger.error(`Failed to delete from server ${server.url}:`, err);

          if (!firstError) {
            firstError = err instanceof Error ? err : new Error('Unknown error occurred');
          }

          // Update server status
          this.updateServerStatus(server.url, 'error', err instanceof Error ? err.message : 'Unknown error');
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
      this._loading.set(false);
    }
  }

  async mirrorFile(id: string): Promise<void> {
    this._loading.set(true);
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
          const url = server.url.endsWith('/') ? server.url : `${server.url}/`;

          // First check if mirroring is allowed with HEAD request
          const headResponse = await fetch(`${url}mirror`, {
            method: 'HEAD',
            headers: await this.getAuthHeaders()
          });

          if (!headResponse.ok) {
            throw new Error(`Mirroring not allowed on ${server.url}: ${headResponse.status}`);
          }

          const response = await fetch(`${url}mirror`, {
            method: 'PUT', // As per BUD-04 spec
            headers: {
              ...await this.getAuthHeaders(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sha256: id })
          });

          if (!response.ok) {
            throw new Error(`Failed to mirror file on ${server.url}: ${response.status}`);
          }

          // Get the updated media item
          const updatedMedia = await response.json();

          // Update the specific media item in the list
          this._mediaItems.update(items =>
            items.map(item => item.sha256 === id ? updatedMedia : item)
          );

          // Update server status to active
          this.updateServerStatus(server.url, 'active');

          mirrorSuccessful = true;
          break;
        } catch (err) {
          this.logger.error(`Failed to mirror on server ${server.url}:`, err);

          if (!firstError) {
            firstError = err instanceof Error ? err : new Error('Unknown error occurred');
          }

          // Update server status
          this.updateServerStatus(server.url, 'error', err instanceof Error ? err.message : 'Unknown error');
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
      this._loading.set(false);
    }
  }

  async reportFile(id: string, reason: string): Promise<void> {
    this._loading.set(true);
    this._error.set(null);

    try {
      // Check if we have any media servers configured
      const servers = this._mediaServers();
      if (servers.length === 0) {
        throw new Error('No media servers configured');
      }

      // Try each server until report succeeds
      let reportSuccessful = false;
      let firstError: Error | null = null;

      for (const server of servers) {
        try {
          const url = server.url.endsWith('/') ? server.url : `${server.url}/`;

          // Create a signed report event
          const reportEvent = await this.createSignedEvent('report', { sha256: id, reason });

          const response = await fetch(`${url}media`, {
            method: 'PUT', // Using media endpoint for reporting
            headers: {
              ...await this.getAuthHeaders(),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              event: reportEvent,
              action: 'report',
              sha256: id,
              reason
            })
          });

          if (!response.ok) {
            throw new Error(`Failed to report file on ${server.url}: ${response.status}`);
          }

          // Update server status to active
          this.updateServerStatus(server.url, 'active');

          reportSuccessful = true;
          break;
        } catch (err) {
          this.logger.error(`Failed to report on server ${server.url}:`, err);

          if (!firstError) {
            firstError = err instanceof Error ? err : new Error('Unknown error occurred');
          }

          // Update server status
          this.updateServerStatus(server.url, 'error', err instanceof Error ? err.message : 'Unknown error');
        }
      }

      if (!reportSuccessful && firstError) {
        throw firstError;
      } else if (!reportSuccessful) {
        throw new Error('Failed to report file on any server');
      }
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      this.logger.error('Error reporting file:', err);
      throw err;
    } finally {
      this._loading.set(false);
    }
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

  private async getAuthHeaders(skipContentType = false): Promise<Record<string, string>> {
    try {
      const currentUser = this.nostrService.activeAccount();
      if (!currentUser) {
        throw new Error('User not logged in');
      }

      // Create a signed auth event for the request
      const authEvent = await this.createSignedEvent('auth', {
        timestamp: Date.now()
      });

      const headers: Record<string, string> = {
        'X-Nostr-Auth': JSON.stringify(authEvent)
      };

      if (!skipContentType) {
        headers['Content-Type'] = 'application/json';
      }

      return headers;
    } catch (error) {
      this.logger.error('Error creating auth headers:', error);
      return {};
    }
  }
}
