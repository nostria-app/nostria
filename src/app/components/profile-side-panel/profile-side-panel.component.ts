import { Component, input, effect, inject, untracked, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ProfileHeaderComponent } from '../../pages/profile/profile-header/profile-header.component';
import { RouterModule } from '@angular/router';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ProfileStateService } from '../../services/profile-state.service';
import { LoggerService } from '../../services/logger.service';
import { NostrRecord } from '../../interfaces';
import { OnDemandUserDataService } from '../../services/on-demand-user-data.service';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-profile-side-panel',
  standalone: true,
  imports: [
    CommonModule,
    ProfileHeaderComponent,
    RouterModule,
    MatTabsModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="profile-side-panel-container">
      @if (isLoading()) {
        <div class="loading-container">
          <mat-spinner diameter="40"></mat-spinner>
        </div>
      } @else if (error()) {
        <div class="error-container">
          <p>{{ error() }}</p>
        </div>
      } @else {
        <app-profile-header 
          [profile]="userMetadata()"
          [pubkey]="pubkey()"
        />
        <div class="profile-content">
          <!-- Profile home needs different approach - checking its inputs -->
          <div class="profile-notes-placeholder">
            <p>Profile notes will be shown here</p>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .profile-side-panel-container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .loading-container,
    .error-container {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 32px;
      min-height: 200px;
    }

    .error-container p {
      color: var(--mat-sys-error);
    }

    .profile-content {
      flex: 1;
      overflow-y: auto;
    }

    .profile-notes-placeholder {
      padding: 24px;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
    }
  `]
})
export class ProfileSidePanelComponent {
  pubkey = input.required<string>();

  private profileState = inject(ProfileStateService);
  private logger = inject(LoggerService);
  private onDemandUserData = inject(OnDemandUserDataService);
  private data = inject(DataService);

  userMetadata = signal<NostrRecord | undefined>(undefined);
  isLoading = signal(true);
  error = signal<string | null>(null);

  constructor() {
    // Load profile when pubkey changes
    effect(async () => {
      const pubkey = this.pubkey();

      untracked(() => {
        this.isLoading.set(true);
        this.error.set(null);
      });

      try {
        // Try to get from cache first
        let profile = await this.data.getProfile(pubkey);

        if (profile) {
          untracked(() => {
            this.userMetadata.set(profile);
            this.isLoading.set(false);
          });
        } else {
          // Fetch from network
          profile = await this.onDemandUserData.getProfile(pubkey);

          untracked(() => {
            if (profile) {
              this.userMetadata.set(profile);
            } else {
              this.error.set('Profile not found');
            }
            this.isLoading.set(false);
          });
        }
      } catch (err) {
        this.logger.error('Failed to load profile:', err);
        untracked(() => {
          this.error.set('Failed to load profile');
          this.isLoading.set(false);
        });
      }
    });
  }
}
