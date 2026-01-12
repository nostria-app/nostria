import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FollowSetsService, FollowSet } from '../../services/follow-sets.service';
import { FollowingService, FollowingProfile } from '../../services/following.service';
import { LoggerService } from '../../services/logger.service';
import { NotificationService } from '../../services/notification.service';
import { SettingsService } from '../../services/settings.service';
import { ImageCacheService } from '../../services/image-cache.service';

export interface EditPeopleListDialogData {
  followSet: FollowSet;
}

export interface EditPeopleListDialogResult {
  followSet: FollowSet;
  removedPubkeys: string[];
}

@Component({
  selector: 'app-edit-people-list-dialog',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  template: `
    <div class="dialog-container">
      <div class="dialog-header">
        <h2 class="dialog-title">Edit {{ data.followSet.title }}</h2>
        <button mat-icon-button class="close-button" (click)="cancel()">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div class="dialog-content">
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
    }

    .dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    .dialog-title {
      margin: 0;
      font-size: 20px;
      font-weight: 500;
    }

    .close-button {
      margin-right: -12px;
    }

    .dialog-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px 24px;
      min-height: 200px;
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
      justify-content: flex-end;
      gap: 8px;
      padding: 16px 24px;
      border-top: 1px solid var(--mat-sys-outline-variant);
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

  // Injected data
  readonly data: EditPeopleListDialogData = inject(MAT_DIALOG_DATA);

  // State
  loading = signal(true);
  profiles = signal<FollowingProfile[]>([]);
  removedPubkeys = signal<string[]>([]);

  // Computed
  hasChanges = computed(() => this.removedPubkeys().length > 0);

  constructor() {
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

    if (!removed.length) {
      this.cancel();
      return;
    }

    try {
      // Remove each pubkey from the follow set
      for (const pubkey of removed) {
        await this.followSetsService.removeFromFollowSet(set.dTag, pubkey);
      }

      this.notificationService.notify(`Removed ${removed.length} ${removed.length === 1 ? 'person' : 'people'} from ${set.title}`);

      // Get updated follow set
      const updatedSet = this.followSetsService.getFollowSetByDTag(set.dTag);

      // Close dialog with result
      this.dialogRef.close({
        followSet: updatedSet || set,
        removedPubkeys: removed
      });
    } catch (error) {
      this.logger.error('Failed to save follow set changes:', error);
      this.notificationService.notify('Failed to save changes');
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
