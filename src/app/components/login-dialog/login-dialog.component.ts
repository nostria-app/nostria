import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { NostrService } from '../../services/nostr.service';

@Component({
  selector: 'app-login-dialog',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    FormsModule,
    MatCardModule
  ],
  templateUrl: './login-dialog.component.html',
  styleUrl: './login-dialog.component.scss',
})
export class LoginDialogComponent {
  private dialogRef = inject(MatDialogRef<LoginDialogComponent>);
  private nostrService = inject(NostrService);

  currentView = signal<'main' | 'nsec'>('main');
  nsecKey = '';

  generateNewKey(): void {
    this.nostrService.generateNewKey();
    this.dialogRef.close();
  }

  loginWithExtension(): void {
    this.nostrService.loginWithExtension();
    this.dialogRef.close();
  }

  loginWithNsec(): void {
    if (this.nsecKey && this.nsecKey.startsWith('nsec')) {
      this.nostrService.loginWithNsec(this.nsecKey);
      this.dialogRef.close();
    }
  }

  usePreviewAccount(): void {
    this.nostrService.usePreviewAccount();
    this.dialogRef.close();
  }
}
