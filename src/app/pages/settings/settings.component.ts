import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { LoggerService, LogLevel } from '../../services/logger.service';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterModule } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { StorageStatsComponent } from '../../components/storage-stats/storage-stats.component';
import { ThemeService } from '../../services/theme.service';
import { NostrService } from '../../services/nostr.service';
import { MatDialog } from '@angular/material/dialog';
import { LoginDialogComponent } from '../../components/login-dialog/login-dialog.component';
import { ConfirmDialogComponent } from '../../components/confirm-dialog/confirm-dialog.component';
import { Router } from '@angular/router';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatSelectModule,
    MatSlideToggleModule,
    RouterModule,
    MatListModule,
    MatDividerModule,
    StorageStatsComponent
  ],
  template: `
    <div class="settings-container">
      <h1 class="settings-title">Settings</h1>
      
      <mat-card appearance="outlined" class="mb-4">
        <mat-card-header>
          <mat-card-title>Logging</mat-card-title>
          <mat-card-subtitle>Configure application logging levels</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Log Level</mat-label>
            <mat-select [ngModel]="currentLogLevel()" (selectionChange)="setLogLevel($event.value)">
              <mat-option value="debug">Debug</mat-option>
              <mat-option value="info">Info</mat-option>
              <mat-option value="warn">Warning</mat-option>
              <mat-option value="error">Error</mat-option>
              <mat-option value="none">None</mat-option>
            </mat-select>
          </mat-form-field>
          <p class="log-description">
            @switch (currentLogLevel()) {
              @case ('debug') {
                Shows all log messages including detailed debug information.
              }
              @case ('info') {
                Shows informational messages, warnings and errors.
              }
              @case ('warn') {
                Shows only warnings and errors.
              }
              @case ('error') {
                Shows only error messages.
              }
              @case ('none') {
                Disables all logging output.
              }
            }
          </p>
        </mat-card-content>
      </mat-card>
      
      <!-- Storage Stats Component -->
      <app-storage-stats class="mb-4"></app-storage-stats>
      
      <mat-card appearance="outlined">
        <mat-card-header>
          <mat-card-title>About</mat-card-title>
          <mat-card-subtitle>Application information</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          <div class="about-content">
            <p>
              <strong>Nostria</strong> is a progressive web application for the Nostr protocol.
            </p>
            <p>
              Version: 0.1.0
            </p>
          </div>
          
          <mat-divider class="my-3"></mat-divider>
          
          <div class="links-section">
            <h3>Useful Links</h3>
            <mat-list>
              <mat-list-item>
                <a href="https://github.com/sondreb/nostria" target="_blank" rel="noopener">
                  <mat-icon>code</mat-icon>
                  GitHub Repository
                </a>
              </mat-list-item>
              <mat-list-item>
                <a href="https://nostr.com" target="_blank" rel="noopener">
                  <mat-icon>info</mat-icon>
                  Nostr Protocol
                </a>
              </mat-list-item>
              <mat-list-item>
                <a href="https://github.com/sondreb/nostria/issues" target="_blank" rel="noopener">
                  <mat-icon>bug_report</mat-icon>
                  Report Issues
                </a>
              </mat-list-item>
            </mat-list>
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .settings-container {
      max-width: 800px;
      margin: 0 auto;
      padding: 1rem;
    }
    
    .settings-title {
      margin-bottom: 1.5rem;
      color: #333;
    }
    
    .full-width {
      width: 100%;
    }
    
    .log-description {
      margin-top: 0.5rem;
      color: rgba(0, 0, 0, 0.6);
    }
    
    .about-content {
      margin: 1rem 0;
    }
    
    .links-section {
      margin-top: 1rem;
    }
    
    .links-section h3 {
      margin-bottom: 0.5rem;
      font-weight: 500;
    }
    
    a {
      display: flex;
      align-items: center;
      text-decoration: none;
      color: #3f51b5;
    }
    
    a mat-icon {
      margin-right: 0.5rem;
    }
    
    .mb-4 {
      margin-bottom: 2rem;
    }
    
    .my-3 {
      margin-top: 1.5rem;
      margin-bottom: 1.5rem;
    }
  `
})
export class SettingsComponent {
  private logger = inject(LoggerService);
  currentLogLevel = signal<LogLevel>(this.logger.logLevel());
  themeService = inject(ThemeService);
  nostrService = inject(NostrService);
  dialog = inject(MatDialog);
  router = inject(Router);

  constructor() {
    // Keep the current log level in sync with the service
    effect(() => {
      this.currentLogLevel.set(this.logger.logLevel());
    });
  }

  setLogLevel(level: LogLevel): void {
    this.logger.setLogLevel(level);
  }

  toggleDarkMode() {
    this.themeService.toggleDarkMode();
  }
  
  logout() {
    this.nostrService.logout();
    this.showLoginDialog();
  }
  
  showLoginDialog(): void {
    this.dialog.open(LoginDialogComponent, {
      width: '500px',
      disableClose: true
    });
  }
  
  wipeData(): void {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Confirm Data Deletion',
        message: 'Are you sure you want to delete all app data? This action cannot be undone.',
        confirmButtonText: 'Delete All Data'
      }
    });

    dialogRef.afterClosed().subscribe(async confirmed => {
      if (confirmed) {
        // Clear known localStorage keys related to the app
        const keysToRemove = [
          'nostria-theme',
          'nostria-users',
          'nostria-user',
        ];
        
        keysToRemove.forEach(key => {
          localStorage.removeItem(key);
        });
        
        // Navigate to home page before reloading
        await this.router.navigate(['/']);
        
        // Reload the application
        window.location.reload();
      }
    });
  }
}
