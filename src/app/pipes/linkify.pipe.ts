import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

/**
 * Linkify pipe - transforms URLs in text into clickable links
 * Used for chat messages to make URLs interactive
 */
@Pipe({
  name: 'linkify',
  standalone: true
})
export class LinkifyPipe implements PipeTransform {
  private sanitizer = inject(DomSanitizer);

  transform(text: string): SafeHtml {
    if (!text) return '';

    // URL regex pattern - matches http/https URLs
    const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;

    // Escape HTML entities first to prevent XSS
    const escaped = this.escapeHtml(text);

    // Replace URLs with anchor tags
    const linked = escaped.replace(urlRegex, (url) => {
      // Clean up any trailing punctuation that might have been captured
      let cleanUrl = url;
      const trailingPunctuation = /[.,;:!?)]+$/;
      const trailing = cleanUrl.match(trailingPunctuation);
      if (trailing) {
        cleanUrl = cleanUrl.slice(0, -trailing[0].length);
      }

      const displayUrl = this.truncateUrl(cleanUrl);
      const trailingText = trailing ? trailing[0] : '';
      return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="message-link">${displayUrl}</a>${trailingText}`;
    });

    return this.sanitizer.bypassSecurityTrustHtml(linked);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private truncateUrl(url: string, maxLength = 50): string {
    if (url.length <= maxLength) return url;

    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname;
      const path = urlObj.pathname + urlObj.search;

      if (domain.length + 10 >= maxLength) {
        return domain.slice(0, maxLength - 3) + '...';
      }

      const availablePathLength = maxLength - domain.length - 3;
      if (path.length > availablePathLength) {
        return domain + path.slice(0, availablePathLength) + '...';
      }

      return domain + path;
    } catch {
      return url.slice(0, maxLength - 3) + '...';
    }
  }
}
