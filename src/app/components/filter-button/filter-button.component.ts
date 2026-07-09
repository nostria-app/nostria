import {
  Component,
  input,
  signal,
  inject,
  PLATFORM_ID,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  OnDestroy,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { OverlayModule, ConnectedPosition } from '@angular/cdk/overlay';

/** Viewport width at or below which the filter panel goes fullscreen. */
const FULLSCREEN_BREAKPOINT_PX = 720;

/**
 * Unified filter button component used across all pages.
 * Displays a `tune` icon button that opens a CDK overlay panel.
 * The button highlights (lights up) when `active` is true, indicating
 * that the filter has been modified from its default state.
 *
 * On small screens the panel opens fullscreen so dense filter UIs
 * (e.g. Feeds) are not clipped.
 *
 * Usage:
 * ```html
 * <app-filter-button [active]="hasActiveFilters()" tooltip="Filter content">
 *   <app-my-filter-panel />
 * </app-filter-button>
 * ```
 */
@Component({
  selector: 'app-filter-button',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    OverlayModule,
  ],
  // Panel class is applied to the CDK overlay pane (outside :host), so these
  // styles must not be emulated/scoped.
  encapsulation: ViewEncapsulation.None,
  template: `
    <button
      mat-icon-button
      class="filter-trigger-button"
      cdkOverlayOrigin
      #filterTrigger="cdkOverlayOrigin"
      (click)="togglePanel()"
      [matTooltip]="tooltip()"
      [class.filter-active]="active()"
      [attr.aria-expanded]="panelOpen()"
      [attr.aria-haspopup]="true">
      <mat-icon>tune</mat-icon>
    </button>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="filterTrigger"
      [cdkConnectedOverlayOpen]="panelOpen()"
      [cdkConnectedOverlayHasBackdrop]="true"
      [cdkConnectedOverlayBackdropClass]="backdropClass()"
      [cdkConnectedOverlayPanelClass]="panelClass()"
      [cdkConnectedOverlayPositions]="panelPositions()"
      [cdkConnectedOverlayPush]="!isFullscreen()"
      [cdkConnectedOverlayViewportMargin]="isFullscreen() ? 0 : 8"
      [cdkConnectedOverlayWidth]="overlayWidth()"
      [cdkConnectedOverlayHeight]="overlayHeight()"
      (backdropClick)="closePanel()"
      (detach)="closePanel()">
      <div
        class="filter-overlay-shell"
        [class.filter-overlay-shell--fullscreen]="isFullscreen()"
        (click)="$event.stopPropagation()">
        @if (isFullscreen()) {
        <div class="filter-overlay-header">
          <span class="filter-overlay-title">{{ title() }}</span>
          <button
            mat-icon-button
            type="button"
            class="filter-overlay-close"
            (click)="closePanel()"
            aria-label="Close filters">
            <mat-icon>close</mat-icon>
          </button>
        </div>
        }
        <div class="filter-overlay-body">
          <ng-content></ng-content>
        </div>
      </div>
    </ng-template>
  `,
  styles: [`
    app-filter-button {
      display: inline-flex;
    }

    app-filter-button .filter-trigger-button.filter-active {
      color: var(--mat-sys-primary) !important;
      background: color-mix(in srgb, var(--mat-sys-primary) 12%, transparent) !important;
      border-radius: 50%;
    }

    .filter-overlay-shell {
      display: flex;
      flex-direction: column;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
    }

    .filter-overlay-shell--fullscreen {
      width: 100%;
      height: 100%;
      max-height: 100%;
      background: var(--mat-sys-surface-container);
    }

    .filter-overlay-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      flex-shrink: 0;
      padding: max(0.75rem, env(safe-area-inset-top, 0px)) 0.75rem 0.5rem 1rem;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container);
    }

    .filter-overlay-title {
      font-size: 1.05rem;
      color: var(--mat-sys-on-surface);
    }

    .filter-overlay-close {
      flex-shrink: 0;
    }

    .filter-overlay-body {
      min-height: 0;
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
    }

    .filter-overlay-shell--fullscreen .filter-overlay-body {
      overflow: hidden;
      /* Let the inner panel scroll within remaining viewport */
      height: 100%;
    }

    /* Force the CDK pane to cover the viewport (connected strategy offsets otherwise). */
    .cdk-overlay-pane.filter-overlay-panel--fullscreen {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100vw !important;
      width: 100dvw !important;
      height: 100vh !important;
      height: 100dvh !important;
      max-width: 100vw !important;
      max-width: 100dvw !important;
      max-height: 100vh !important;
      max-height: 100dvh !important;
      transform: none !important;
      pointer-events: auto;
    }

    .cdk-overlay-backdrop.filter-overlay-backdrop--fullscreen {
      background: rgba(0, 0, 0, 0.45);
    }

    /* Projected filter panels fill the fullscreen shell.
       !important beats emulated encapsulation on panel max-height (e.g. 400px / 75vh). */
    .filter-overlay-shell--fullscreen .filter-panel,
    .filter-overlay-shell--fullscreen app-feed-filter-panel,
    .filter-overlay-shell--fullscreen app-list-filter-menu,
    .filter-overlay-shell--fullscreen > .filter-overlay-body > * {
      width: 100% !important;
      max-width: none !important;
      height: 100% !important;
      max-height: none !important;
      flex: 1 1 auto !important;
      min-height: 0 !important;
      border-radius: 0 !important;
      border-left: none !important;
      border-right: none !important;
      border-bottom: none !important;
      box-sizing: border-box !important;
      overflow-y: auto !important;
      -webkit-overflow-scrolling: touch;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterButtonComponent implements OnDestroy {
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private mediaQuery: MediaQueryList | null = null;
  private readonly onMediaChange = () => this.syncViewportMode();

  /** Whether the filter is in an active (non-default) state */
  active = input(false);

  /** Tooltip text for the button */
  tooltip = input('Filter');

  /** Title shown in the fullscreen header on mobile */
  title = input('Filters');

  /** Whether the overlay panel is open */
  panelOpen = signal(false);

  /** Fullscreen layout for small viewports */
  isFullscreen = signal(false);

  /** Overlay pane width */
  overlayWidth = signal<string | number>('');

  /** Overlay pane height */
  overlayHeight = signal<string | number>('');

  panelClass = signal<string | string[]>('filter-overlay-panel');
  backdropClass = signal<string | string[]>('cdk-overlay-transparent-backdrop');

  /** CDK overlay positioning (desktop: below trigger; mobile overridden by CSS) */
  panelPositions = signal<ConnectedPosition[]>([
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
  ]);

  constructor() {
    if (this.isBrowser) {
      this.mediaQuery = window.matchMedia(`(max-width: ${FULLSCREEN_BREAKPOINT_PX}px)`);
      this.mediaQuery.addEventListener('change', this.onMediaChange);
      this.syncViewportMode();
    }
  }

  ngOnDestroy(): void {
    this.mediaQuery?.removeEventListener('change', this.onMediaChange);
  }

  private syncViewportMode(): void {
    if (!this.isBrowser) {
      return;
    }

    const fullscreen = window.innerWidth <= FULLSCREEN_BREAKPOINT_PX;
    this.isFullscreen.set(fullscreen);

    if (fullscreen) {
      this.overlayWidth.set('100vw');
      this.overlayHeight.set('100dvh');
      this.panelClass.set(['filter-overlay-panel', 'filter-overlay-panel--fullscreen']);
      this.backdropClass.set(['cdk-overlay-dark-backdrop', 'filter-overlay-backdrop--fullscreen']);
      // Any position is fine; CSS pins the pane to the viewport.
      this.panelPositions.set([
        { originX: 'center', originY: 'center', overlayX: 'center', overlayY: 'center' },
      ]);
    } else {
      this.overlayWidth.set('');
      this.overlayHeight.set('');
      this.panelClass.set('filter-overlay-panel');
      this.backdropClass.set('cdk-overlay-transparent-backdrop');
      this.panelPositions.set([
        { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
        { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 8 },
        { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -8 },
      ]);
    }
  }

  togglePanel(): void {
    this.syncViewportMode();
    this.panelOpen.update(v => !v);

    if (this.isBrowser && this.isFullscreen() && !this.panelOpen()) {
      // no-op when closing
    }

    // Prevent body scroll while fullscreen filter is open
    if (this.isBrowser) {
      document.body.style.overflow = this.panelOpen() && this.isFullscreen() ? 'hidden' : '';
    }
  }

  closePanel(): void {
    this.panelOpen.set(false);
    if (this.isBrowser) {
      document.body.style.overflow = '';
    }
  }
}
