import { ChangeDetectionStrategy, Component, input, output, effect, ElementRef, inject, viewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { A11yModule } from '@angular/cdk/a11y';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlatformService } from '../../services/platform.service';

interface ScrollLockStyles {
  bodyOverflow: string;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyRight: string;
  bodyWidth: string;
  bodyOverscrollBehavior: string;
  htmlOverflow: string;
  htmlOverscrollBehavior: string;
}

/**
 * Custom dialog component that provides better mobile support and easier styling than Material Dialog
 * 
 * Features:
 * - Responsive design: floating on desktop, full-screen on mobile
 * - Keyboard-aware: adjusts to mobile keyboard using viewport units
 * - Enter key support: automatically triggers primary action
 * - Backdrop click to close (optional)
 * - Smooth animations
 * - Body scroll prevention when open
 * - Moves to document root for proper z-index stacking
 * 
 * Supports both modern signals and legacy @Input/@Output for compatibility
 * 
 * Usage with signals:
 * ```html
 * @if (showDialog()) {
 *   <app-custom-dialog
 *     [title]="'My Dialog'"
 *     [disableClose]="true"
 *     (closed)="handleClose()">
 *     
 *     <div dialog-content>
 *       <!-- Your content here -->
 *     </div>
 *     
 *     <div dialog-actions>
 *       <button mat-button (click)="cancel()">Cancel</button>
 *       <button mat-raised-button color="primary" (click)="save()">Save</button>
 *     </div>
 *   </app-custom-dialog>
 * }
 * ```
 */
@Component({
  selector: 'app-custom-dialog',
  imports: [CommonModule, A11yModule, MatIconModule, MatButtonModule, MatTooltipModule],
  template: `
    <div 
      class="dialog-backdrop" 
      [class.stacked-backdrop]="isStacked()"
      (click)="onBackdropClick()"
      (keydown.enter)="onBackdropClick()"
      (keydown.space)="onBackdropClick()"
      [attr.role]="disableClose() ? 'presentation' : 'button'"
      [attr.aria-label]="disableClose() ? null : 'Close dialog'"
      [attr.tabindex]="disableClose() ? -1 : 0">
      
      <div
        class="dialog-container"
        [ngClass]="panelClass()"
        (click)="$event.stopPropagation()"
        role="dialog"
        [attr.aria-labelledby]="getTitle() ? 'dialog-title' : null"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        tabindex="-1"
        #dialogContainer>
        
        <!-- Header -->
        @if (showHeader()) {
        <div class="dialog-header">
          <div class="dialog-header-leading">
            @if (getShowBackButton()) {
              <button 
                class="back-button" 
                (click)="onBackClick()"
                aria-label="Back"
                type="button">
                <mat-icon>arrow_back</mat-icon>
              </button>
            }

            @if (getHeaderIcon()) {
              @if (headerIconIsImage()) {
                <img [src]="getHeaderIcon()" [alt]="getTitle() || 'Dialog'" class="header-icon" />
              } @else {
                <mat-icon class="header-icon material-header-icon">{{ getHeaderIcon() }}</mat-icon>
              }
            }

            @if (getSecondaryHeaderIcon()) {
              <button class="secondary-header-button" [class.active]="getSecondaryHeaderActive()"
                [class.clickable]="getSecondaryHeaderClickable()" [matTooltip]="getSecondaryHeaderTooltip()"
                [matTooltipDisabled]="!getSecondaryHeaderTooltip()" [attr.aria-label]="getSecondaryHeaderAriaLabel()"
                [disabled]="!getSecondaryHeaderClickable()" (click)="onSecondaryHeaderClick()" type="button">
                <img [src]="getSecondaryHeaderIcon()" [alt]="getSecondaryHeaderTooltip() || 'Dialog status'"
                  class="secondary-header-icon" />
              </button>
            }
          </div>

          @if (getTitle()) {
            <h2 class="dialog-title" id="dialog-title">{{ getTitle() }}</h2>
          }

          <div class="dialog-header-trailing">
            <!-- Custom header content -->
            <ng-content select="[dialog-header]"></ng-content>

            @if (getShowCloseButton()) {
              <button 
                class="close-button" 
                (click)="onCloseClick()"
                aria-label="Close"
                type="button">
                <mat-icon>close</mat-icon>
              </button>
            }
          </div>
        </div>
        }
        
        <!-- Content -->
        <div class="dialog-content" cdkFocusInitial tabindex="-1" #dialogContent>
          <ng-content select="[dialog-content]"></ng-content>
        </div>
        
        <!-- Actions -->
        <div class="dialog-actions">
          <ng-content select="[dialog-actions]"></ng-content>
        </div>
      </div>
    </div>
  `,
  styleUrl: './custom-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CustomDialogComponent implements AfterViewInit, OnDestroy {
  private static scrollLockCount = 0;
  private static scrollLockY = 0;
  private static scrollLockStyles: ScrollLockStyles | null = null;

  // Modern signal-based inputs
  title = input<string>('');
  showHeader = input<boolean>(true);
  headerIcon = input<string>('');
  secondaryHeaderIcon = input<string>('');
  secondaryHeaderTooltip = input<string>('');
  secondaryHeaderActive = input<boolean>(false);
  secondaryHeaderClickable = input<boolean>(false);
  secondaryHeaderAriaLabel = input<string>('Dialog status');
  showBackButton = input<boolean>(false);
  showCloseButton = input<boolean>(true);
  disableClose = input<boolean>(false);
  disableEnterSubmit = input<boolean>(false);
  width = input<string>('600px');
  maxWidth = input<string>('95vw');
  panelClass = input<string | string[]>('');
  isStacked = input<boolean>(false); // True when this dialog is opened from another dialog

  // Modern signal-based outputs
  closed = output<void>();
  backdropClicked = output<void>();
  backClicked = output<void>();
  secondaryHeaderClicked = output<void>();

  // Modern viewChild
  dialogContainer = viewChild<ElementRef>('dialogContainer');
  dialogContent = viewChild<ElementRef>('dialogContent');

  private document = inject(DOCUMENT);
  private elementRef = inject(ElementRef);
  private platformService = inject(PlatformService);
  private portalHost: HTMLElement | null = null;
  private visualViewportHandler: (() => void) | null = null;
  private lastTouchY = 0;
  private touchStartHandler: ((event: TouchEvent) => void) | null = null;
  private touchMoveHandler: ((event: TouchEvent) => void) | null = null;
  private touchEndHandler: (() => void) | null = null;

  constructor() {
    // Set up keyboard handling immediately
    this.setupKeyboardHandling();

    // Set up enter key listener when container is ready
    effect(() => {
      const container = this.dialogContainer();
      if (container) {
        this.setupEnterKeyListener();
      }
    });

    // Apply width and max-width CSS variables
    effect(() => {
      const container = this.dialogContainer()?.nativeElement;
      if (container) {
        container.style.setProperty('--dialog-width', this.width());
        container.style.setProperty('--dialog-max-width', this.maxWidth());
      }
    });
  }

  ngAfterViewInit() {
    this.moveToBody();
    this.disableBodyScroll();
    this.setupTouchScrollGuard();

    // Focus the dialog container for keyboard accessibility
    setTimeout(() => {
      const container = this.dialogContainer();
      container?.nativeElement.focus();
    }, 100);
  }

  ngOnDestroy() {
    this.removeFromBody();
    this.enableBodyScroll();
    this.teardownKeyboardHandling();
    this.teardownTouchScrollGuard();
  }

  /**
   * Move the component's host element to a container at document.body
   * This ensures proper z-index stacking above all other content
   */
  private moveToBody(): void {
    if (typeof this.document === 'undefined') return;

    const hostElement = this.elementRef.nativeElement as HTMLElement;

    // Dialogs opened via CustomDialogService are already mounted in the
    // top-level custom dialog container. Re-parenting them into a second
    // portal host can break stacking against Material/CDK dialogs.
    if (hostElement.parentElement?.id === 'custom-dialog-container') {
      return;
    }

    // Create or get portal host
    this.portalHost = this.document.createElement('div');
    this.portalHost.classList.add('custom-dialog-portal-host');
    this.document.body.appendChild(this.portalHost);

    // Move host element to portal
    this.portalHost.appendChild(hostElement);
  }

  /**
   * Clean up the portal host when the dialog is destroyed
   */
  private removeFromBody(): void {
    if (this.portalHost && this.portalHost.parentNode) {
      this.portalHost.parentNode.removeChild(this.portalHost);
    }
    this.portalHost = null;
  }

  // Helper methods to support both signal and legacy inputs
  getTitle(): string {
    return this.title();
  }

  getHeaderIcon(): string {
    return this.headerIcon();
  }

  headerIconIsImage(): boolean {
    return this.isImageIcon(this.getHeaderIcon());
  }

  getSecondaryHeaderIcon(): string {
    return this.secondaryHeaderIcon();
  }

  getSecondaryHeaderTooltip(): string {
    return this.secondaryHeaderTooltip();
  }

  getSecondaryHeaderActive(): boolean {
    return this.secondaryHeaderActive();
  }

  getSecondaryHeaderClickable(): boolean {
    return this.secondaryHeaderClickable();
  }

  getSecondaryHeaderAriaLabel(): string {
    return this.secondaryHeaderAriaLabel();
  }

  getShowBackButton(): boolean {
    return this.showBackButton();
  }

  getShowCloseButton(): boolean {
    return this.showCloseButton();
  }

  private isImageIcon(value: string): boolean {
    return /^(https?:\/\/|\/|\.\/|\.\.\/|data:)/.test(value);
  }

  getDisableClose(): boolean {
    return this.disableClose();
  }

  private disableBodyScroll(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    CustomDialogComponent.scrollLockCount += 1;
    if (CustomDialogComponent.scrollLockCount > 1) {
      return;
    }

    const body = document.body;
    const html = document.documentElement;
    CustomDialogComponent.scrollLockStyles = {
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      bodyOverscrollBehavior: body.style.overscrollBehavior,
      htmlOverflow: html.style.overflow,
      htmlOverscrollBehavior: html.style.overscrollBehavior,
    };

    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';

    if (this.platformService.isIOS()) {
      CustomDialogComponent.scrollLockY = window.scrollY;
      body.style.position = 'fixed';
      body.style.top = `-${CustomDialogComponent.scrollLockY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
    }
  }

  private enableBodyScroll(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    CustomDialogComponent.scrollLockCount = Math.max(0, CustomDialogComponent.scrollLockCount - 1);
    if (CustomDialogComponent.scrollLockCount > 0) {
      return;
    }

    const styles = CustomDialogComponent.scrollLockStyles;
    const body = document.body;
    const html = document.documentElement;

    body.style.overflow = styles?.bodyOverflow ?? '';
    body.style.position = styles?.bodyPosition ?? '';
    body.style.top = styles?.bodyTop ?? '';
    body.style.left = styles?.bodyLeft ?? '';
    body.style.right = styles?.bodyRight ?? '';
    body.style.width = styles?.bodyWidth ?? '';
    body.style.overscrollBehavior = styles?.bodyOverscrollBehavior ?? '';
    html.style.overflow = styles?.htmlOverflow ?? '';
    html.style.overscrollBehavior = styles?.htmlOverscrollBehavior ?? '';

    if (this.platformService.isIOS()) {
      window.scrollTo(0, CustomDialogComponent.scrollLockY);
    }

    CustomDialogComponent.scrollLockStyles = null;
  }

  private setupEnterKeyListener(): void {
    const container = this.dialogContainer()?.nativeElement;
    if (!container) return;

    container.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        if (this.disableEnterSubmit()) {
          return;
        }

        const target = event.target as HTMLElement;

        // Don't trigger on textareas, buttons, or contenteditable elements
        if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON' || target.isContentEditable) {
          return;
        }

        // Find primary action button
        const primaryButton = container.querySelector(
          '[dialog-actions] button[color="primary"], [dialog-actions] .primary-action'
        ) as HTMLButtonElement;

        if (primaryButton && !primaryButton.disabled) {
          event.preventDefault();
          primaryButton.click();
        }
      }

      // Handle Escape key - always allow ESC to close
      if (event.key === 'Escape') {
        this.onCloseClick();
      }
    });
  }

  private setupKeyboardHandling(): void {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    this.visualViewportHandler = () => {
      const host = this.elementRef.nativeElement as HTMLElement;
      if (host && window.visualViewport) {
        const viewportOffsetTop = this.platformService.isIOS() ? Math.max(0, Math.floor(window.visualViewport.offsetTop)) : 0;
        const viewportOffsetLeft = this.platformService.isIOS() ? Math.max(0, Math.floor(window.visualViewport.offsetLeft)) : 0;
        host.style.top = '0';
        host.style.left = '0';
        host.style.width = '100%';
        host.style.height = '100%';
        host.style.transform = (viewportOffsetTop > 0 || viewportOffsetLeft > 0)
          ? `translate(${viewportOffsetLeft}px, ${viewportOffsetTop}px)`
          : '';
      }
    };

    window.visualViewport.addEventListener('resize', this.visualViewportHandler);
    window.visualViewport.addEventListener('scroll', this.visualViewportHandler);
    this.visualViewportHandler();
  }

  private teardownKeyboardHandling(): void {
    if (typeof window === 'undefined' || !window.visualViewport || !this.visualViewportHandler) {
      return;
    }

    window.visualViewport.removeEventListener('resize', this.visualViewportHandler);
    window.visualViewport.removeEventListener('scroll', this.visualViewportHandler);
    (this.elementRef.nativeElement as HTMLElement).style.transform = '';
    this.visualViewportHandler = null;
  }

  private setupTouchScrollGuard(): void {
    if (typeof window === 'undefined' || !this.platformService.isIOS()) {
      return;
    }

    const host = this.elementRef.nativeElement as HTMLElement;
    this.touchStartHandler = (event: TouchEvent) => {
      this.lastTouchY = event.touches[0]?.clientY ?? 0;
    };

    this.touchMoveHandler = (event: TouchEvent) => {
      if (event.touches.length === 0) {
        return;
      }

      const currentY = event.touches[0].clientY;
      const deltaY = currentY - this.lastTouchY;
      this.lastTouchY = currentY;

      const target = event.target as HTMLElement | null;
      const scrollableParent = target ? this.findScrollableParent(target, host, deltaY) : null;
      if (!scrollableParent) {
        event.preventDefault();
        return;
      }

      const maxScrollTop = scrollableParent.scrollHeight - scrollableParent.clientHeight;
      const atTop = scrollableParent.scrollTop <= 0;
      const atBottom = scrollableParent.scrollTop >= maxScrollTop - 1;
      const pullingDown = deltaY > 0;
      const pushingUp = deltaY < 0;

      if (maxScrollTop <= 0 || (atTop && pullingDown) || (atBottom && pushingUp)) {
        event.preventDefault();
      }
    };

    this.touchEndHandler = () => {
      this.lastTouchY = 0;
    };

    host.addEventListener('touchstart', this.touchStartHandler, { passive: true });
    host.addEventListener('touchmove', this.touchMoveHandler, { passive: false });
    host.addEventListener('touchend', this.touchEndHandler, { passive: true });
  }

  private teardownTouchScrollGuard(): void {
    const host = this.elementRef.nativeElement as HTMLElement;
    if (this.touchStartHandler) {
      host.removeEventListener('touchstart', this.touchStartHandler);
      this.touchStartHandler = null;
    }
    if (this.touchMoveHandler) {
      host.removeEventListener('touchmove', this.touchMoveHandler);
      this.touchMoveHandler = null;
    }
    if (this.touchEndHandler) {
      host.removeEventListener('touchend', this.touchEndHandler);
      this.touchEndHandler = null;
    }
  }

  private findScrollableParent(startElement: HTMLElement, host: HTMLElement, deltaY: number): HTMLElement | null {
    let current: HTMLElement | null = startElement;
    let fallback: HTMLElement | null = null;

    while (current && current !== host) {
      const styles = window.getComputedStyle(current);
      const canScrollY = /(auto|scroll)/.test(styles.overflowY) || /(auto|scroll)/.test(styles.overflow);
      const maxScrollTop = current.scrollHeight - current.clientHeight;

      if (canScrollY && maxScrollTop > 0) {
        fallback ??= current;

        const atTop = current.scrollTop <= 0;
        const atBottom = current.scrollTop >= maxScrollTop - 1;
        const pullingDown = deltaY > 0;
        const pushingUp = deltaY < 0;

        if ((pullingDown && !atTop) || (pushingUp && !atBottom) || Math.abs(deltaY) < 0.5) {
          return current;
        }
      }

      current = current.parentElement;
    }

    return fallback;
  }

  onBackdropClick(): void {
    if (!this.getDisableClose()) {
      this.backdropClicked.emit();
      this.closed.emit();
    }
  }

  onCloseClick(): void {
    this.closed.emit();
  }

  onBackClick(): void {
    this.backClicked.emit();
  }

  onSecondaryHeaderClick(): void {
    if (this.getSecondaryHeaderClickable()) {
      this.secondaryHeaderClicked.emit();
    }
  }

  close(): void {
    this.closed.emit();
  }
}
