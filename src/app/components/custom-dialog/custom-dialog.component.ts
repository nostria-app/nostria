import { Component, signal, input, output, effect, ElementRef, inject, viewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
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
 * 
 * Usage:
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
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  template: `
    <div 
      class="dialog-backdrop" 
      (click)="onBackdropClick()"
      role="presentation">
      <div 
        class="dialog-container" 
        (click)="$event.stopPropagation()"
        role="dialog"
        [attr.aria-labelledby]="title() ? 'dialog-title' : null"
        tabindex="-1"
        #dialogContainer>
        
        <!-- Header -->
        <div class="dialog-header">
          @if (showBackButton()) {
            <button 
              class="back-button" 
              (click)="onBackClick()"
              aria-label="Back"
              type="button">
              <mat-icon>arrow_back</mat-icon>
            </button>
          }
          
          @if (showCloseButton()) {
            <button 
              class="close-button" 
              (click)="onCloseClick()"
              aria-label="Close"
              type="button">
              <mat-icon>close</mat-icon>
            </button>
          }
          
          @if (title()) {
            <h2 class="dialog-title" id="dialog-title">{{ title() }}</h2>
          }
          
          @if (headerIcon()) {
            <img [src]="headerIcon()" [alt]="title() || 'Dialog'" class="header-icon" />
          }
        </div>
        
        <!-- Content -->
        <div class="dialog-content" #dialogContent>
          <ng-content select="[dialog-content]"></ng-content>
        </div>
        
        <!-- Actions -->
        @if (hasActions()) {
          <div class="dialog-actions">
            <ng-content select="[dialog-actions]"></ng-content>
          </div>
        }
      </div>
    </div>
  `,
  styleUrl: './custom-dialog.component.scss'
})
export class CustomDialogComponent implements AfterViewInit {
  // Inputs
  title = input<string>('');
  headerIcon = input<string>('');
  showBackButton = input<boolean>(false);
  showCloseButton = input<boolean>(true);
  disableClose = input<boolean>(false);
  width = input<string>('600px');
  maxWidth = input<string>('95vw');

  // Outputs
  closed = output<void>();
  backdropClicked = output<void>();
  backClicked = output<void>();

  // View children
  dialogContainer = viewChild<ElementRef>('dialogContainer');
  dialogContent = viewChild<ElementRef>('dialogContent');

  // Track if actions slot has content
  hasActions = signal(false);

  private elementRef = inject(ElementRef);

  constructor() {
    // Set up enter key listener
    effect(() => {
      const container = this.dialogContainer();
      if (container) {
        this.setupEnterKeyListener();
        this.checkForActions();
        this.setupKeyboardHandling();
      }
    });
  }

  ngAfterViewInit() {
    this.checkForActions();
    // Focus the dialog container for keyboard accessibility
    setTimeout(() => {
      this.dialogContainer()?.nativeElement.focus();
    }, 100);
  }

  private checkForActions(): void {
    const actionsSlot = this.elementRef.nativeElement.querySelector('[dialog-actions]');
    this.hasActions.set(!!actionsSlot && actionsSlot.children.length > 0);
  }

  private setupEnterKeyListener(): void {
    const container = this.dialogContainer()?.nativeElement;
    if (!container) return;

    container.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        const target = event.target as HTMLElement;

        // Don't trigger on textareas or buttons
        if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') {
          return;
        }

        // Find primary action button (mat-raised-button or mat-flat-button with color="primary")
        const primaryButton = container.querySelector(
          '[dialog-actions] button[color="primary"], [dialog-actions] .primary-action'
        ) as HTMLButtonElement;

        if (primaryButton && !primaryButton.disabled) {
          event.preventDefault();
          primaryButton.click();
        }
      }

      // Handle Escape key
      if (event.key === 'Escape' && !this.disableClose()) {
        this.onCloseClick();
      }
    });
  }

  private setupKeyboardHandling(): void {
    if (typeof window === 'undefined') return;

    // Handle visual viewport changes (mobile keyboard)
    if ('visualViewport' in window) {
      const visualViewport = window.visualViewport;

      if (!visualViewport) return;

      const handleViewportResize = () => {
        const container = this.dialogContainer()?.nativeElement;
        if (!container) return;

        // When keyboard appears, viewport height decreases
        // We use CSS custom properties to communicate with the stylesheet
        const viewportHeight = visualViewport.height;
        container.style.setProperty('--viewport-height', `${viewportHeight}px`);
      };

      visualViewport.addEventListener('resize', handleViewportResize);
      handleViewportResize(); // Initial setup
    }
  }

  onBackdropClick(): void {
    this.backdropClicked.emit();
    if (!this.disableClose()) {
      this.closed.emit();
    }
  }

  onCloseClick(): void {
    if (!this.disableClose()) {
      this.closed.emit();
    }
  }

  onBackClick(): void {
    this.backClicked.emit();
  }

  close(): void {
    this.closed.emit();
  }
}
