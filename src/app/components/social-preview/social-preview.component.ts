import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, PLATFORM_ID, effect, inject, input, signal, viewChild } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { OpenGraphData, OpenGraphService } from '../../services/opengraph.service';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ThemeService } from '../../services/theme.service';
import { isXStatusUrl } from '../../utils/url-cleaner';

@Component({
  selector: 'app-social-preview',
  imports: [MatCardModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './social-preview.component.html',
  styleUrl: './social-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SocialPreviewComponent {
  private static widgetsScriptPromise: Promise<void> | null = null;
  private xEmbedRenderToken = 0;

  openGraphService = inject(OpenGraphService);
  private themeService = inject(ThemeService);
  private sanitizer = inject(DomSanitizer);
  private document = inject(DOCUMENT);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private xEmbedHost = viewChild<ElementRef<HTMLElement>>('xEmbedHost');

  /** When true, renders a smaller preview with thumbnail + title + URL only (no description). */
  compact = input<boolean>(false);
  prominentImage = input<boolean>(false);
  singleLinkLayout = input<boolean>(false);

  url = input<string>('');
  previewData = input<OpenGraphData | null>(null);
  preview = signal<OpenGraphData>({ url: '', loading: false, error: false });
  safeEmbedHtml = signal<SafeHtml | null>(null);

  constructor() {
    effect(() => {
      const providedPreview = this.previewData();

      if (providedPreview) {
        this.setPreviewData(providedPreview);
        return;
      }

      const url = this.url();
      const isXUrl = isXStatusUrl(url);

      if (isXUrl) {
        this.themeService.darkMode();
        this.openGraphService.clearCache(url);
      }

      this.loadSocialPreview(url);
    });

    effect(() => {
      const preview = this.preview();
      const embedHost = this.xEmbedHost()?.nativeElement;

      if (!this.isBrowser || preview.previewType !== 'x-post' || !preview.embedHtml || !embedHost) {
        return;
      }

      const renderToken = ++this.xEmbedRenderToken;

      queueMicrotask(() => {
        void this.renderXEmbed(renderToken);
      });
    });
  }

  private setPreviewData(data: OpenGraphData): void {
    this.safeEmbedHtml.set(this.buildSafeEmbedHtml(data.embedHtml));
    this.preview.set({
      ...data,
      loading: false,
    });
  }

  async loadSocialPreview(url: string): Promise<void> {
    if (!url) {
      this.preview.set({ url: '', loading: false, error: false });
      this.safeEmbedHtml.set(null);
      return;
    }

    this.preview.update(prev => ({
      ...prev,
      url,
      loading: true,
      error: false,
    }));

    try {
      const data = await this.openGraphService.getOpenGraphData(url);
      this.setPreviewData(data);
    } catch (error) {
      this.safeEmbedHtml.set(null);
      this.preview.update(prev => ({ ...prev, loading: false, error: true }));
      console.error('Failed to load preview:', error);
    }
  }

  private buildSafeEmbedHtml(embedHtml?: string): SafeHtml | null {
    if (!embedHtml) {
      return null;
    }

    const sanitizedHtml = DOMPurify.sanitize(embedHtml, {
      ADD_ATTR: ['data-dnt', 'data-theme', 'dir'],
    });

    return this.sanitizer.bypassSecurityTrustHtml(sanitizedHtml);
  }

  private async renderXEmbed(renderToken: number): Promise<void> {
    try {
      const embedHost = this.xEmbedHost()?.nativeElement;
      if (!embedHost || !embedHost.isConnected || renderToken !== this.xEmbedRenderToken) {
        return;
      }

      if (!embedHost.querySelector('blockquote.twitter-tweet')) {
        return;
      }

      await this.ensureWidgetsScript();

      const currentEmbedHost = this.xEmbedHost()?.nativeElement;
      if (!currentEmbedHost || !currentEmbedHost.isConnected || renderToken !== this.xEmbedRenderToken) {
        return;
      }

      if (!currentEmbedHost.querySelector('blockquote.twitter-tweet')) {
        return;
      }

      const twitterWindow = window as Window & {
        twttr?: {
          widgets?: {
            load: (element?: HTMLElement) => void;
          };
        };
      };

      twitterWindow.twttr?.widgets?.load(currentEmbedHost);
    } catch (error) {
      console.warn('Failed to initialize X embed widgets:', error);
    }
  }

  private ensureWidgetsScript(): Promise<void> {
    if (!this.isBrowser) {
      return Promise.resolve();
    }

    const twitterWindow = window as Window & {
      twttr?: {
        widgets?: {
          load: (element?: HTMLElement) => void;
        };
      };
    };

    if (twitterWindow.twttr?.widgets?.load) {
      return Promise.resolve();
    }

    if (SocialPreviewComponent.widgetsScriptPromise) {
      return SocialPreviewComponent.widgetsScriptPromise;
    }

    SocialPreviewComponent.widgetsScriptPromise = new Promise<void>((resolve, reject) => {
      const existingScript = this.document.querySelector('script[data-x-widgets="true"]') as HTMLScriptElement | null;

      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(), { once: true });
        existingScript.addEventListener('error', () => reject(new Error('Failed to load X widgets script')), { once: true });
        return;
      }

      const script = this.document.createElement('script');
      script.async = true;
      script.src = 'https://platform.twitter.com/widgets.js';
      script.charset = 'utf-8';
      script.dataset['xWidgets'] = 'true';
      script.addEventListener('load', () => resolve(), { once: true });
      script.addEventListener('error', () => reject(new Error('Failed to load X widgets script')), { once: true });
      this.document.body.appendChild(script);
    });

    return SocialPreviewComponent.widgetsScriptPromise;
  }
}
