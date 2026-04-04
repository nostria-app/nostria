import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DatabaseService } from '../../services/database.service';

@Component({
  selector: 'app-database-error-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div style="max-width: 600px">
      <h2 mat-dialog-title style="display: flex; align-items: center; gap: 12px;">
        <mat-icon style="color: #f44336;">error</mat-icon>
        <span>{{ title() }}</span>
      </h2>
      <mat-dialog-content>
        <p style="margin-bottom: 16px;">
          <strong>Nostria is unable to access the browser's IndexedDB database.</strong>
        </p>

        @if (storageFailureMode() === 'indexeddb-unavailable') {
          <p style="margin-bottom: 16px;">
            Nostria tested the browser's IndexedDB APIs directly, and the browser failed those low-level operations.
          </p>
          <p style="margin-bottom: 16px;">
            This is broader than a single broken Nostria database. It usually means browser storage is unavailable in this profile or an extension/privacy setting is interfering.
          </p>
          <p style="margin-bottom: 8px;">
            <strong>Recommended next steps:</strong>
          </p>
          <ol style="padding-left: 20px; margin-bottom: 20px;">
            <li style="margin-bottom: 8px;">Completely close the browser and reopen it</li>
            <li style="margin-bottom: 8px;">Disable browser extensions for this site and retry</li>
            <li style="margin-bottom: 8px;">Try the same URL in a different browser profile or another browser</li>
            <li style="margin-bottom: 8px;">If it only fails in one profile, clear that profile's site storage manually from browser settings</li>
          </ol>
        } @else {
          <p style="margin-bottom: 16px;">
            This typically happens when:
          </p>
          <ul style="margin-bottom: 16px; padding-left: 20px;">
            <li>Another browser tab or window has a lock on the database</li>
            <li>The browser's storage has become corrupted</li>
            <li>A browser extension is interfering with database access</li>
          </ul>
          <p style="margin-bottom: 8px;">
            <strong>To resolve this issue:</strong>
          </p>
          <ol style="padding-left: 20px; margin-bottom: 20px;">
            <li style="margin-bottom: 8px;">Close ALL browser tabs and windows running Nostria</li>
            <li style="margin-bottom: 8px;">Completely restart your browser (close and reopen)</li>
            <li style="margin-bottom: 8px;">
              <strong>If the problem persists</strong>, use "Delete Database" to create a fresh database
            </li>
            <li style="margin-bottom: 8px;">
              <strong>Only as last resort</strong>, restart your device
            </li>
          </ol>
        }

        @if (operationStatus()) {
          <div style="padding: 12px; background-color: var(--mat-sys-surface-container); border-radius: 8px; margin-bottom: 16px;">
            @if (operationStatus() === 'delete-success') {
              <div style="display: flex; align-items: start; gap: 8px;">
                <mat-icon style="color: var(--mat-success-color);">check_circle</mat-icon>
                <div>
                  <p style="margin: 0 0 8px 0;"><strong>Database deletion successful!</strong></p>
                  <p style="margin: 0;">Please reload this page to restart the application.</p>
                </div>
              </div>
            } @else if (operationStatus() === 'delete-failed') {
              <div style="display: flex; align-items: start; gap: 8px;">
                <mat-icon style="color: #f44336;">error</mat-icon>
                <div>
                  <p style="margin: 0 0 8px 0;"><strong>Database deletion failed</strong></p>
                  <p style="margin: 0;">
                    The browser could not delete the site database. Restart the browser, disable extensions for this site, and retry in another browser profile if needed.
                  </p>
                </div>
              </div>
            }
          </div>
        }

        @if (!operationStatus() && canAttemptDeletion()) {
          <div style="padding: 12px; background-color: var(--mat-sys-surface-container); border-radius: 8px; margin-top: 16px;">
            <div style="display: flex; align-items: start; gap: 8px;">
              <mat-icon style="color: #2196f3;">info</mat-icon>
              <div style="flex: 1;">
                <p style="margin: 0 0 8px 0;"><strong>About Delete Database:</strong></p>
                <p style="margin: 0 0 8px 0;">
                  This deletes the cache database, allowing the app to create a fresh database.
                  <strong>This is the recommended solution if restarting doesn't help.</strong>
                </p>
                <p style="margin: 0;">
                  Note: You'll start with a fresh cache, but your account data is stored in browser extensions and won't be affected.
                </p>
              </div>
            </div>
          </div>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        @if (operationStatus() === 'delete-success') {
          <button mat-flat-button (click)="reloadPage()">
            Reload Page
          </button>
        } @else {
          @if (!isProcessing()) {
            <button 
              mat-button  
              (click)="attemptReload()">
              Attempt Reload
            </button>
            @if (canAttemptDeletion()) {
              <button 
                mat-flat-button  
                (click)="attemptDeletion()"
                [disabled]="operationStatus() === 'delete-failed'">
                @if (operationStatus() === 'delete-failed') {
                  Deletion Failed
                } @else {
                  Delete Database
                }
              </button>
            }
          } @else {
            <div style="display: flex; align-items: center; gap: 12px; padding: 8px 16px;">
              <mat-spinner diameter="20"></mat-spinner>
              <span>{{ processingMessage() }}</span>
            </div>
          }
        }
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      mat-dialog-content {
        line-height: 1.6;
      }
      
      ul, ol {
        line-height: 1.8;
      }
      
      li {
        margin-bottom: 4px;
      }

      mat-icon {
        flex-shrink: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DatabaseErrorDialogComponent {
  private dialogRef = inject(MatDialogRef<DatabaseErrorDialogComponent>);
  private database = inject(DatabaseService);

  isProcessing = signal(false);
  processingMessage = signal('');
  operationStatus = signal<'delete-success' | 'delete-failed' | null>(null);
  protected readonly storageFailureMode = this.database.storageFailureMode;

  protected title(): string {
    switch (this.storageFailureMode()) {
      case 'indexeddb-unavailable':
        return 'Browser Storage Unavailable';
      case 'shared-database-reset-failed':
        return 'Database Reset Failed';
      default:
        return 'Database Locked';
    }
  }

  protected canAttemptDeletion(): boolean {
    return this.storageFailureMode() !== 'indexeddb-unavailable';
  }

  async attemptDeletion(): Promise<void> {
    this.isProcessing.set(true);
    this.processingMessage.set('Deleting database...');
    this.operationStatus.set(null);

    try {
      await this.database.wipe();
      this.operationStatus.set('delete-success');
    } catch (error) {
      console.error('Failed to delete database:', error);
      this.operationStatus.set('delete-failed');
    } finally {
      this.isProcessing.set(false);
      this.processingMessage.set('');
    }
  }

  reloadPage(): void {
    window.location.reload();
  }

  attemptReload(): void {
    window.location.reload();
  }
}
