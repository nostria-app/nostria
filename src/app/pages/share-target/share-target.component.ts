import { Component, effect, inject, PLATFORM_ID, Inject, ChangeDetectionStrategy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { NoteEditorDialogComponent } from '../../components/note-editor-dialog/note-editor-dialog.component';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { take } from 'rxjs/operators';

@Component({
  selector: 'app-share-target',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class ShareTargetComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private customDialog = inject(CustomDialogService);
  private accountState = inject(AccountStateService);
  private app = inject(ApplicationService);
  private isBrowser: boolean;

  constructor(@Inject(PLATFORM_ID) platformId: object) {
    this.isBrowser = isPlatformBrowser(platformId);

    if (!this.isBrowser) return;

    effect(() => {
      const initialized = this.app.initialized();
      const authenticated = this.app.authenticated();

      if (initialized && authenticated) {
        this.handleShare();
      } else if (initialized && !authenticated) {
        this.router.navigate(['/'], { replaceUrl: true });
      }
    });
  }

  private handleShare() {
    this.route.queryParams.pipe(take(1)).subscribe(async params => {
      const id = params['id'];

      if (id) {
        // POST data was received via server-side handling
        await this.handlePostData(id);
      } else {
        // GET share data (text/URL sharing)
        const title = params['title'];
        const text = params['text'];
        const url = params['url'];
        this.openDialog(title, text, url);
      }
    });
  }

  private async handlePostData(id: string) {
    try {
      // First try the server API (for server-side handling of POST)
      let payload = await this.tryServerApi(id);

      // If server doesn't have it, try the service worker cache
      if (!payload) {
        payload = await this.tryCacheApi(id);
      }

      if (!payload) {
        this.openDialog();
        return;
      }

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
        }
      }

      this.openDialog(title, text, url, files);
    } catch (error) {
      console.error('[ShareTarget] Error handling POST data:', error);
      this.openDialog();
    }
  }

  private async tryServerApi(id: string): Promise<any | null> {
    try {
      const response = await fetch(`/api/share-target/${id}`);

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }

  private async tryCacheApi(id: string): Promise<any | null> {
    try {
      const cache = await caches.open('nostria-share-target');
      const cacheUrl = `/shared-content/${id}`;
      const response = await cache.match(cacheUrl);

      if (!response) {
        return null;
      }

      const data = await response.json();
      // Clean up the cache entry after use
      await cache.delete(cacheUrl);
      return data;
    } catch {
      return null;
    }
  }

  private openDialog(title?: string, text?: string, url?: string, files?: File[]) {
    let content = '';
    if (title) content += title + '\n';
    if (text) content += text + '\n';
    if (url) content += url;
    content = content.trim();

    if (content || (files && files.length > 0)) {
      this.customDialog.open(NoteEditorDialogComponent, {
        title: 'Create Note',
        headerIcon: this.accountState.profile()?.data?.picture || '',
        data: { content, files },
        width: '680px',
        maxWidth: '95vw',
        disableClose: true
      });
    }

    this.router.navigate(['/'], { replaceUrl: true });
  }
}
