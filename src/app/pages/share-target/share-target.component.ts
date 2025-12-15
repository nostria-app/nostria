import { Component, effect, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NoteEditorDialogComponent } from '../../components/note-editor-dialog/note-editor-dialog.component';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { take } from 'rxjs/operators';
import { MatDialog } from '@angular/material/dialog';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';

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

  constructor() {
    effect(() => {
      const initialized = this.app.initialized();
      const authenticated = this.app.authenticated();

      if (DEBUG_SHARE_TARGET) {
        console.log('[ShareTarget] Effect triggered:', { initialized, authenticated });
      }

      if (initialized && authenticated) {
        this.handleShare();
      } else if (initialized && !authenticated) {
        // If not authenticated, redirect to home which will likely show login or public feed
        this.router.navigate(['/'], { replaceUrl: true });
      }
    });
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

      if (DEBUG_SHARE_TARGET) {
        console.log('[ShareTarget] handleShare called with params:', params);
        this.showDebugDialog('Query Params', `ID: ${id || 'none'}\nAll params: ${JSON.stringify(params, null, 2)}`);
      }

      if (id) {
        // Handle POST data from cache
        await this.handlePostData(id);
      } else {
        // Handle GET data (fallback or if browser supports mixed)
        const title = params['title'];
        const text = params['text'];
        const url = params['url'];

        if (DEBUG_SHARE_TARGET) {
          this.showDebugDialog('GET Share Data', `Title: ${title || 'none'}\nText: ${text || 'none'}\nURL: ${url || 'none'}`);
        }

        this.openDialog(title, text, url);
      }
    });
  }

  private async handlePostData(id: string) {
    try {
      if (DEBUG_SHARE_TARGET) {
        console.log('[ShareTarget] handlePostData called with id:', id);
      }

      const cache = await caches.open('nostria-share-target');
      const cacheUrl = `/shared-content/${id}`;

      if (DEBUG_SHARE_TARGET) {
        // List all cache entries for debugging
        const keys = await cache.keys();
        console.log('[ShareTarget] Cache keys:', keys.map(k => k.url));
      }

      const response = await cache.match(cacheUrl);

      if (DEBUG_SHARE_TARGET) {
        console.log('[ShareTarget] Cache response found:', !!response);
      }

      if (response) {
        // Parse the JSON payload
        const payload = await response.json();

        if (DEBUG_SHARE_TARGET) {
          const debugInfo = {
            title: payload.title || 'none',
            text: payload.text || 'none',
            url: payload.url || 'none',
            filesCount: payload.files?.length || 0,
            files: payload.files?.map((f: any) => ({
              name: f.name,
              type: f.type,
              size: f.size,
              dataLength: f.data?.length || 0
            })) || []
          };
          console.log('[ShareTarget] Payload:', debugInfo);
          this.showDebugDialog('POST Share Data (from cache)',
            `Title: ${debugInfo.title}\n` +
            `Text: ${debugInfo.text}\n` +
            `URL: ${debugInfo.url}\n` +
            `Files count: ${debugInfo.filesCount}\n` +
            `Files: ${JSON.stringify(debugInfo.files, null, 2)}`
          );
        }

        const title = payload.title as string;
        const text = payload.text as string;
        const url = payload.url as string;

        // Reconstruct File objects from serialized data
        const files: File[] = [];
        if (payload.files && Array.isArray(payload.files)) {
          for (const fileData of payload.files) {
            const uint8Array = new Uint8Array(fileData.data);
            const blob = new Blob([uint8Array], { type: fileData.type });
            const file = new File([blob], fileData.name, {
              type: fileData.type,
              lastModified: fileData.lastModified
            });
            files.push(file);

            if (DEBUG_SHARE_TARGET) {
              console.log('[ShareTarget] Reconstructed file:', file.name, file.type, file.size);
            }
          }
        }

        this.openDialog(title, text, url, files);

        // Clean up
        await cache.delete(cacheUrl);
      } else {
        if (DEBUG_SHARE_TARGET) {
          this.showDebugDialog('Cache Miss', `No cached data found for ID: ${id}\nCache URL: ${cacheUrl}`);
        }
        this.router.navigate(['/'], { replaceUrl: true });
      }
    } catch (error) {
      console.error('Error reading shared content:', error);
      if (DEBUG_SHARE_TARGET) {
        this.showDebugDialog('Error', `Error reading shared content:\n${error instanceof Error ? error.message : String(error)}`);
      }
      this.router.navigate(['/'], { replaceUrl: true });
    }
  }

  private openDialog(title?: string, text?: string, url?: string, files?: File[]) {
    let content = '';
    if (title) content += title + '\n';
    if (text) content += text + '\n';
    if (url) content += url;

    content = content.trim();

    if (DEBUG_SHARE_TARGET) {
      console.log('[ShareTarget] openDialog called:', { content, filesCount: files?.length || 0 });
    }

    if (content || (files && files.length > 0)) {
      this.customDialog.open(NoteEditorDialogComponent, {
        title: 'Create Note',
        headerIcon: this.accountState.profile()?.data?.picture || '',
        data: { content, files },
        width: '680px',
        maxWidth: '95vw',
        disableClose: true
      });
    } else if (DEBUG_SHARE_TARGET) {
      this.showDebugDialog('No Content', 'No content or files to share - dialog not opened');
    }

    // Navigate to home to clear the share URL and show the feed
    this.router.navigate(['/'], { replaceUrl: true });
  }
}
