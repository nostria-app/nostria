import { Injectable, Component, Type, signal, effect, inject, ApplicationRef, createComponent, EnvironmentInjector, ComponentRef } from '@angular/core';
import { CustomDialogComponent } from '../components/custom-dialog/custom-dialog.component';

/**
 * Reference to a custom dialog instance
 */
export class CustomDialogRef<T = unknown> {
  private closedSubject = signal<T | undefined>(undefined);
  private hasBeenClosed = signal(false);

  /**
   * Observable-like signal that emits when the dialog closes
   */
  afterClosed = this.closedSubject.asReadonly;

  /**
   * Signal indicating if the dialog has been closed
   */
  isClosed = this.hasBeenClosed.asReadonly;

  constructor(
    public componentInstance: T,
    private onCloseCallback: (result?: T) => void
  ) { }

  /**
   * Close the dialog with an optional result
   */
  close(result?: T): void {
    if (this.hasBeenClosed()) return;

    this.hasBeenClosed.set(true);
    this.closedSubject.set(result);
    this.onCloseCallback(result);
  }
}

/**
 * Configuration options for opening a custom dialog
 */
export interface CustomDialogConfig {
  /** Dialog title */
  title?: string;
  /** Icon to show in the header */
  headerIcon?: string;
  /** Show back button instead of close button */
  showBackButton?: boolean;
  /** Show close button */
  showCloseButton?: boolean;
  /** Prevent closing on backdrop click or escape */
  disableClose?: boolean;
  /** Dialog width (default: 600px) */
  width?: string;
  /** Dialog max width (default: 95vw) */
  maxWidth?: string;
  /** Data to pass to the dialog component */
  data?: unknown;
  /** Custom CSS class to add to the dialog */
  panelClass?: string | string[];
}

/**
 * Service for opening custom dialogs
 * 
 * Usage:
 * ```typescript
 * const dialogRef = this.customDialog.open(MyDialogComponent, {
 *   title: 'My Dialog',
 *   width: '500px',
 *   data: { message: 'Hello!' }
 * });
 * 
 * effect(() => {
 *   const result = dialogRef.afterClosed();
 *   if (result !== undefined) {
 *     console.log('Dialog closed with:', result);
 *   }
 * });
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class CustomDialogService {
  private appRef = inject(ApplicationRef);
  private injector = inject(EnvironmentInjector);

  // Track open dialogs
  private openDialogs = new Set<ComponentRef<CustomDialogComponent>>();

  /**
   * Opens a custom dialog with the specified component and configuration
   */
  open<T, R = unknown>(
    component: Type<T>,
    config: CustomDialogConfig = {}
  ): CustomDialogRef<R> {
    // Create the dialog wrapper component
    const dialogRef = createComponent(CustomDialogComponent, {
      environmentInjector: this.injector
    });

    // Set dialog configuration
    const dialogInstance = dialogRef.instance;
    if (config.title) dialogInstance.title.set?.(config.title) ?? (dialogInstance.title as any)(config.title);
    if (config.headerIcon) dialogInstance.headerIcon.set?.(config.headerIcon) ?? (dialogInstance.headerIcon as any)(config.headerIcon);
    if (config.showBackButton !== undefined) dialogInstance.showBackButton.set?.(config.showBackButton) ?? (dialogInstance.showBackButton as any)(config.showBackButton);
    if (config.showCloseButton !== undefined) dialogInstance.showCloseButton.set?.(config.showCloseButton) ?? (dialogInstance.showCloseButton as any)(config.showCloseButton);
    if (config.disableClose !== undefined) dialogInstance.disableClose.set?.(config.disableClose) ?? (dialogInstance.disableClose as any)(config.disableClose);
    if (config.width) dialogInstance.width.set?.(config.width) ?? (dialogInstance.width as any)(config.width);
    if (config.maxWidth) dialogInstance.maxWidth.set?.(config.maxWidth) ?? (dialogInstance.maxWidth as any)(config.maxWidth);

    // Create the content component
    const contentRef = createComponent(component, {
      environmentInjector: this.injector
    });

    // Attach content to dialog
    const dialogElement = dialogRef.location.nativeElement;
    const contentSlot = dialogElement.querySelector('.dialog-content');
    if (contentSlot) {
      contentSlot.appendChild(contentRef.location.nativeElement);
    }

    // Attach dialog to the DOM
    document.body.appendChild(dialogRef.location.nativeElement);
    this.appRef.attachView(dialogRef.hostView);
    this.appRef.attachView(contentRef.hostView);

    // Track the dialog
    this.openDialogs.add(dialogRef);

    // Create dialog ref for external use
    const customDialogRef = new CustomDialogRef<R>(
      contentRef.instance,
      (result?: R) => {
        this.closeDialog(dialogRef, contentRef);
      }
    );

    // Set up close handlers
    const closedSubscription = effect(() => {
      dialogInstance.closed.subscribe?.(() => {
        customDialogRef.close();
      });
    });

    return customDialogRef;
  }

  /**
   * Close all open dialogs
   */
  closeAll(): void {
    this.openDialogs.forEach(dialogRef => {
      this.closeDialog(dialogRef, null);
    });
  }

  /**
   * Internal method to clean up and remove a dialog
   */
  private closeDialog(
    dialogRef: ComponentRef<CustomDialogComponent>,
    contentRef: ComponentRef<unknown> | null
  ): void {
    // Remove from tracking
    this.openDialogs.delete(dialogRef);

    // Detach and destroy
    this.appRef.detachView(dialogRef.hostView);
    if (contentRef) {
      this.appRef.detachView(contentRef.hostView);
      contentRef.destroy();
    }
    dialogRef.destroy();
  }
}
