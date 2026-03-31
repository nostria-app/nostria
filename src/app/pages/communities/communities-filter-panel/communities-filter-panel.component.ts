import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { CommunityListFilters, CommunitySortOption } from '../../../interfaces/community-filters';

interface SortOptionDef {
  id: CommunitySortOption;
  label: string;
}

const SORT_OPTIONS: SortOptionDef[] = [
  { id: 'default', label: 'Newest first' },
  { id: 'name-asc', label: 'Name (A-Z)' },
  { id: 'name-desc', label: 'Name (Z-A)' },
  { id: 'oldest', label: 'Oldest first' },
];

@Component({
  selector: 'app-communities-filter-panel',
  imports: [
    CommonModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDividerModule,
  ],
  template: `
    <div class="filter-panel" role="dialog" aria-label="Community filters">
      <div class="section-label">Sort</div>
      <div class="sort-options-grid" role="radiogroup" aria-label="Community sort options">
        @for (option of sortOptions; track option.id) {
          <button
            class="sort-option-chip"
            [class.selected]="sortOption() === option.id"
            [attr.aria-pressed]="sortOption() === option.id"
            (click)="sortOptionChanged.emit(option.id)">
            <span class="chip-label">{{ option.label }}</span>
          </button>
        }
      </div>

      <mat-divider></mat-divider>

      <div class="section-label">Show only</div>
      <div class="filter-options">
        <mat-checkbox
          [checked]="filters().joinedOnly"
          (change)="filtersChanged.emit({ joinedOnly: $event.checked })">
          Joined communities
        </mat-checkbox>
        <mat-checkbox
          [checked]="filters().hasImage"
          (change)="filtersChanged.emit({ hasImage: $event.checked })">
          Communities with artwork
        </mat-checkbox>
        <mat-checkbox
          [checked]="filters().hasRules"
          (change)="filtersChanged.emit({ hasRules: $event.checked })">
          Communities with rules
        </mat-checkbox>
      </div>

      <div class="actions-row">
        <button mat-stroked-button class="action-btn" (click)="resetRequested.emit()">
          Reset
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
      width: min(320px, calc(100vw - 2rem));
      max-width: calc(100vw - 2rem);
      background: var(--mat-sys-surface-container);
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      box-sizing: border-box;
    }

    .section-label {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.75rem;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }

    .sort-options-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.5rem;
    }

    .sort-option-chip {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      padding: 0.625rem 0.75rem;
      border-radius: 10px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);
      cursor: pointer;
      transition: background-color 0.15s ease, border-color 0.15s ease;
      text-align: center;
    }

    .sort-option-chip:hover {
      background: var(--mat-sys-surface-container-high);
      border-color: var(--mat-sys-outline);
    }

    .sort-option-chip.selected {
      background: var(--mat-sys-primary-container);
      border-color: var(--mat-sys-primary);
    }

    .chip-label {
      color: var(--mat-sys-on-surface);
      font-size: 0.8125rem;
    }

    .sort-option-chip.selected .chip-label {
      color: var(--mat-sys-on-primary-container);
    }

    .filter-options {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .actions-row {
      display: flex;
      gap: 0.5rem;
    }

    .action-btn {
      flex: 1;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunitiesFilterPanelComponent {
  filters = input.required<CommunityListFilters>();
  sortOption = input<CommunitySortOption>('default');

  filtersChanged = output<Partial<CommunityListFilters>>();
  sortOptionChanged = output<CommunitySortOption>();
  resetRequested = output<void>();

  sortOptions = SORT_OPTIONS;
}
