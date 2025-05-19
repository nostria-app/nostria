import { Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { UnifiedLoginDialogComponent } from '../components/unified-login-dialog/unified-login-dialog.component';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  constructor(private dialog: MatDialog) {}

  // Update methods that show login dialogs
  showLoginDialog(): void {
    this.dialog.open(UnifiedLoginDialogComponent, {
      width: '450px',
      maxWidth: '95vw',
      disableClose: true,
      panelClass: 'welcome-dialog'
    });
  }
}