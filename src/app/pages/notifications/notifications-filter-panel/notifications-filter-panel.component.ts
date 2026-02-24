import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { NotificationType } from '../../../services/database.service';

export type WotFilterLevel = 'off' | 'low' | 'medium' | 'high';

/**
 * Notification filter state interface
 */
export interface NotificationFilters {
  [NotificationType.NEW_FOLLOWER]: boolean;
  [NotificationType.MENTION]: boolean;
  [NotificationType.REPOST]: boolean;
  [NotificationType.REPLY]: boolean;
  [NotificationType.REACTION]: boolean;
  [NotificationType.ZAP]: boolean;
}

/**
 * Filter option definition
 */
interface FilterOption {
  type: NotificationType;
  label: string;
  icon: string;
}

/**
 * All available filter options for content notifications
 */
const FILTER_OPTIONS: FilterOption[] = [
  { type: NotificationType.NEW_FOLLOWER, label: 'Followers', icon: 'person_add' },
  { type: NotificationType.MENTION, label: 'Mentions', icon: 'alternate_email' },
  { type: NotificationType.REPOST, label: 'Reposts', icon: 'repeat' },
  { type: NotificationType.REPLY, label: 'Replies', icon: 'reply' },
  { type: NotificationType.REACTION, label: 'Reactions', icon: 'favorite' },
  { type: NotificationType.ZAP, label: 'Zaps', icon: 'bolt' },
];

@Component({
  selector: 'app-notifications-filter-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatCheckboxModule,
    MatButtonToggleModule,
    MatDividerModule,
  ],
  template: `
    <div class="filter-panel" role="dialog" aria-label="Filter options">
      <!-- Filter Options -->
      <div class="section-label">Filters</div>
      <div class="filter-options">
        @for (option of filterOptions; track option.type) {
          <mat-checkbox
            [checked]="filters()[option.type]"
            (change)="onFilterChange(option.type, $event.checked)">
            <div class="filter-option-content">
              <mat-icon class="filter-icon">{{ option.icon }}</mat-icon>
              <span>{{ option.label }}</span>
            </div>
          </mat-checkbox>
        }
      </div>

      <mat-divider></mat-divider>

      <!-- View Options -->
      <div class="section-label">View</div>
      <div class="filter-options">
        <mat-checkbox
          [checked]="showUnreadOnly()"
          (change)="onUnreadOnlyChange($event.checked)">
          <div class="filter-option-content">
            <mat-icon class="filter-icon">mark_email_unread</mat-icon>
            <span>Unread only</span>
          </div>
        </mat-checkbox>
        <mat-checkbox
          [checked]="showSystemNotifications()"
          (change)="onSystemNotificationsChange($event.checked)">
          <div class="filter-option-content">
            <mat-icon class="filter-icon">priority</mat-icon>
            <span>System Notifications</span>
          </div>
        </mat-checkbox>
      </div>

      <mat-divider></mat-divider>

      <div class="section-label">Web of Trust</div>
      <mat-button-toggle-group
        [value]="wotFilterLevel()"
        (valueChange)="onWotFilterLevelChange($event)"
        class="wot-toggle-group"
        hideSingleSelectionIndicator
        aria-label="Web of Trust filter level">
        <mat-button-toggle value="off">Off</mat-button-toggle>
        <mat-button-toggle value="low">Low</mat-button-toggle>
        <mat-button-toggle value="medium">Medium</mat-button-toggle>
        <mat-button-toggle value="high">High</mat-button-toggle>
      </mat-button-toggle-group>

      <!-- Actions Row -->
      <div class="actions-row">
        <button mat-stroked-button class="action-btn" (click)="reset()">
          Reset All
        </button>
      </div>
    </div>
  `,
  styles: [`
    .filter-panel {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      min-width: 260px;
      max-width: 320px;
      background: var(--mat-sys-surface-container);
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
    }

    .section-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 0.25rem;
    }

    .filter-options {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .filter-options mat-checkbox {
      --mdc-checkbox-selected-checkmark-color: var(--mat-sys-on-primary);
    }

    .filter-option-content {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .filter-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      opacity: 0.7;
    }

    mat-divider {
      margin: 0.25rem 0;
    }

    .actions-row {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.25rem;
    }

    .wot-toggle-group {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      align-items: stretch;
    }

    .action-btn {
      flex: 1;
      font-size: 0.8125rem;
    }
  `]
})
export class NotificationsFilterPanelComponent {
  filters = input.required<Record<NotificationType, boolean>>();
  showSystemNotifications = input<boolean>(false);
  showUnreadOnly = input<boolean>(false);
  wotFilterLevel = input<WotFilterLevel>('off');

  // Output events for changes
  filtersChanged = output<Partial<Record<NotificationType, boolean>>>();
  showSystemNotificationsChanged = output<boolean>();
  showUnreadOnlyChanged = output<boolean>();
  wotFilterLevelChanged = output<WotFilterLevel>();

  // Expose filter options
  filterOptions = FILTER_OPTIONS;

  /**
   * Handle filter checkbox change
   */
  onFilterChange(type: NotificationType, checked: boolean): void {
    this.filtersChanged.emit({ [type]: checked });
  }

  /**
   * Handle system notifications toggle
   */
  onSystemNotificationsChange(checked: boolean): void {
    this.showSystemNotificationsChanged.emit(checked);
  }

  /**
   * Handle unread only toggle
   */
  onUnreadOnlyChange(checked: boolean): void {
    this.showUnreadOnlyChanged.emit(checked);
  }

  /**
   * Handle Web of Trust filter level change
   */
  onWotFilterLevelChange(level: string): void {
    if (level === 'off' || level === 'low' || level === 'medium' || level === 'high') {
      this.wotFilterLevelChanged.emit(level);
    }
  }

  /**
   * Reset all filters to defaults (all enabled)
   */
  reset(): void {
    this.filtersChanged.emit({
      [NotificationType.NEW_FOLLOWER]: true,
      [NotificationType.MENTION]: true,
      [NotificationType.REPOST]: true,
      [NotificationType.REPLY]: true,
      [NotificationType.REACTION]: true,
      [NotificationType.ZAP]: true,
    });
    this.showSystemNotificationsChanged.emit(false);
    this.showUnreadOnlyChanged.emit(false);
    this.wotFilterLevelChanged.emit('off');
  }
}
