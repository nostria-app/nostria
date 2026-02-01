import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { PROFILE_STATE } from '../../../services/profile-state-factory.service';
import { TimelineFilterOptions } from '../../../interfaces/timeline-filter';

/**
 * Filter option definition for profile view
 */
interface FilterOption {
  id: keyof TimelineFilterOptions;
  label: string;
  description: string;
  icon: string;
  experimental?: boolean;
}

/**
 * All available filter options for profile view (excluding showReplies which is separate)
 */
const FILTER_OPTIONS: FilterOption[] = [
  { id: 'showNotes', label: 'Posts', description: 'Short text posts', icon: 'description' },
  { id: 'showReposts', label: 'Reposts', description: 'Shared content from others', icon: 'repeat' },
  { id: 'showAudio', label: 'Audio Posts', description: 'Audio posts and music', icon: 'audiotrack' },
  { id: 'showVideo', label: 'Video Posts', description: 'Video posts and clips', icon: 'movie' },
  { id: 'showReactions', label: 'Reactions', description: 'Like and emoji reactions', icon: 'favorite', experimental: true },
];

/**
 * Separate definition for Show Replies option
 */
const REPLIES_OPTION: FilterOption = {
  id: 'showReplies',
  label: 'Show Replies',
  description: 'Comments on other posts',
  icon: 'reply'
};

@Component({
  selector: 'app-profile-view-options-inline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatDividerModule
  ],
  template: `
    <div class="filter-panel" (click)="$event.stopPropagation()">
      <!-- Content Types Grid -->
      <div class="content-types-grid">
        @for (option of filterOptions; track option.id) {
          <button
            class="content-type-chip"
            [class.selected]="isSelected(option.id)"
            [class.experimental]="option.experimental"
            (click)="toggleOption(option.id)">
            <mat-icon class="chip-icon">{{ option.icon }}</mat-icon>
            <div class="chip-text">
              <span class="chip-label">{{ option.label }}</span>
              <span class="chip-description">{{ option.description }}</span>
            </div>
          </button>
        }
      </div>

      <!-- Show Replies Toggle (as card-style button) -->
      <div class="toggle-option">
        <button
          class="content-type-chip full-width"
          [class.selected]="isSelected(repliesOption.id)"
          (click)="toggleOption(repliesOption.id)">
          <mat-icon class="chip-icon">{{ repliesOption.icon }}</mat-icon>
          <div class="chip-text">
            <span class="chip-label">{{ repliesOption.label }}</span>
            <span class="chip-description">{{ repliesOption.description }}</span>
          </div>
        </button>
      </div>

      <!-- Actions Row -->
      <div class="actions-row">
        <button mat-stroked-button class="action-btn" (click)="selectAll()">
          Select All
        </button>
        <button mat-stroked-button class="action-btn" (click)="clearAll()">
          Clear All
        </button>
        <button mat-stroked-button class="action-btn" (click)="reset()">
          Reset
        </button>
      </div>
    </div>
  `,
  styles: [`
    .filter-panel {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      padding: 1rem;
      width: 340px;
      max-width: calc(100vw - 2rem);
      background: var(--mat-sys-surface-container);
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      box-sizing: border-box;
    }

    .content-types-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.5rem;
    }

    @media (max-width: 360px) {
      .content-types-grid {
        grid-template-columns: 1fr;
      }
    }

    .content-type-chip {
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);
      cursor: pointer;
      transition: all 0.15s ease;
      text-align: left;
    }

    .content-type-chip:hover {
      background: var(--mat-sys-surface-container-high);
      border-color: var(--mat-sys-outline);
    }

    .content-type-chip.selected {
      background: var(--mat-sys-primary-container);
      border-color: var(--mat-sys-primary);
    }

    .content-type-chip.experimental {
      opacity: 0.85;
    }

    .content-type-chip.full-width {
      width: 100%;
    }

    .chip-icon {
      color: var(--mat-sys-on-surface-variant);
      font-size: 1.25rem;
      width: 1.25rem;
      height: 1.25rem;
      flex-shrink: 0;
    }

    .content-type-chip.selected .chip-icon {
      color: var(--mat-sys-on-primary-container);
    }

    .chip-text {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      min-width: 0;
    }

    .chip-label {
      color: var(--mat-sys-on-surface);
      font-size: 0.875rem;
    }

    .content-type-chip.selected .chip-label {
      color: var(--mat-sys-on-primary-container);
    }

    .chip-description {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.75rem;
    }

    .content-type-chip.selected .chip-description {
      color: var(--mat-sys-on-primary-container);
      opacity: 0.8;
    }

    .toggle-option {
      padding: 0.25rem 0;
    }

    .actions-row {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .action-btn {
      flex: 1;
      min-width: 70px;
      font-size: 0.8125rem;
    }
  `]
})
export class ProfileViewOptionsInlineComponent {
  private profileState = inject(PROFILE_STATE);

  readonly filterOptions = FILTER_OPTIONS;
  readonly repliesOption = REPLIES_OPTION;

  get timelineFilter(): TimelineFilterOptions {
    return this.profileState.timelineFilter();
  }

  isSelected(key: keyof TimelineFilterOptions): boolean {
    return this.timelineFilter[key] as boolean;
  }

  toggleOption(key: keyof TimelineFilterOptions): void {
    const currentValue = this.timelineFilter[key] as boolean;
    this.profileState.updateTimelineFilter({ [key]: !currentValue });
  }

  /**
   * Select all filter options
   */
  selectAll(): void {
    this.profileState.updateTimelineFilter({
      showNotes: true,
      showReposts: true,
      showReplies: true,
      showAudio: true,
      showVideo: true,
      showReactions: true,
    });
  }

  /**
   * Clear all filter options (keep only posts as minimum)
   */
  clearAll(): void {
    this.profileState.updateTimelineFilter({
      showNotes: true,
      showReposts: false,
      showReplies: false,
      showAudio: false,
      showVideo: false,
      showReactions: false,
    });
  }

  /**
   * Reset to default filter configuration
   */
  reset(): void {
    this.profileState.updateTimelineFilter({
      showNotes: true,
      showReposts: true,
      showReplies: false,
      showAudio: true,
      showVideo: true,
      showReactions: false,
    });
  }
}
