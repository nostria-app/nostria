import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isTauri } from '@tauri-apps/api/core';

@Injectable({
  providedIn: 'root',
})
export class ExternalLinkService {
  private readonly document = inject(DOCUMENT);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private initialized = false;
  private originalWindowOpen?: Window['open'];
  private openerModulePromise?: Promise<typeof import('@tauri-apps/plugin-opener')>;

  initialize(): void {
    if (this.initialized || !this.isBrowser || !isTauri()) {
      return;
    }

    this.initialized = true;
    this.originalWindowOpen = window.open.bind(window);
    window.open = ((url?: string | URL, target?: string, features?: string) => {
      if (url !== undefined && this.shouldOpenExternally(url)) {
        void this.openExternally(url.toString());
        return null;
      }

      return this.originalWindowOpen?.(url as string | URL, target, features) ?? null;
    }) as Window['open'];

    this.document.addEventListener('click', this.handleDocumentClick, true);
  }

  private readonly handleDocumentClick = (event: Event): void => {
    if (!(event instanceof MouseEvent) || event.defaultPrevented || event.button !== 0) {
      return;
    }

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download')) {
      return;
    }

    const href = anchor.getAttribute('href');
    if (!href || !this.shouldOpenExternally(href)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    void this.openExternally(href);
  };

  private shouldOpenExternally(url: string | URL): boolean {
    const normalizedUrl = this.toUrl(url);
    if (!normalizedUrl) {
      return false;
    }

    if (normalizedUrl.protocol === 'mailto:' || normalizedUrl.protocol === 'tel:' || normalizedUrl.protocol === 'nostr:') {
      return true;
    }

    if (normalizedUrl.protocol !== 'http:' && normalizedUrl.protocol !== 'https:') {
      return false;
    }

    return normalizedUrl.origin !== window.location.origin;
  }

  private toUrl(url: string | URL): URL | null {
    try {
      return url instanceof URL ? url : new URL(url, window.location.href);
    } catch {
      return null;
    }
  }

  private async openExternally(url: string): Promise<void> {
    const openerModule = await this.getOpenerModule();
    await openerModule.openUrl(url);
  }

  private getOpenerModule(): Promise<typeof import('@tauri-apps/plugin-opener')> {
    this.openerModulePromise ??= import('@tauri-apps/plugin-opener');
    return this.openerModulePromise;
  }
}