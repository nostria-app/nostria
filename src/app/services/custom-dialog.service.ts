import { Injectable, Type, signal, inject, ApplicationRef, createComponent, EnvironmentInjector, ComponentRef, Injector } from '@angular/core';
import { CustomDialogComponent } from '../components/custom-dialog/custom-dialog.component';
import { Subject } from 'rxjs';

/**
 * Reference to a custom dialog instance
 */
export class CustomDialogRef<T = unknown, R = unknown> {
  private closedSubject = signal<R | undefined>(undefined);
  private hasBeenClosed = signal(false);
  private _afterClosed = new Subject<R | undefined>();

  /**
   * Observable-like signal that emits when the dialog closes
   */
  afterClosed = this.closedSubject.asReadonly;

  /**
   * Observable that emits when the dialog closes
   */
  afterClosed$ = this._afterClosed.asObservable();

  /**
   * Signal indicating if the dialog has been closed
   */
  isClosed = this.hasBeenClosed.asReadonly;

  public componentInstance!: T;

  constructor(
    private onCloseCallback: (result?: R) => void
  ) { }

  /**
   * Close the dialog with an optional result
   */
  close(result?: R): void {
    if (this.hasBeenClosed()) return;

    this.hasBeenClosed.set(true);
    this.closedSubject.set(result);
    this._afterClosed.next(result);
    this._afterClosed.complete();
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
  /** Disable submitting the dialog when pressing Enter */
  disableEnterSubmit?: boolean;
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

  // Dedicated container for custom dialogs - ensures they render above CDK overlays
  private dialogContainer: HTMLElement | null = null;

  /**
   * Get or create the dialog container element
   * This container is always appended last to document.body to ensure
   * custom dialogs appear above CDK overlay container
   */
  private getDialogContainer(): HTMLElement {
    if (!this.dialogContainer || !document.body.contains(this.dialogContainer)) {
      this.dialogContainer = document.createElement('div');
      this.dialogContainer.id = 'custom-dialog-container';
      this.dialogContainer.style.position = 'fixed';
      this.dialogContainer.style.top = '0';
      this.dialogContainer.style.left = '0';
      this.dialogContainer.style.width = '100%';
      this.dialogContainer.style.height = '100%';
      this.dialogContainer.style.zIndex = '99999';
      this.dialogContainer.style.pointerEvents = 'none';
      document.body.appendChild(this.dialogContainer);
    } else {
      // Move to end of body to ensure it's above any newly created CDK overlays
      document.body.appendChild(this.dialogContainer);
    }
    return this.dialogContainer;
  }

  /**
   * Opens a custom dialog with the specified component and configuration
   */
  open<T, R = unknown>(
    component: Type<T>,
    config: CustomDialogConfig = {}
  ): CustomDialogRef<T, R> {
    // Create the dialog wrapper component
    const dialogRef = createComponent(CustomDialogComponent, {
      environmentInjector: this.injector
    });

    // Set dialog configuration using setInput
    if (config.title) dialogRef.setInput('title', config.title);
    if (config.headerIcon) dialogRef.setInput('headerIcon', config.headerIcon);
    if (config.showBackButton !== undefined) dialogRef.setInput('showBackButton', config.showBackButton);
    if (config.showCloseButton !== undefined) dialogRef.setInput('showCloseButton', config.showCloseButton);
    if (config.disableClose !== undefined) dialogRef.setInput('disableClose', config.disableClose);
    if (config.disableEnterSubmit !== undefined) dialogRef.setInput('disableEnterSubmit', config.disableEnterSubmit);
    if (config.width) dialogRef.setInput('width', config.width);
    if (config.maxWidth) dialogRef.setInput('maxWidth', config.maxWidth);
    if (config.panelClass) dialogRef.setInput('panelClass', config.panelClass);

    // Create dialog ref first to provide it to the component
    const customDialogRef = new CustomDialogRef<T, R>(
      () => {
        this.closeDialog(dialogRef, contentRef);
      }
    );

    // Create injector with the dialog ref
    const injector = Injector.create({
      providers: [
        { provide: CustomDialogRef, useValue: customDialogRef }
      ],
      parent: this.injector
    });

    // Create the content component
    const contentRef = createComponent(component, {
      environmentInjector: this.injector,
      elementInjector: injector
    });

    // Set the component instance on the dialog ref
    customDialogRef.componentInstance = contentRef.instance;

    // Attach content to dialog
    const dialogElement = dialogRef.location.nativeElement;
    const contentElement = contentRef.location.nativeElement;

    // Find elements with dialog-header, dialog-content, and dialog-actions attributes
    const headerElements = contentElement.querySelectorAll('[dialog-header]');
    const contentElements = contentElement.querySelectorAll('[dialog-content]');
    const actionElements = contentElement.querySelectorAll('[dialog-actions]');

    // Get dialog slots
    const headerSlot = dialogElement.querySelector('.dialog-header');
    const contentSlot = dialogElement.querySelector('.dialog-content');
    const actionsSlot = dialogElement.querySelector('.dialog-actions');

    // Append elements to their respective slots
    if (headerSlot && headerElements.length > 0) {
      headerElements.forEach((el: Element) => {
        headerSlot.appendChild(el);
      });
    }

    if (contentSlot && contentElements.length > 0) {
      contentElements.forEach((el: Element) => {
        contentSlot.appendChild(el);
      });
    } else if (contentSlot) {
      // If no dialog-content attribute found, append entire component to content
      contentSlot.appendChild(contentElement);
    }

    if (actionsSlot && actionElements.length > 0) {
      actionElements.forEach((el: Element) => {
        actionsSlot.appendChild(el);
      });
    }

    // Apply critical positioning styles directly to the host element
    const hostElement = dialogRef.location.nativeElement as HTMLElement;
    hostElement.style.position = 'fixed';
    hostElement.style.top = '0';
    hostElement.style.left = '0';
    hostElement.style.width = '100%';
    hostElement.style.height = '100dvh';
    hostElement.style.zIndex = '1'; // Relative to container which has z-index 99999
    hostElement.style.display = 'block';
    hostElement.style.pointerEvents = 'auto';

    // Get or create dialog container and move it to end of body
    // This ensures custom dialogs always appear above CDK overlay container
    const container = this.getDialogContainer();
    container.appendChild(hostElement);

    this.appRef.attachView(dialogRef.hostView);
    this.appRef.attachView(contentRef.hostView);

    // Track the dialog
    this.openDialogs.add(dialogRef);

    // Set up close handler - subscribe to the dialog's closed output
    const subscription = dialogRef.instance.closed.subscribe(() => {
      // If the content component has a cancel method, call it
      // This allows components to handle cleanup before closing
      const component = contentRef.instance as unknown as { cancel?: () => void };
      if (typeof component.cancel === 'function') {
        component.cancel();
      } else {
        customDialogRef.close();
      }
      subscription.unsubscribe();
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
