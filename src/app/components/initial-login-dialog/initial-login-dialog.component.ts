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
    this.logger.debug('Generating new key for new user');
    this.loading.set(true);
    this.nostrService.generateNewKey();
    this.closeDialog();
  }

  openLoginDialog(): void {
    this.logger.debug('Opening full login dialog');
    this.closeDialog();
    
    // Open the existing detailed login dialog
    this.dialog.open(LoginDialogComponent, {
      width: '450px',
      maxWidth: '95vw',
      disableClose: true
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
