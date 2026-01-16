import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ProfileStateService } from '../../../services/profile-state.service';
import { TimelineFilterOptions } from '../../../interfaces/timeline-filter';

@Component({
  selector: 'app-profile-view-options',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatSlideToggleModule
  ],
  template: `
    <div dialog-content class="view-options-content">
      <div class="filter-option">
        <mat-slide-toggle 
          [checked]="timelineFilter.showNotes" 
          (change)="updateFilter('showNotes', $event.checked)">
          <div class="toggle-content">
            <mat-icon>description</mat-icon>
            <div class="toggle-text">
              <span class="toggle-label">Notes</span>
              <span class="toggle-description">Short text posts</span>
            </div>
          </div>
        </mat-slide-toggle>
      </div>

      <div class="filter-option">
        <mat-slide-toggle 
          [checked]="timelineFilter.showReposts"
          (change)="updateFilter('showReposts', $event.checked)">
          <div class="toggle-content">
            <mat-icon>repeat</mat-icon>
            <div class="toggle-text">
              <span class="toggle-label">Reposts</span>
              <span class="toggle-description">Shared content from others</span>
            </div>
          </div>
        </mat-slide-toggle>
      </div>

      <div class="filter-option">
        <mat-slide-toggle 
          [checked]="timelineFilter.showReplies"
          (change)="updateFilter('showReplies', $event.checked)">
          <div class="toggle-content">
            <mat-icon>reply</mat-icon>
            <div class="toggle-text">
              <span class="toggle-label">Replies</span>
              <span class="toggle-description">Comments on other posts</span>
            </div>
          </div>
        </mat-slide-toggle>
      </div>

      <div class="filter-option">
        <mat-slide-toggle 
          [checked]="timelineFilter.showAudio" 
          (change)="updateFilter('showAudio', $event.checked)">
          <div class="toggle-content">
            <mat-icon>audiotrack</mat-icon>
            <div class="toggle-text">
              <span class="toggle-label">Audio Clips</span>
              <span class="toggle-description">Audio posts and music</span>
            </div>
          </div>
        </mat-slide-toggle>
      </div>

      <div class="filter-option">
        <mat-slide-toggle 
          [checked]="timelineFilter.showVideo" 
          (change)="updateFilter('showVideo', $event.checked)">
          <div class="toggle-content">
            <mat-icon>movie</mat-icon>
            <div class="toggle-text">
              <span class="toggle-label">Video Clips</span>
              <span class="toggle-description">Video posts and clips</span>
            </div>
          </div>
        </mat-slide-toggle>
      </div>

      <div class="filter-divider"></div>

      <div class="filter-option advanced-option">
        <mat-slide-toggle 
          [checked]="timelineFilter.showReactions"
          (change)="updateFilter('showReactions', $event.checked)">
          <div class="toggle-content">
            <mat-icon>favorite</mat-icon>
            <div class="toggle-text">
              <span class="toggle-label">Reactions</span>
              <span class="toggle-description">Like and emoji reactions (experimental)</span>
            </div>
          </div>
        </mat-slide-toggle>
      </div>
    </div>
  `,
  styles: [`
    .view-options-content {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 0.5rem 0;
    }

    .filter-option {
      padding: 0.5rem 0;
    }

    .toggle-content {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding-left: 0.5rem;
    }

    .toggle-content mat-icon {
      color: var(--mat-sys-on-surface-variant);
      font-size: 1.25rem;
      width: 1.25rem;
      height: 1.25rem;
    }

    .toggle-text {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
    }

    .toggle-label {
      color: var(--mat-sys-on-surface);
      font-size: 0.875rem;
    }

    .toggle-description {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.75rem;
    }

    .filter-divider {
      height: 1px;
      background: var(--mat-sys-outline-variant);
      margin: 0.5rem 0;
    }

    .advanced-option {
      opacity: 0.85;
    }
  `]
})
export class ProfileViewOptionsComponent {
  private profileState = inject(ProfileStateService);

  get timelineFilter(): TimelineFilterOptions {
    return this.profileState.timelineFilter();
  }

  updateFilter(key: keyof TimelineFilterOptions, value: boolean): void {
    this.profileState.updateTimelineFilter({ [key]: value });
  }
}
