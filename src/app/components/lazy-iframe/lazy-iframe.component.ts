import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  effect,
  inject,
  input,
  signal,
  ViewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { SafeResourceUrl } from '@angular/platform-browser';
import { IntersectionObserverService } from '../../services/intersection-observer.service';

/**
 * Lazy iframe that only mounts when scrolled into view and unmounts when far
 * offscreen. Greatly reduces DOM node / event listener counts on feeds with
 * many YouTube/Tidal/Spotify embeds.
 *
 * - Renders a lightweight placeholder (`<div>`) until the first intersection.
 * - Unmounts the iframe after it has stayed fully offscreen for
 *   `unmountDelayMs` (hysteresis) so small scroll jitter does not thrash.
 * - Pass the raw URL via [src]; sanitization is handled internally.
 */
@Component({
  selector: 'app-lazy-iframe',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #slot class="lazy-iframe-slot" aria-hidden="true"></div>`,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .lazy-iframe-slot {
        width: 100%;
        height: 100%;
        display: block;
      }
      .lazy-iframe-slot:empty {
        background: var(--mat-sys-surface-container-low, #0003);
      }
      .lazy-iframe-slot > iframe {
        width: 100%;
        height: 100%;
        border: 0;
        display: block;
      }
    `,
  ],
})
export class LazyIframeComponent implements OnInit, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly intersection = inject(IntersectionObserverService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  @ViewChild('slot', { static: true }) slotRef?: ElementRef<HTMLDivElement>;

  readonly src = input<string | SafeResourceUrl | null | undefined>(null);
  readonly allow = input<string | null | undefined>(null);
  readonly referrerpolicy = input<string | null | undefined>(null);
  readonly sandbox = input<string | null | undefined>(null);
  readonly title = input<string | null | undefined>(null);
  readonly allowfullscreen = input<boolean>(false);
  /** Margin around viewport to start mounting (default: 300px). */
  readonly rootMargin = input<string>('300px');
  /** Milliseconds offscreen before unmounting the iframe (default: 1500). */
  readonly unmountDelayMs = input<number>(1500);

  private readonly isIntersecting = signal(false);
  private readonly hasEverIntersected = signal(false);
  private unmountTimer: ReturnType<typeof setTimeout> | null = null;
  private observed = false;
  private mountedIframe: HTMLIFrameElement | null = null;

  constructor() {
    // React to mount/unmount signal changes and src changes.
    effect(() => {
      const shouldMount = !!this.src() && this.hasEverIntersected() && this.isIntersecting();
      const currentSrc = this.resolveSrc();
      if (shouldMount && currentSrc) {
        this.mount(currentSrc);
      } else {
        this.unmount();
      }
    });
  }

  private resolveSrc(): string | null {
    const url = this.src();
    if (!url) return null;
    if (typeof url === 'string') return url;
    // SafeResourceUrl has a `changingThisBreaksApplicationSecurity` internal
    // string — read it defensively via a toString fallback.
    const s = (url as unknown as { changingThisBreaksApplicationSecurity?: string })
      .changingThisBreaksApplicationSecurity;
    return typeof s === 'string' ? s : String(url);
  }

  private mount(url: string): void {
    const slot = this.slotRef?.nativeElement;
    if (!slot) return;
    // If we already have an iframe with the same src, leave it alone.
    if (this.mountedIframe && this.mountedIframe.src === url) return;
    this.unmount();
    const iframe = document.createElement('iframe');
    // Attributes are set directly — not through Angular bindings — so the
    // NG0910 restriction on `allow` does not apply.
    iframe.setAttribute('src', url);
    const allowVal = this.allow();
    if (allowVal) iframe.setAttribute('allow', allowVal);
    const refPol = this.referrerpolicy();
    if (refPol) iframe.setAttribute('referrerpolicy', refPol);
    const sandbox = this.sandbox();
    if (sandbox) iframe.setAttribute('sandbox', sandbox);
    const titleVal = this.title();
    if (titleVal) iframe.setAttribute('title', titleVal);
    if (this.allowfullscreen()) iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('loading', 'lazy');
    // Imperatively-created elements don't pick up Angular's scoped component
    // styles, so size the iframe inline to fill its slot.
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    iframe.style.display = 'block';
    slot.appendChild(iframe);
    this.mountedIframe = iframe;
  }

  private unmount(): void {
    if (this.mountedIframe) {
      // Clear src first to stop network/media activity before removing.
      try {
        this.mountedIframe.src = 'about:blank';
      } catch {
        /* ignore */
      }
      this.mountedIframe.remove();
      this.mountedIframe = null;
    }
  }

  ngOnInit(): void {
    if (!this.isBrowser || this.observed) return;
    const el = this.host.nativeElement;
    if (!el) return;
    this.observed = true;
    this.intersection.observe(
      el,
      (isIntersecting) => {
        if (isIntersecting) {
          if (this.unmountTimer) {
            clearTimeout(this.unmountTimer);
            this.unmountTimer = null;
          }
          this.hasEverIntersected.set(true);
          this.isIntersecting.set(true);
        } else {
          if (this.unmountTimer) clearTimeout(this.unmountTimer);
          const delay = this.unmountDelayMs();
          if (delay <= 0) {
            this.isIntersecting.set(false);
          } else {
            this.unmountTimer = setTimeout(() => {
              this.isIntersecting.set(false);
              this.unmountTimer = null;
            }, delay);
          }
        }
      },
      { rootMargin: this.rootMargin() }
    );
  }

  ngOnDestroy(): void {
    if (this.unmountTimer) {
      clearTimeout(this.unmountTimer);
      this.unmountTimer = null;
    }
    if (this.observed && this.isBrowser) {
      this.intersection.unobserve(this.host.nativeElement);
    }
    this.unmount();
  }
}
