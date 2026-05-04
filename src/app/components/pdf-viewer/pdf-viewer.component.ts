import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-pdf-viewer',
  imports: [MatButtonModule, MatIconModule],
  templateUrl: './pdf-viewer.component.html',
  styleUrl: './pdf-viewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PdfViewerComponent {
  src = input.required<string>();
  title = input<string>('PDF document');
  compact = input<boolean>(false);

  private sanitizer = inject(DomSanitizer);

  safeSrc = computed<SafeResourceUrl | null>(() => {
    const url = this.src().trim();
    if (!this.isEmbeddablePdfUrl(url)) {
      return null;
    }

    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  fileName = computed(() => {
    const title = this.title().trim();
    if (title && title !== 'PDF document') {
      return title;
    }

    try {
      const url = new URL(this.src(), globalThis.location?.origin);
      const pathName = decodeURIComponent(url.pathname.split('/').pop() || '');
      return pathName || 'PDF document';
    } catch {
      return 'PDF document';
    }
  });

  openInNewTab(): void {
    const url = this.src().trim();
    if (!url) {
      return;
    }

    globalThis.open(url, '_blank', 'noopener,noreferrer');
  }

  private isEmbeddablePdfUrl(url: string): boolean {
    if (!url) {
      return false;
    }

    if (url.startsWith('data:')) {
      return url.toLowerCase().startsWith('data:application/pdf');
    }

    if (url.startsWith('blob:')) {
      return true;
    }

    try {
      const parsedUrl = new URL(url, globalThis.location?.origin);
      return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
    } catch {
      return false;
    }
  }
}
