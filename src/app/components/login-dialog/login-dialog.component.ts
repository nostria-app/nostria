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
  template: `
    <div class="login-dialog">
      <h2 mat-dialog-title>Welcome to Nostria</h2>
      
      @if (currentView() === 'main') {
        <div mat-dialog-content>
          <p>Choose how you would like to use Nostria:</p>
          
          <div class="login-options">
            <mat-card (click)="generateNewKey()">
              <mat-card-header>
                <mat-card-title>New to Nostr</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <p>Generate a new Nostr private key</p>
              </mat-card-content>
            </mat-card>
            
            <mat-card (click)="loginWithExtension()">
              <mat-card-header>
                <mat-card-title>Login with Extension</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <p>Use a browser extension like Alby or nos2x</p>
              </mat-card-content>
            </mat-card>
            
            <mat-card (click)="currentView.set('nsec')">
              <mat-card-header>
                <mat-card-title>Login with nsec</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <p>Enter your Nostr private key</p>
              </mat-card-content>
            </mat-card>
            
            <mat-card (click)="usePreviewAccount()">
              <mat-card-header>
                <mat-card-title>Preview</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <p>Try Nostria with a demo account</p>
              </mat-card-content>
            </mat-card>
          </div>
        </div>
      }
      
      @if (currentView() === 'nsec') {
        <div mat-dialog-content>
          <p>Enter your nsec private key:</p>
          
          <mat-form-field appearance="fill" class="full-width">
            <mat-label>Private Key (nsec...)</mat-label>
            <input matInput [(ngModel)]="nsecKey" type="password" 
                  placeholder="nsec1...">
          </mat-form-field>
          
          <div class="nsec-warning">
            <p>⚠️ Your private key will be stored locally on your device.</p>
          </div>
        </div>
        
        <div mat-dialog-actions align="end">
          <button mat-button (click)="currentView.set('main')">Back</button>
          <button mat-raised-button color="primary" 
                 (click)="loginWithNsec()" 
                 [disabled]="!nsecKey || !nsecKey.startsWith('nsec')">
            Login
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .login-options {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-top: 16px;
    }
    
    mat-card {
      cursor: pointer;
      transition: all 0.2s ease;
      height: 120px;
    }
    
    mat-card:hover {
      background-color: rgba(0, 0, 0, 0.04);
      transform: translateY(-2px);
    }
    
    .full-width {
      width: 100%;
    }
    
    .nsec-warning {
      margin-top: 16px;
      color: #f44336;
    }
  `
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
