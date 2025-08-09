import { Component, inject } from '@angular/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { LoginDialogComponent } from '../login-dialog/login-dialog.component';

// Import the LoginStep enum (we need to match the exact enum from login-dialog.component.ts)
enum LoginStep {
  INITIAL = 'initial',
  REGION_SELECTION = 'region',
  LOGIN_OPTIONS = 'login-options',
  NSEC_LOGIN = 'nsec',
  EXTENSION_LOADING = 'extension-loading',
  EXISTING_ACCOUNTS = 'existing-accounts',
  NOSTR_CONNECT = 'nostr-connect',
  PREVIEW = 'preview',
}

@Component({
  selector: 'app-introduction',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatDialogModule],
  templateUrl: './introduction.html',
  styleUrl: './introduction.scss',
})
export class Introduction {
  private dialog = inject(MatDialog);

  openNewUserFlow(): void {
    const dialogRef = this.dialog.open(LoginDialogComponent, {
      width: '450px',
      maxWidth: '95vw',
      disableClose: true,
      panelClass: 'welcome-dialog',
    });

    // After dialog opens, navigate to the new user flow
    dialogRef.afterOpened().subscribe(() => {
      // The dialog starts with INITIAL step, then user clicks to start new account flow
      // We can access the component instance to trigger the flow
      setTimeout(() => {
        dialogRef.componentInstance.startNewAccountFlow();
      }, 100);
    });
  }

  openLoginFlow(): void {
    const dialogRef = this.dialog.open(LoginDialogComponent, {
      width: '450px',
      maxWidth: '95vw',
      disableClose: true,
      panelClass: 'welcome-dialog',
    });

    // After dialog opens, navigate to login options
    dialogRef.afterOpened().subscribe(() => {
      setTimeout(() => {
        dialogRef.componentInstance.goToStep(LoginStep.LOGIN_OPTIONS);
      }, 100);
    });
  }
}
