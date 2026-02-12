import { ChangeDetectionStrategy, Component, input, output, effect, ElementRef, inject, viewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

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
  imports: [CommonModule, MatIconModule, MatButtonModule],
  template: `
    <div 
      class="dialog-backdrop" 
      [class.stacked-backdrop]="isStacked()"
      (click)="onBackdropClick()"
      role="presentation">
      
      <div 
        class="dialog-container" 
        [ngClass]="panelClass()"
        (click)="$event.stopPropagation()"
        role="dialog"
        [attr.aria-labelledby]="getTitle() ? 'dialog-title' : null"
        tabindex="-1"
        #dialogContainer>
        
        <!-- Header -->
        <div class="dialog-header">
          @if (getShowBackButton()) {
            <button 
              class="back-button" 
              (click)="onBackClick()"
              aria-label="Back"
              type="button">
              <mat-icon>arrow_back</mat-icon>
            </button>
          }
          
          @if (getShowCloseButton()) {
            <button 
              class="close-button" 
              (click)="onCloseClick()"
              aria-label="Close"
              type="button">
              <mat-icon>close</mat-icon>
            </button>
          }
          
          @if (getTitle()) {
            <h2 class="dialog-title" id="dialog-title">{{ getTitle() }}</h2>
          }
          
          @if (getHeaderIcon()) {
            <img [src]="getHeaderIcon()" [alt]="getTitle() || 'Dialog'" class="header-icon" />
          }
          
          <!-- Custom header content -->
          <ng-content select="[dialog-header]"></ng-content>
        </div>
        
        <!-- Content -->
        <div class="dialog-content" #dialogContent>
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
  // Modern signal-based inputs
  title = input<string>('');
  headerIcon = input<string>('');
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

  // Modern viewChild
  dialogContainer = viewChild<ElementRef>('dialogContainer');
  dialogContent = viewChild<ElementRef>('dialogContent');

  private document = inject(DOCUMENT);
  private elementRef = inject(ElementRef);
  private portalHost: HTMLElement | null = null;

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

    // Focus the dialog container for keyboard accessibility
    setTimeout(() => {
      const container = this.dialogContainer();
      container?.nativeElement.focus();
    }, 100);
  }

  ngOnDestroy() {
    this.removeFromBody();
    this.enableBodyScroll();
  }

  /**
   * Move the component's host element to a container at document.body
   * This ensures proper z-index stacking above all other content
   */
  private moveToBody(): void {
    if (typeof this.document === 'undefined') return;

    const hostElement = this.elementRef.nativeElement as HTMLElement;

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

  getShowBackButton(): boolean {
    return this.showBackButton();
  }

  getShowCloseButton(): boolean {
    return this.showCloseButton();
  }

  getDisableClose(): boolean {
    return this.disableClose();
  }

  private disableBodyScroll(): void {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = 'hidden';
  }

  private enableBodyScroll(): void {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = '';
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

    const updateHeight = () => {
      const host = this.elementRef.nativeElement as HTMLElement;
      if (host && window.visualViewport) {
        host.style.height = `${window.visualViewport.height}px`;
      }
    };

    window.visualViewport.addEventListener('resize', updateHeight);
    window.visualViewport.addEventListener('scroll', updateHeight);
    updateHeight(); // Initial setup
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

  close(): void {
    this.closed.emit();
  }
}
