import { Component, effect, inject } from '@angular/core';
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

  constructor() {
    // Log that the component was created with current URL info
    this.shareDebug.log('share-target', 'ShareTargetComponent created', {
      fullUrl: window.location.href,
      pathname: window.location.pathname,
      search: window.location.search,
      timestamp: new Date().toISOString()
    });

    // Show immediate debug alert so we know the component loaded
    alert(`[DEBUG] ShareTarget component loaded!\n\nURL: ${window.location.href}\n\nCheck Settings > Logs for more details.`);

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

      const cache = await caches.open('nostria-share-target');
      const cacheUrl = `/shared-content/${id}`;

      // List all cache entries for debugging
      const keys = await cache.keys();
      const cacheKeys = keys.map(k => k.url);
      this.shareDebug.log('share-target', 'Cache keys', { cacheKeys, lookingFor: cacheUrl });

      const response = await cache.match(cacheUrl);
      this.shareDebug.log('share-target', 'Cache response', { found: !!response });

      if (response) {
        const payload = await response.json();

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
            const uint8Array = new Uint8Array(fileData.data);
            const blob = new Blob([uint8Array], { type: fileData.type });
            const file = new File([blob], fileData.name, {
              type: fileData.type,
              lastModified: fileData.lastModified
            });
            files.push(file);
            this.shareDebug.log('share-target', 'File reconstructed', {
              name: file.name,
              type: file.type,
              size: file.size
            });
          }
        }

        this.openDialog(title, text, url, files);
        await cache.delete(cacheUrl);
      } else {
        this.shareDebug.log('share-target', 'Cache miss', { id, cacheUrl, availableKeys: cacheKeys });
        this.showDebugDialog('Cache Miss', `No data found for ID: ${id}\nAvailable keys: ${cacheKeys.join(', ') || 'none'}`);
        this.router.navigate(['/'], { replaceUrl: true });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.shareDebug.log('share-target', 'Error', { error: errorMsg });
      this.showDebugDialog('Error', `Error: ${errorMsg}`);
      this.router.navigate(['/'], { replaceUrl: true });
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
