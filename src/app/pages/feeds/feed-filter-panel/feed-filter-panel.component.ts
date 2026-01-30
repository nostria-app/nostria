import { Component, inject, input, output, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDividerModule } from '@angular/material/divider';
import { FeedConfig } from '../../../services/feed.service';

/**
 * Content type definition for filter options
 */
interface ContentType {
  id: string;
  label: string;
  description: string;
  kinds: number[];
  icon: string;
}

/**
 * All available content types with their Nostr kinds
 */
const CONTENT_TYPES: ContentType[] = [
  { id: 'posts', label: 'Posts', description: 'kind 1, 1111', kinds: [1, 1111], icon: 'chat' },
  { id: 'reposts', label: 'Reposts', description: 'kind 6', kinds: [6, 16], icon: 'repeat' },
  { id: 'articles', label: 'Articles', description: 'kind 30023', kinds: [30023], icon: 'article' },
  { id: 'polls', label: 'Polls', description: 'kind 1068', kinds: [1068], icon: 'poll' },
  { id: 'voicePosts', label: 'Voice Posts', description: 'kind 1222, 1244', kinds: [1222, 1244], icon: 'mic' },
  { id: 'photoPosts', label: 'Photo Posts', description: 'kind 20', kinds: [20], icon: 'image' },
  { id: 'videoPosts', label: 'Video Posts', description: 'kind 21, 22', kinds: [21, 22, 34235, 34236], icon: 'movie' },
];

@Component({
  selector: 'app-feed-filter-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDividerModule,
  ],
  template: `
    <div class="filter-panel" (click)="$event.stopPropagation()">
      <!-- Content Types Grid -->
      <div class="content-types-grid">
        @for (type of availableContentTypes(); track type.id) {
          <button
            class="content-type-chip"
            [class.selected]="isContentTypeSelected(type)"
            (click)="toggleContentType(type)">
            <span class="chip-label">{{ type.label }}</span>
            <span class="chip-kinds">{{ type.description }}</span>
          </button>
        }
      </div>

      <!-- Show Replies Toggle -->
      <div class="toggle-option">
        <mat-checkbox
          [checked]="feed()?.showReplies ?? false"
          (change)="onShowRepliesChange($event.checked)"
          color="primary">
          Show Replies
        </mat-checkbox>
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
      width: calc(100vw - 2rem);
      max-width: 340px;
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
      flex-direction: column;
      align-items: flex-start;
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

    .chip-label {
      color: var(--mat-sys-on-surface);
      font-size: 0.875rem;
    }

    .content-type-chip.selected .chip-label {
      color: var(--mat-sys-on-primary-container);
    }

    .chip-kinds {
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.75rem;
      margin-top: 0.125rem;
    }

    .content-type-chip.selected .chip-kinds {
      color: var(--mat-sys-on-primary-container);
      opacity: 0.8;
    }

    .toggle-option {
      padding: 0.25rem 0;
    }

    .toggle-option mat-checkbox {
      --mdc-checkbox-selected-checkmark-color: var(--mat-sys-on-primary);
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
export class FeedFilterPanelComponent {
  feed = input<FeedConfig | null>(null);

  // Output events for filter changes
  kindsChanged = output<number[]>();
  showRepliesChanged = output<boolean>();
  showRepostsChanged = output<boolean>();

  // Track the original kinds for reset functionality
  private originalKinds: number[] = [];

  // Compute available content types (all types for now, could be filtered based on feed type)
  availableContentTypes = computed(() => CONTENT_TYPES);

  // Get current selected kinds from feed
  private currentKinds = computed(() => {
    const f = this.feed();
    if (!f) return [];
    // Store original kinds when first computed
    if (this.originalKinds.length === 0 && f.kinds.length > 0) {
      this.originalKinds = [...f.kinds];
    }
    return f.kinds;
  });

  /**
   * Check if a content type is selected based on current feed kinds
   */
  isContentTypeSelected(type: ContentType): boolean {
    const kinds = this.currentKinds();
    // A content type is selected if at least one of its kinds is in the feed
    return type.kinds.some(k => kinds.includes(k));
  }

  /**
   * Toggle a content type on/off
   */
  toggleContentType(type: ContentType): void {
    const kinds = [...this.currentKinds()];
    const isSelected = this.isContentTypeSelected(type);

    if (isSelected) {
      // Remove all kinds from this type
      const newKinds = kinds.filter(k => !type.kinds.includes(k));
      // Ensure we always have at least one kind
      if (newKinds.length > 0) {
        this.kindsChanged.emit(newKinds);
      }
    } else {
      // Add all kinds from this type
      const newKinds = [...new Set([...kinds, ...type.kinds])];
      this.kindsChanged.emit(newKinds);
    }

    // Special handling for reposts - also update showReposts
    if (type.id === 'reposts') {
      this.showRepostsChanged.emit(!isSelected);
    }
  }

  /**
   * Handle show replies toggle
   */
  onShowRepliesChange(checked: boolean): void {
    this.showRepliesChanged.emit(checked);
  }

  /**
   * Select all content types
   */
  selectAll(): void {
    const allKinds = CONTENT_TYPES.flatMap(t => t.kinds);
    const uniqueKinds = [...new Set(allKinds)];
    this.kindsChanged.emit(uniqueKinds);
    this.showRepostsChanged.emit(true);
  }

  /**
   * Clear all content types (keep only posts as minimum)
   */
  clearAll(): void {
    // Keep at least posts (kind 1)
    this.kindsChanged.emit([1]);
    this.showRepostsChanged.emit(false);
  }

  /**
   * Reset to original feed configuration
   */
  reset(): void {
    const f = this.feed();
    if (f && this.originalKinds.length > 0) {
      this.kindsChanged.emit([...this.originalKinds]);
    } else if (f) {
      // Default reset: posts and reposts
      this.kindsChanged.emit([1, 6]);
    }
    this.showRepostsChanged.emit(true);
    this.showRepliesChanged.emit(false);
  }
}
