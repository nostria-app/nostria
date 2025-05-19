import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { LoginDialogComponent } from '../login-dialog/login-dialog.component';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { TermsOfUseDialogComponent } from '../terms-of-use-dialog/terms-of-use-dialog.component';
import { LocationSelectionDialogComponent } from '../location-selection-dialog/location-selection-dialog.component';

@Component({
  selector: 'app-initial-login-dialog',
  standalone: true,  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule
  ],
  templateUrl: './initial-login-dialog.component.html',
  styleUrl: './initial-login-dialog.component.scss'
})
export class InitialLoginDialogComponent {
  private dialogRef = inject(MatDialogRef<InitialLoginDialogComponent>);
  private dialog = inject(MatDialog);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);

  loading = signal(false);

  generateNewKey(): void {
    this.logger.debug('Starting account creation flow with region selection');
    this.loading.set(true);
    
    // Close the current dialog and open the location selection dialog
    this.closeDialog();
    
    // Keep the blur backdrop
    document.body.classList.add('blur-backdrop');
    
    // Open the location selection dialog
    const locationDialog = this.dialog.open(LocationSelectionDialogComponent, {
      width: '450px',
      maxWidth: '95vw',
      disableClose: true,
      panelClass: 'welcome-dialog'
    });
    
    // Handle the selection result
    locationDialog.afterClosed().subscribe(regionId => {
      if (regionId) {
        this.logger.debug('Region selected, generating key', { region: regionId });
        this.nostrService.generateNewKey(regionId);
      } else {
        // If no region was selected (dialog dismissed), go back to initial dialog
        this.logger.debug('No region selected, reopening initial dialog');
        this.dialog.open(InitialLoginDialogComponent, {
          width: '450px',
          maxWidth: '95vw',
          disableClose: true,
          panelClass: 'welcome-dialog'
        });
      }
    });
  }
  openLoginDialog(): void {
    this.logger.debug('Opening full login dialog');
    this.closeDialog();
    
    // Keep the blur-backdrop class on the body when opening the login dialog
    document.body.classList.add('blur-backdrop');
    
    // Open the existing detailed login dialog
    this.dialog.open(LoginDialogComponent, {
      width: '450px',
      maxWidth: '95vw',
      disableClose: true,
      panelClass: 'welcome-dialog'
    });
  }

  openTermsOfUse(): void {
    this.logger.debug('Opening Terms of Use dialog');
    this.dialog.open(TermsOfUseDialogComponent, {
      width: '600px',
      maxWidth: '90vw',
    });
  }

  closeDialog(): void {
    this.logger.debug('Closing initial login dialog');
    this.dialogRef.close();
  }
}
