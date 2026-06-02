import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class PublicUrlService {
  private readonly appOrigin = 'https://nostria.app';

  getAppOrigin(): string {
    return this.appOrigin;
  }

  build(pathOrUrl: string): string {
    if (!pathOrUrl) {
      return this.appOrigin;
    }

    return this.toCanonicalUrl(pathOrUrl);
  }

  toCanonicalUrl(url: string): string {
    if (!url) {
      return this.appOrigin;
    }

    const parsedUrl = new URL(url, this.appOrigin);

    if (this.isTauriLocalUrl(parsedUrl)) {
      return new URL(`${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`, this.appOrigin).toString();
    }

    return parsedUrl.toString();
  }

  private isTauriLocalUrl(url: URL): boolean {
    return url.hostname === 'tauri.localhost' || url.protocol === 'tauri:' || url.protocol === 'asset:';
  }
}
