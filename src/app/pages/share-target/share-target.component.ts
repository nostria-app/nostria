import { Component, effect, inject, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { NoteEditorDialogComponent } from '../../components/note-editor-dialog/note-editor-dialog.component';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { take } from 'rxjs/operators';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { ShareDebugService } from '../../services/share-debug.service';

// Enable debug mode to show share target data
const DEBUG_SHARE_TARGET = true;

@Component({
  selector: 'app-share-target',
  standalone: true,
  template: '',
})
export class ShareTargetComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private customDialog = inject(CustomDialogService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private dialog = inject(MatDialog);
  private shareDebug = inject(ShareDebugService);
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);

    if (!this.isBrowser) return;

    // Log that the component was created with current URL info
    this.shareDebug.log('share-target', 'ShareTargetComponent created', {
      fullUrl: window.location.href,
      pathname: window.location.pathname,
      search: window.location.search,
      timestamp: new Date().toISOString(),
      serviceWorkerController: !!navigator.serviceWorker?.controller,
    });

    // Check if SW is controlling this page
    const swControlled = !!navigator.serviceWorker?.controller;

    // Show immediate debug alert so we know the component loaded
    alert(`[DEBUG] ShareTarget component loaded!\n\nURL: ${window.location.href}\nSW Controlled: ${swControlled}\n\nCheck Settings > Logs for more details.`);

    // Check SW status and look for any cached data
    this.checkServiceWorkerAndCache();

    // Try to get data from clipboard API as fallback for TWAs
    // that don't properly send POST through SW
    this.tryClipboardFallback();

    effect(() => {
      const initialized = this.app.initialized();
      const authenticated = this.app.authenticated();

      this.shareDebug.log('share-target', 'Effect triggered', { initialized, authenticated });

      if (initialized && authenticated) {
        this.handleShare();
      } else if (initialized && !authenticated) {
        this.shareDebug.log('share-target', 'Not authenticated, redirecting to home');
        this.router.navigate(['/'], { replaceUrl: true });
      }
    });
  }

  /**
   * Check service worker status and look for any cached share data
   */
  private async checkServiceWorkerAndCache(): Promise<void> {
    try {
      if (!navigator.serviceWorker?.controller) {
        this.shareDebug.log('share-target', 'No service worker controller!');

        // Try to get the SW registration
        const registration = await navigator.serviceWorker.getRegistration();
        this.shareDebug.log('share-target', 'SW Registration status', {
          hasRegistration: !!registration,
          active: !!registration?.active,
          waiting: !!registration?.waiting,
          installing: !!registration?.installing,
          scope: registration?.scope
        });

        // If there's a waiting SW, try to claim
        if (registration?.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        return;
      }

      // Send message to SW to check status
      const messageChannel = new MessageChannel();
      messageChannel.port1.onmessage = (event) => {
        this.shareDebug.log('share-target', 'SW response received', event.data);
      };

      navigator.serviceWorker.controller.postMessage(
        { type: 'CHECK_SW_STATUS' },
        [messageChannel.port2]
      );

      // Also check for cached share data
      const cacheChannel = new MessageChannel();
      cacheChannel.port1.onmessage = async (event) => {
        this.shareDebug.log('share-target', 'Cache data received', event.data);

        // If there are cache keys, try to find the most recent one
        if (event.data.keys && event.data.keys.length > 0) {
          const keys = event.data.keys as string[];
          // Sort by timestamp (assuming URL format /shared-content/timestamp)
          const sorted = keys.sort().reverse();
          const latestKey = sorted[0];

          // Extract the ID from the URL
          const match = latestKey.match(/\/shared-content\/(\d+)/);
          if (match) {
            const id = match[1];
            this.shareDebug.log('share-target', 'Found cached share data, loading', { id });
            alert(`[DEBUG] Found cached share data with ID: ${id}. Loading...`);
            await this.handlePostData(id);
          }
        }
      };

      navigator.serviceWorker.controller.postMessage(
        { type: 'GET_CACHED_SHARE_DATA' },
        [cacheChannel.port2]
      );

      // Also directly check the cache from the client
      const cache = await caches.open('nostria-share-target');
      const cacheKeys = await cache.keys();
      this.shareDebug.log('share-target', 'Direct cache check', {
        keys: cacheKeys.map(k => k.url)
      });

    } catch (err: any) {
      this.shareDebug.log('share-target', 'SW/Cache check failed', { error: err.message });
    }
  }

  /**
   * Fallback method to try reading shared data via clipboard API
   * This can work in some TWA scenarios where POST doesn't go through SW
   */
  private async tryClipboardFallback(): Promise<void> {
    try {
      // Check if there's data in the Clipboard API
      if (navigator.clipboard && 'read' in navigator.clipboard) {
        const clipboardItems = await navigator.clipboard.read();
        this.shareDebug.log('share-target', 'Clipboard read attempted', {
          itemsCount: clipboardItems.length,
          types: clipboardItems.map(item => item.types)
        });
      }
    } catch (err: any) {
      this.shareDebug.log('share-target', 'Clipboard fallback failed', { error: err.message });
    }
  }

  private showDebugDialog(title: string, message: string): void {
    if (!DEBUG_SHARE_TARGET) return;

    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: `[DEBUG] ${title}`,
        message: message,
        confirmText: 'OK',
        hideCancel: true
      }
    });
  }

  private handleShare() {
    this.route.queryParams.pipe(take(1)).subscribe(async params => {
      const id = params['id'];
      const allParams = JSON.stringify(params);

      this.shareDebug.log('share-target', 'handleShare called', { id, allParams });
      this.showDebugDialog('Query Params', `ID: ${id || 'none'}\nAll params: ${allParams}`);

      if (id) {
        await this.handlePostData(id);
      } else {
        const title = params['title'];
        const text = params['text'];
        const url = params['url'];

        this.shareDebug.log('share-target', 'GET Share Data', { title, text, url });
        this.showDebugDialog('GET Share Data', `Title: ${title || 'none'}\nText: ${text || 'none'}\nURL: ${url || 'none'}`);

        this.openDialog(title, text, url);
      }
    });
  }

  private async handlePostData(id: string) {
    try {
      this.shareDebug.log('share-target', 'handlePostData started', { id });

      // First try the server API (for server-side handling)
      let payload = await this.tryServerApi(id);
      
      // If server doesn't have it, try the service worker cache
      if (!payload) {
        payload = await this.tryCacheApi(id);
      }

      if (!payload) {
        this.shareDebug.log('share-target', 'No data found in server or cache');
        this.showDebugDialog('No Data', 'Could not find shared data in server or cache.');
        this.openDialog();
        return;
      }

      const debugInfo = {
        title: payload.title || 'none',
        text: payload.text || 'none',
        url: payload.url || 'none',
        filesCount: payload.files?.length || 0,
        files: payload.files?.map((f: any) => ({
          name: f.name,
          type: f.type,
          size: f.size || 0,
          dataLength: f.data?.length || 0
        })) || []
      };

      this.shareDebug.log('share-target', 'Payload received', debugInfo);
      this.showDebugDialog('POST Share Data',
        `Title: ${debugInfo.title}\n` +
        `Text: ${debugInfo.text}\n` +
        `URL: ${debugInfo.url}\n` +
        `Files: ${debugInfo.filesCount}\n` +
        `Details: ${JSON.stringify(debugInfo.files, null, 2)}`
      );

      const title = payload.title as string;
      const text = payload.text as string;
      const url = payload.url as string;

      const files: File[] = [];
      if (payload.files && Array.isArray(payload.files)) {
        for (const fileData of payload.files) {
          // Handle both base64 (server) and ArrayBuffer (SW cache) formats
          let blobData: ArrayBuffer;
          if (typeof fileData.data === 'string') {
            // Base64 from server
            const binaryString = atob(fileData.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            blobData = bytes.buffer as ArrayBuffer;
          } else {
            // Array from SW cache
            blobData = new Uint8Array(fileData.data).buffer as ArrayBuffer;
          }
          
          const blob = new Blob([blobData], { type: fileData.type });
          const file = new File([blob], fileData.name, {
            type: fileData.type,
            lastModified: fileData.lastModified || Date.now()
          });
          files.push(file);
          this.shareDebug.log('share-target', 'File reconstructed', {
            name: file.name,
            type: file.type,
            size: file.size
          });
        }
      }

      // Open the note editor dialog with the shared content
      this.openDialog(title, text, url, files);
    } catch (error: any) {
      this.shareDebug.log('share-target', 'Error handling POST data', { error: error.message, stack: error.stack });
      this.showDebugDialog('Error', `Error: ${error.message}`);
      this.openDialog();
    }
  }

  private async tryServerApi(id: string): Promise<any | null> {
    try {
      this.shareDebug.log('share-target', 'Trying server API', { id });
      const response = await fetch(`/api/share-target/${id}`);
      
      if (!response.ok) {
        this.shareDebug.log('share-target', 'Server API returned not OK', { status: response.status });
        return null;
      }
      
      const data = await response.json();
      this.shareDebug.log('share-target', 'Server API returned data', { 
        hasTitle: !!data.title,
        hasText: !!data.text,
        hasUrl: !!data.url,
        filesCount: data.files?.length || 0
      });
      return data;
    } catch (err: any) {
      this.shareDebug.log('share-target', 'Server API error', { error: err.message });
      return null;
    }
  }

  private async tryCacheApi(id: string): Promise<any | null> {
    try {
      this.shareDebug.log('share-target', 'Trying SW cache', { id });
      
      const cache = await caches.open('nostria-share-target');
      const cacheUrl = `/shared-content/${id}`;

      // List all cache entries for debugging
      const keys = await cache.keys();
      const cacheKeys = keys.map(k => k.url);
      this.shareDebug.log('share-target', 'Cache keys', { cacheKeys, lookingFor: cacheUrl });

      const response = await cache.match(cacheUrl);
      this.shareDebug.log('share-target', 'Cache response', { found: !!response });

      if (!response) {
        return null;
      }

      return await response.json();
    } catch (err: any) {
      this.shareDebug.log('share-target', 'Cache API error', { error: err.message });
      return null;
    }
  }

  private openDialog(title?: string, text?: string, url?: string, files?: File[]) {
    let content = '';
    if (title) content += title + '\n';
    if (text) content += text + '\n';
    if (url) content += url;
    content = content.trim();

    this.shareDebug.log('share-target', 'openDialog', { content, filesCount: files?.length || 0 });

    if (content || (files && files.length > 0)) {
      this.customDialog.open(NoteEditorDialogComponent, {
        title: 'Create Note',
        headerIcon: this.accountState.profile()?.data?.picture || '',
        data: { content, files },
        width: '680px',
        maxWidth: '95vw',
        disableClose: true
      });
    } else {
      this.shareDebug.log('share-target', 'No content to share');
      this.showDebugDialog('No Content', 'No content or files to share');
    }

    this.router.navigate(['/'], { replaceUrl: true });
  }
}
