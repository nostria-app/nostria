import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

type BookmarkSortMode = 'default' | 'published-desc' | 'published-asc';

@Component({
  selector: 'app-bookmark-sort-filter-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="filter-panel" role="dialog" aria-label="Sort bookmarks">
      <div class="section-label">Sort By</div>
      <div class="sort-options-grid" role="radiogroup" aria-label="Bookmark sort options">
        @for (option of sortOptions; track option.id) {
          <button
            class="sort-option-chip"
            [class.selected]="sortMode() === option.id"
            [attr.aria-pressed]="sortMode() === option.id"
            (click)="sortModeChange.emit(option.id)">
            <span class="chip-label">{{ option.label }}</span>
          </button>
        }
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
      box-sizing: border-box;
    }

    .section-label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 0.25rem;
    }

    .sort-options-grid {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .sort-option-chip {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface);
      cursor: pointer;
      transition: all 0.15s ease;
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
  `],
})
export class BookmarkSortFilterPanelComponent {
  sortMode = input<BookmarkSortMode>('default');
  sortModeChange = output<BookmarkSortMode>();

  readonly sortOptions: { id: BookmarkSortMode; label: string }[] = [
    { id: 'default', label: 'Default' },
    { id: 'published-desc', label: 'Published: Newest' },
    { id: 'published-asc', label: 'Published: Oldest' },
  ];
}
