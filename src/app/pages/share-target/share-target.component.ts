import { Component, effect, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NoteEditorDialogComponent } from '../../components/note-editor-dialog/note-editor-dialog.component';
import { CustomDialogService } from '../../services/custom-dialog.service';
import { AccountStateService } from '../../services/account-state.service';
import { ApplicationService } from '../../services/application.service';
import { take } from 'rxjs/operators';

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

  constructor() {
    effect(() => {
      const initialized = this.app.initialized();
      const authenticated = this.app.authenticated();

      if (initialized && authenticated) {
        this.handleShare();
      } else if (initialized && !authenticated) {
        // If not authenticated, redirect to home which will likely show login or public feed
        this.router.navigate(['/'], { replaceUrl: true });
      }
    });
  }

  private handleShare() {
    this.route.queryParams.pipe(take(1)).subscribe(async params => {
      const id = params['id'];

      if (id) {
        // Handle POST data from IndexedDB
        await this.handlePostData(id);
      } else {
        // Handle GET data (fallback or if browser supports mixed)
        const title = params['title'];
        const text = params['text'];
        const url = params['url'];
        this.openDialog(title, text, url);
      }
    });
  }

  private async handlePostData(id: string) {
    try {
      const cache = await caches.open('nostria-share-target');
      const cacheUrl = `/shared-content/${id}`;
      const response = await cache.match(cacheUrl);

      if (response) {
        const formData = await response.formData();
        const title = formData.get('title') as string;
        const text = formData.get('text') as string;
        const url = formData.get('url') as string;
        const files = formData.getAll('files') as File[];

        this.openDialog(title, text, url, files);

        // Clean up
        await cache.delete(cacheUrl);
      } else {
        this.router.navigate(['/'], { replaceUrl: true });
      }
    } catch (error) {
      console.error('Error reading shared content:', error);
      this.router.navigate(['/'], { replaceUrl: true });
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
        data: { content, files }, // NoteEditorDialog needs to support 'files' in data
        width: '680px',
        maxWidth: '95vw',
        disableClose: true
      });
    }

    // Navigate to home to clear the share URL and show the feed
    this.router.navigate(['/'], { replaceUrl: true });
  }
}
