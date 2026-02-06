import { ChangeDetectionStrategy, Component, output, inject } from '@angular/core';
import { CustomDialogComponent } from '../custom-dialog/custom-dialog.component';
import { LoginDialogComponent } from '../login-dialog/login-dialog.component';

/**
 * Wrapper component that displays the login dialog using the custom dialog component
 */
@Component({
  selector: 'app-login-wrapper',
  imports: [CustomDialogComponent, LoginDialogComponent],
  template: `
    <app-custom-dialog
      [title]="getDialogTitle()"
      [headerIcon]="'icons/icon-128x128.png'"
      [showBackButton]="loginDialog.currentStep() !== loginDialog.LoginStep.INITIAL"
      [showCloseButton]="loginDialog.currentStep() === loginDialog.LoginStep.INITIAL"
      [disableClose]="true"
      [width]="'600px'"
      [maxWidth]="'95vw'"
      (closed)="onClose()"
      (backClicked)="handleBackButton()">
      
      <div dialog-content>
        <app-unified-login-dialog #loginDialog />
      </div>
    </app-custom-dialog>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginWrapperComponent {
  closed = output<void>();

  loginDialog!: LoginDialogComponent;

  getDialogTitle(): string {
    if (!this.loginDialog) return 'Welcome to Nostria';

    const step = this.loginDialog.currentStep();
    const LoginStep = this.loginDialog.LoginStep;

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
        return 'Sign in with Nostr Connect';
      case LoginStep.EXISTING_ACCOUNTS:
        return 'Choose an Account';
      case LoginStep.PREVIEW:
        return 'Preview Mode';
      default:
        return 'Sign in to Nostria';
    }
  }

  handleBackButton(): void {
    if (!this.loginDialog) return;

    const step = this.loginDialog.currentStep();
    const LoginStep = this.loginDialog.LoginStep;

    if (step === LoginStep.REGION_SELECTION) {
      this.loginDialog.goToStep(LoginStep.INITIAL);
    } else if (step === LoginStep.LOGIN_OPTIONS) {
      this.loginDialog.goToStep(LoginStep.INITIAL);
    } else {
      this.loginDialog.goToStep(LoginStep.LOGIN_OPTIONS);
    }
  }

  onClose(): void {
    this.closed.emit();
  }
}
