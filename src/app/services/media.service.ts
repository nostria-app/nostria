import { Injectable, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { BehaviorSubject } from 'rxjs';

export interface MediaItem {
  id: string;
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
}

@Injectable({
  providedIn: 'root'
})
export class MediaService {
  private apiUrl = 'https://api.example.com/media'; // Replace with your actual API URL
  
  // State management
  private _mediaItems = signal<MediaItem[]>([]);
  private _loading = signal<boolean>(false);
  private _error = signal<string | null>(null);

  // Public signals
  readonly mediaItems = this._mediaItems.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  constructor() {
    // Initial loading of media items
    this.getFiles();
  }

  async getFiles(): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    
    try {
      const response = await fetch(`${this.apiUrl}/list`, {
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error('Failed to fetch media items');
      }
      
      const data = await response.json();
      this._mediaItems.set(data);
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error fetching media items:', err);
    } finally {
      this._loading.set(false);
    }
  }

  async uploadFile(file: File, metadata: { title?: string, description?: string }): Promise<MediaItem> {
    this._loading.set(true);
    this._error.set(null);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      if (metadata.title) formData.append('title', metadata.title);
      if (metadata.description) formData.append('description', metadata.description);

      const response = await fetch(`${this.apiUrl}/upload`, {
        method: 'POST',
        headers: this.getAuthHeaders(true), // Skip content-type as FormData sets it
        body: formData
      });

      if (!response.ok) {
        throw new Error('Failed to upload file');
      }
      
      const newMedia = await response.json();
      
      // Update the media items list with the new item
      this._mediaItems.update(items => [...items, newMedia]);
      
      return newMedia;
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error uploading file:', err);
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  async deleteFile(id: string): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    
    try {
      const response = await fetch(`${this.apiUrl}/${id}`, {
        method: 'DELETE',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error('Failed to delete file');
      }
      
      // Remove the deleted item from the media items list
      this._mediaItems.update(items => items.filter(item => item.id !== id));
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error deleting file:', err);
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  async mirrorFile(id: string): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    
    try {
      const response = await fetch(`${this.apiUrl}/${id}/mirror`, {
        method: 'POST',
        headers: this.getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error('Failed to mirror file');
      }
      
      // Get the updated media item
      const updatedMedia = await response.json();
      
      // Update the specific media item in the list
      this._mediaItems.update(items => 
        items.map(item => item.id === id ? updatedMedia : item)
      );
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error mirroring file:', err);
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  async reportFile(id: string, reason: string): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    
    try {
      const response = await fetch(`${this.apiUrl}/${id}/report`, {
        method: 'POST',
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason })
      });

      if (!response.ok) {
        throw new Error('Failed to report file');
      }
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error reporting file:', err);
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  async updateMetadata(id: string, metadata: { title?: string, description?: string }): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    
    try {
      const response = await fetch(`${this.apiUrl}/${id}/metadata`, {
        method: 'PATCH',
        headers: {
          ...this.getAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
      });

      if (!response.ok) {
        throw new Error('Failed to update metadata');
      }
      
      // Get the updated media item
      const updatedMedia = await response.json();
      
      // Update the specific media item in the list
      this._mediaItems.update(items => 
        items.map(item => item.id === id ? updatedMedia : item)
      );
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Unknown error occurred');
      console.error('Error updating metadata:', err);
      throw err;
    } finally {
      this._loading.set(false);
    }
  }

  private getAuthHeaders(skipContentType = false): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.getAuthToken()}`
    };
    
    if (!skipContentType) {
      headers['Content-Type'] = 'application/json';
    }
    
    return headers;
  }

  private getAuthToken(): string {
    // Get token from local storage or other auth service
    const token = localStorage.getItem('authToken');
    if (!token) {
      console.warn('No auth token found');
      return '';
    }
    return token;
  }
}
