import { Component, inject, ViewChild, output, AfterViewInit, ChangeDetectorRef, signal } from '@angular/core';
import { CustomDialogComponent } from '../custom-dialog/custom-dialog.component';
import { LoginDialogComponent } from '../login-dialog/login-dialog.component';
import { LoggerService } from '../../services/logger.service';
import { LayoutService } from '../../services/layout.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

/**
 * Standalone login dialog using custom dialog component
 * 
 * Usage in a component:
 * ```typescript
 * showLogin = signal(false);
 * 
 * openLogin() {
 *   this.showLogin.set(true);
 * }
 * 
 * handleLoginClosed() {
 *   this.showLogin.set(false);
 *   // Handle post-login logic
 * }
 * ```
 * 
 * In template:
 * ```html
 * @if (showLogin()) {
 *   <app-standalone-login-dialog (closed)="handleLoginClosed()" />
 * }
 * ```
 */
@Component({
  selector: 'app-standalone-login-dialog',
  imports: [CustomDialogComponent, LoginDialogComponent, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <app-custom-dialog
      [title]="getCurrentTitle()"
      [headerIcon]="'icons/icon-128x128.png'"
      [showBackButton]="shouldShowBackButton()"
      [showCloseButton]="shouldShowCloseButton()"
      [disableClose]="false"
      [width]="'600px'"
      [maxWidth]="'95vw'"
      (closed)="handleClose()"
      (backClicked)="handleBackButton()">
      
      <div dialog-content>
        <app-unified-login-dialog (dialogClosed)="handleClose()" />
      </div>
      
      <div dialog-actions style="display: flex; justify-content: flex-end; gap: 12px;">
        @if (viewInitialized() && loginComponent) {
          @if (loginComponent.currentStep() === loginComponent.LoginStep.REGION_SELECTION && !loginComponent.isDetectingRegion()) {
            <button mat-flat-button (click)="loginComponent.generateNewKey()" [disabled]="loginComponent.loading()">
              @if (loginComponent.loading()) {
                <mat-spinner diameter="20" class="button-spinner"></mat-spinner>
                <span>Creating Account...</span>
              } @else {
                <span>Create account</span>
              }
            </button>
          }
          @if (loginComponent.currentStep() === loginComponent.LoginStep.NSEC_LOGIN) {
            <button mat-flat-button (click)="loginComponent.loginWithNsec()" [disabled]="!loginComponent.isNsecKeyValid() || loginComponent.loading()">
              @if (loginComponent.loading()) {
                <mat-spinner diameter="20" class="button-spinner"></mat-spinner>
                <span>Signing in...</span>
              } @else {
                <span>Login</span>
              }
            </button>
          }
          @if (loginComponent.currentStep() === loginComponent.LoginStep.NOSTR_CONNECT) {
            @if (loginComponent.nostrConnectLoading()) {
              <button mat-flat-button [disabled]="true">
                <mat-spinner diameter="20" class="button-spinner"></mat-spinner>
                <span>Connecting...</span>
              </button>
            } @else if (loginComponent.nostrConnectUrl() && loginComponent.nostrConnectUrl().length >= 10) {
              <button mat-flat-button (click)="loginComponent.loginWithNostrConnect()">
                <mat-icon>phone_iphone</mat-icon>
                <span>Connect</span>
              </button>
            }
          }
          @if (loginComponent.currentStep() === loginComponent.LoginStep.PREVIEW) {
            <button mat-flat-button (click)="loginComponent.usePreviewAccount(loginComponent.previewPubkey)" [disabled]="!loginComponent.previewPubkey">
              <mat-icon>visibility</mat-icon>
              <span>Preview Only</span>
            </button>
          }
        }
      </div>
    </app-custom-dialog>
  `,
  styles: []
})
export class StandaloneLoginDialogComponent implements AfterViewInit {
  private logger = inject(LoggerService);
  private layout = inject(LayoutService);
  private cdr = inject(ChangeDetectorRef);

  @ViewChild(LoginDialogComponent) loginComponent?: LoginDialogComponent;

  // Signal to track when the view is initialized
  viewInitialized = signal(false);

  // Output event when dialog closes
  closed = output<void>();

  ngAfterViewInit() {
    // Mark view as initialized
    this.viewInitialized.set(true);

    // Check if there's an initial step to navigate to
    const initialStep = this.layout.loginDialogInitialStep();

    if (initialStep && this.loginComponent) {
      this.logger.debug('Navigating to initial step:', initialStep);

      // Use queueMicrotask to avoid ExpressionChangedAfterItHasBeenCheckedError
      queueMicrotask(() => {
        if (!this.loginComponent) return;

        if (initialStep === 'new-user') {
          this.loginComponent.startNewAccountFlow();
        } else if (initialStep === 'login') {
          this.loginComponent.goToStep(this.loginComponent.LoginStep.LOGIN_OPTIONS);
        }

        // Trigger change detection after signal changes
        this.cdr.detectChanges();
      });
    }
  } getCurrentTitle(): string {
    const step = this.loginComponent?.currentStep();
    const LoginStep = this.loginComponent?.LoginStep;

    if (!step || !LoginStep) return 'Welcome to Nostria';

    switch (step) {
      case LoginStep.INITIAL:
        return 'Welcome to Nostria';
      case LoginStep.REGION_SELECTION:
        return 'Select Your Region';
      case LoginStep.LOGIN_OPTIONS:
        return 'Sign in to Nostria';
      case LoginStep.NSEC_LOGIN:
        return 'Sign in with Private Key';
      case LoginStep.NOSTR_CONNECT:
        return 'Sign in with Remote Signer';
      case LoginStep.EXISTING_ACCOUNTS:
        return 'Choose an Account';
      case LoginStep.PREVIEW:
        return 'Preview Mode';
      default:
        return 'Sign in to Nostria';
    }
  }

  shouldShowBackButton(): boolean {
    const step = this.loginComponent?.currentStep();
    const LoginStep = this.loginComponent?.LoginStep;

    return step !== undefined && step !== LoginStep?.INITIAL;
  }

  shouldShowCloseButton(): boolean {
    // Always show close button on all steps
    return true;
  }

  handleBackButton(): void {
    const step = this.loginComponent?.currentStep();
    const LoginStep = this.loginComponent?.LoginStep;

    if (!step || !LoginStep || !this.loginComponent) return;

    if (step === LoginStep.REGION_SELECTION) {
      this.loginComponent.goToStep(LoginStep.INITIAL);
    } else if (step === LoginStep.LOGIN_OPTIONS) {
      this.loginComponent.goToStep(LoginStep.INITIAL);
    } else {
      this.loginComponent.goToStep(LoginStep.LOGIN_OPTIONS);
    }
  }

  handleClose(): void {
    this.logger.debug('Standalone login dialog closed');
    this.closed.emit();
  }
}
