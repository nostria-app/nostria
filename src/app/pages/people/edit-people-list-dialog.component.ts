import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FollowSetsService, FollowSet } from '../../services/follow-sets.service';
import { FollowingService, FollowingProfile } from '../../services/following.service';
import { LoggerService } from '../../services/logger.service';
import { NotificationService } from '../../services/notification.service';
import { SettingsService } from '../../services/settings.service';
import { ImageCacheService } from '../../services/image-cache.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../components/confirm-dialog/confirm-dialog.component';

export interface EditPeopleListDialogData {
  followSet: FollowSet;
}

export interface EditPeopleListDialogResult {
  followSet: FollowSet;
  removedPubkeys: string[];
  deleted?: boolean;
}

@Component({
  selector: 'app-edit-people-list-dialog',
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatInputModule,
    MatFormFieldModule,
  ],
  template: `
    <div class="dialog-container">
      <div class="dialog-header">
        <h2 class="dialog-title">Edit List</h2>
        <button mat-icon-button class="close-button" (click)="cancel()">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div class="dialog-content">
        <!-- List Name Input -->
        <div class="name-section">
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>List Name</mat-label>
            <input matInput 
                   [ngModel]="listName()"
                   (ngModelChange)="listName.set($event)"
                   placeholder="Enter list name"
                   maxlength="50"
                   autocomplete="off" />
            <mat-icon matIconPrefix>label</mat-icon>
          </mat-form-field>
        </div>

        <!-- People List -->
        @if (loading()) {
        <div class="loading-container">
          <mat-spinner diameter="40"></mat-spinner>
        </div>
        } @else if (profiles().length === 0) {
        <div class="empty-state">
          <mat-icon>people_outline</mat-icon>
          <p>No people in this list</p>
        </div>
        } @else {
        <div class="people-list">
          @for (profile of profiles(); track profile.pubkey) {
          <div class="person-item">
            <div class="person-info">
              @if (profile.profile?.data?.picture) {
              <img [src]="getOptimizedImageUrl(profile.profile?.data?.picture)" 
                   class="person-avatar" 
                   alt="Profile picture" />
              } @else {
              <div class="person-avatar-placeholder">
                <mat-icon>person</mat-icon>
              </div>
              }
              <div class="person-details">
                <div class="person-name">
                  {{ profile.profile?.data?.display_name || profile.profile?.data?.name || 'Unknown' }}
                </div>
                @if (profile.profile?.data?.nip05) {
                <div class="person-nip05">{{ profile.profile?.data?.nip05 }}</div>
                }
              </div>
            </div>
            <button mat-icon-button 
                    class="remove-button"
                    (click)="removePerson(profile.pubkey)"
                    matTooltip="Remove from list">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          }
        </div>
        }
      </div>

      <div class="dialog-actions">
        <button mat-button class="delete-button" (click)="deleteList()">
          <mat-icon>delete</mat-icon>
          Delete List
        </button>
        <span class="spacer"></span>
        <button mat-button (click)="cancel()">Cancel</button>
        <button mat-flat-button color="primary" (click)="save()" [disabled]="!hasChanges()">
          Save Changes
        </button>
      </div>
    </div>
  `,
  styles: [`
    .dialog-container {
      display: flex;
      flex-direction: column;
      max-height: 80vh;
      width: 500px;
      max-width: 90vw;
      overflow: hidden;
    }

    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      min-width: 0;
    }

    .dialog-title {
      margin: 0;
      font-size: 20px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 1;
    }

    .close-button {
      margin-right: -12px;
      flex-shrink: 0;
    }

    .dialog-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px 24px;
      min-height: 200px;
    }

    .name-section {
      margin-bottom: 16px;
      
      .full-width {
        width: 100%;
      }
    }

    .loading-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 200px;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 200px;
      color: var(--mat-sys-on-surface-variant);
      
      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
      }

      p {
        margin: 0;
        font-size: 14px;
      }
    }

    .people-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .person-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      transition: background-color 0.2s;

      &:hover {
        background: var(--mat-sys-surface-container-high);
      }
    }

    .person-info {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 1;
      min-width: 0;
    }

    .person-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      object-fit: cover;
    }

    .person-avatar-placeholder {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--mat-sys-surface-variant);
      display: flex;
      align-items: center;
      justify-content: center;
      
      mat-icon {
        color: var(--mat-sys-on-surface-variant);
      }
    }

    .person-details {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    .person-name {
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .person-nip05 {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .remove-button {
      color: var(--mat-sys-error);
      
      &:hover {
        background: rgba(var(--mat-sys-error), 0.1);
      }
    }

    .dialog-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 16px 24px;
      border-top: 1px solid var(--mat-sys-outline-variant);

      .delete-button {
        color: var(--mat-sys-error);
        
        mat-icon {
          margin-right: 4px;
        }
      }

      .spacer {
        flex: 1;
      }
    }
  `]
})
export class EditPeopleListDialogComponent {
  private readonly followSetsService = inject(FollowSetsService);
  private readonly followingService = inject(FollowingService);
  private readonly logger = inject(LoggerService);
  private readonly notificationService = inject(NotificationService);
  private readonly settings = inject(SettingsService);
  private readonly imageCacheService = inject(ImageCacheService);
  private readonly dialogRef = inject(MatDialogRef<EditPeopleListDialogComponent>);
  private readonly dialog = inject(MatDialog);

  // Injected data
  readonly data: EditPeopleListDialogData = inject(MAT_DIALOG_DATA);

  // State
  loading = signal(true);
  profiles = signal<FollowingProfile[]>([]);
  removedPubkeys = signal<string[]>([]);
  listName = signal('');

  // Computed
  hasChanges = computed(() => 
    this.removedPubkeys().length > 0 || 
    this.listName().trim() !== this.data.followSet.title.trim()
  );

  constructor() {
    // Initialize list name
    this.listName.set(this.data.followSet.title);
    
    // Load profiles for the follow set
    this.loadProfiles();
  }

  private async loadProfiles(): Promise<void> {
    try {
      const set = this.data.followSet;
      if (!set || !set.pubkeys.length) {
        this.profiles.set([]);
        this.loading.set(false);
        return;
      }

      const profiles = await this.followingService.loadProfilesForPubkeys(set.pubkeys);
      this.profiles.set(profiles);
    } catch (error) {
      this.logger.error('Failed to load profiles for follow set:', error);
      this.notificationService.notify('Failed to load profiles');
    } finally {
      this.loading.set(false);
    }
  }

  removePerson(pubkey: string): void {
    // Remove from displayed profiles
    this.profiles.update(profiles => profiles.filter(p => p.pubkey !== pubkey));

    // Track for removal
    this.removedPubkeys.update(removed => [...removed, pubkey]);
  }

  async save(): Promise<void> {
    const set = this.data.followSet;
    const removed = this.removedPubkeys();
    const newName = this.listName().trim();

    // Check if there are any changes at all
    if (!removed.length && newName === set.title.trim()) {
      this.cancel();
      return;
    }

    try {
      // Get the updated pubkey list
      const updatedPubkeys = set.pubkeys.filter(pk => !removed.includes(pk));

      // Save the follow set with updated title and pubkeys
      // This will publish a new event with the updated data
      const result = await this.followSetsService.saveFollowSet(
        set.dTag,
        newName || set.title, // Use new name if provided, fallback to original
        updatedPubkeys,
        set.isPrivate
      );

      if (result) {
        const changes: string[] = [];
        if (removed.length > 0) {
          changes.push(`Removed ${removed.length} ${removed.length === 1 ? 'person' : 'people'}`);
        }
        if (newName !== set.title.trim()) {
          changes.push(`Renamed to "${newName}"`);
        }
        
        this.notificationService.notify(changes.join(' and '));

        // Close dialog with result
        this.dialogRef.close({
          followSet: result,
          removedPubkeys: removed
        });
      } else {
        this.notificationService.notify('Failed to save changes');
      }
    } catch (error) {
      this.logger.error('Failed to save follow set changes:', error);
      this.notificationService.notify('Failed to save changes');
    }
  }

  async deleteList(): Promise<void> {
    const set = this.data.followSet;

    const dialogData: ConfirmDialogData = {
      title: 'Delete List',
      message: `Are you sure you want to delete "${set.title}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      confirmColor: 'warn'
    };

    const confirmRef = this.dialog.open(ConfirmDialogComponent, {
      data: dialogData,
      width: '400px'
    });

    const confirmed = await confirmRef.afterClosed().toPromise();

    if (confirmed) {
      try {
        const success = await this.followSetsService.deleteFollowSet(set.dTag);
        if (success) {
          this.notificationService.notify(`Deleted list "${set.title}"`);
          this.dialogRef.close({ followSet: set, removedPubkeys: [], deleted: true });
        } else {
          this.notificationService.notify('Failed to delete list');
        }
      } catch (error) {
        this.logger.error('Failed to delete follow set:', error);
        this.notificationService.notify('Failed to delete list');
      }
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }

  getOptimizedImageUrl(originalUrl: string | undefined): string {
    if (!originalUrl) return '';

    if (this.settings.settings().imageCacheEnabled) {
      return this.imageCacheService.getOptimizedImageUrl(originalUrl);
    }
    return originalUrl;
  }
}
