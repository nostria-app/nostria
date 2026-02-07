import { Component, inject, output, computed, ChangeDetectionStrategy, input, signal, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { LocalSettingsService, DEFAULT_CONTENT_FILTER } from '../../../services/local-settings.service';
import { FeedConfig, FeedService } from '../../../services/feed.service';

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
 * Note: Articles are excluded as there's a dedicated Articles feature in the app
 */
const CONTENT_TYPES: ContentType[] = [
  { id: 'posts', label: 'Posts', description: 'Short text posts', kinds: [1, 1111], icon: 'description' },
  { id: 'reposts', label: 'Reposts', description: 'Shared content from others', kinds: [6, 16], icon: 'repeat' },
  { id: 'voicePosts', label: 'Audio Posts', description: 'Audio posts and music', kinds: [1222, 1244], icon: 'audiotrack' },
  { id: 'photoPosts', label: 'Photo Posts', description: 'Image galleries', kinds: [20], icon: 'image' },
  { id: 'videoPosts', label: 'Video Posts', description: 'Video posts and clips', kinds: [21, 22, 34235, 34236], icon: 'movie' },
];

/**
 * Get all standard kinds from CONTENT_TYPES (kinds that can be toggled via quick buttons)
 */
const ALL_STANDARD_KINDS = CONTENT_TYPES.flatMap(t => t.kinds);

/**
 * Check if a kinds array represents a standard selection (subset of known content types)
 * Returns true only if ALL kinds in the array are from our standard content types
 */
function isStandardKindsSelection(kinds: number[]): boolean {
  // Check if all kinds in the array are from our standard content types
  return kinds.length > 0 && kinds.every(k => ALL_STANDARD_KINDS.includes(k));
}

@Component({
  selector: 'app-feed-filter-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatDividerModule,
    MatButtonToggleModule,
  ],
  template: `
    <div class="filter-panel" (click)="$event.stopPropagation()">
      <!-- Authored / Mentioned toggle - only shown for list feeds -->
      @if (isListFeed()) {
        <div class="source-mode-section">
          <div class="section-label">Show events where list members are</div>
          <mat-button-toggle-group
            [value]="currentMentionedMode() ? 'mentioned' : 'authored'"
            (change)="onSourceModeChange($event.value)">
            <mat-button-toggle value="authored">
              <mat-icon>edit</mat-icon>
              <span>Authored</span>
            </mat-button-toggle>
            <mat-button-toggle value="mentioned">
              <mat-icon>alternate_email</mat-icon>
              <span>Mentioned</span>
            </mat-button-toggle>
          </mat-button-toggle-group>
        </div>
      }

      <!-- Custom Filter Warning -->
      @if (hasCustomFilter()) {
        <div class="custom-filter-notice">
          <div class="notice-content">
            <mat-icon>tune</mat-icon>
            <div class="notice-text">
              <span class="notice-title">Custom Filter Active</span>
              <span class="notice-description">This feed has custom event kinds configured. Clear to use presets.</span>
            </div>
          </div>
          <button mat-stroked-button class="clear-custom-btn" (click)="clearCustomFilter()">
            <mat-icon>clear</mat-icon>
            Clear Custom
          </button>
        </div>
      }

      <!-- Content Types Grid -->
      <div class="content-types-grid" [class.disabled]="hasCustomFilter()">
        @for (type of availableContentTypes(); track type.id) {
          <button
            class="content-type-chip"
            [class.selected]="isContentTypeSelected(type)"
            [disabled]="hasCustomFilter()"
            (click)="toggleContentType(type)">
            <mat-icon class="chip-icon">{{ type.icon }}</mat-icon>
            <div class="chip-text">
              <span class="chip-label">{{ type.label }}</span>
              <span class="chip-description">{{ type.description }}</span>
            </div>
          </button>
        }
      </div>

      <!-- Show Replies Toggle (as card-style button) -->
      <div class="toggle-option">
        <button
          class="content-type-chip full-width"
          [class.selected]="currentShowReplies()"
          (click)="onShowRepliesChange(!currentShowReplies())">
          <mat-icon class="chip-icon">reply</mat-icon>
          <div class="chip-text">
            <span class="chip-label">Show Replies</span>
            <span class="chip-description">Comments on other posts</span>
          </div>
        </button>
      </div>

      <!-- Actions Row -->
      <div class="actions-row">
        <button mat-stroked-button class="action-btn" (click)="selectAll()" [disabled]="hasCustomFilter()">
          Select All
        </button>
        <button mat-stroked-button class="action-btn" (click)="clearAll()" [disabled]="hasCustomFilter()">
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

    .custom-filter-notice {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 0.75rem;
      background: var(--mat-sys-tertiary-container);
      border-radius: 8px;
      border: 1px solid var(--mat-sys-tertiary);
    }

    .notice-content {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
    }

    .notice-content mat-icon {
      color: var(--mat-sys-on-tertiary-container);
      flex-shrink: 0;
      margin-top: 2px;
    }

    .notice-text {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .notice-title {
      color: var(--mat-sys-on-tertiary-container);
      font-size: 0.875rem;
    }

    .notice-description {
      color: var(--mat-sys-on-tertiary-container);
      font-size: 0.75rem;
      opacity: 0.8;
    }

    .clear-custom-btn {
      align-self: flex-start;
      font-size: 0.8125rem;
    }

    .content-types-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.5rem;
    }

    .content-types-grid.disabled {
      opacity: 0.5;
      pointer-events: none;
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

    .content-type-chip:hover:not(:disabled) {
      background: var(--mat-sys-surface-container-high);
      border-color: var(--mat-sys-outline);
    }

    .content-type-chip:disabled {
      cursor: not-allowed;
    }

    .content-type-chip.selected {
      background: var(--mat-sys-primary-container);
      border-color: var(--mat-sys-primary);
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

    .content-type-chip.full-width {
      width: 100%;
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

    .action-btn:disabled {
      opacity: 0.5;
    }

    .source-mode-section {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .section-label {
      font-size: 0.8125rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .source-mode-section mat-button-toggle-group {
      width: 100%;
    }

    .source-mode-section mat-button-toggle {
      flex: 1;
    }

    .source-mode-section mat-button-toggle mat-icon {
      font-size: 1.125rem;
      width: 1.125rem;
      height: 1.125rem;
      margin-right: 0.375rem;
    }
  `]
})
export class FeedFilterPanelComponent {
  readonly localSettings = inject(LocalSettingsService);
  readonly feedService = inject(FeedService);

  // Input: the feed to configure (if provided, saves to feed; otherwise uses global)
  feed = input<FeedConfig | undefined>(undefined);

  // Input: whether the filter panel is being shown for a list feed
  isListFeed = input(false);

  // Input: current mentioned mode state from parent
  mentionedMode = input(false);

  // Output events for filter changes (kept for backward compatibility)
  kindsChanged = output<number[]>();
  showRepliesChanged = output<boolean>();
  showRepostsChanged = output<boolean>();
  mentionedModeChanged = output<boolean>();

  // Compute the current mentioned mode from input
  currentMentionedMode = computed(() => this.mentionedMode());

  // Compute available content types (all types for now, could be filtered based on feed type)
  availableContentTypes = computed(() => CONTENT_TYPES);

  // Track the current kinds - from feed config if available, otherwise from global settings
  currentKinds = computed(() => {
    const feedConfig = this.feed();
    if (feedConfig) {
      return feedConfig.kinds || [];
    }
    return this.localSettings.contentFilter().kinds;
  });

  // Track the current showReplies setting - from feed config if available
  currentShowReplies = computed(() => {
    const feedConfig = this.feed();
    if (feedConfig) {
      return feedConfig.showReplies ?? false;
    }
    return this.localSettings.contentFilter().showReplies;
  });

  // Track the current showReposts setting - from feed config if available
  currentShowReposts = computed(() => {
    const feedConfig = this.feed();
    if (feedConfig) {
      return feedConfig.showReposts ?? true;
    }
    return this.localSettings.contentFilter().showReposts;
  });

  /**
   * Check if the feed has a custom filter (non-standard kinds selection)
   * A custom filter is detected when:
   * 1. The feed has kinds that are not in our standard quick-toggle content types
   * 2. This includes any feed type that was configured with custom kinds in the feed edit dialog
   * 
   * When a custom filter is active, the quick toggle buttons are disabled to prevent
   * the user from accidentally overwriting their custom configuration.
   */
  hasCustomFilter = computed(() => {
    const feedConfig = this.feed();
    if (!feedConfig) {
      return false;
    }

    const kinds = feedConfig.kinds || [];
    
    // A feed has a custom filter if its kinds are NOT all from the standard quick-toggle content types
    // This means the user configured specific event kinds in the feed edit dialog
    return !isStandardKindsSelection(kinds);
  });

  /**
   * Check if a content type is selected based on current kinds
   */
  isContentTypeSelected(type: ContentType): boolean {
    const kinds = this.currentKinds();
    // A content type is selected if at least one of its kinds is in the filter
    return type.kinds.some(k => kinds.includes(k));
  }

  /**
   * Toggle a content type on/off
   */
  toggleContentType(type: ContentType): void {
    if (this.hasCustomFilter()) {
      return; // Don't allow changes when custom filter is active
    }

    const kinds = [...this.currentKinds()];
    const isSelected = this.isContentTypeSelected(type);

    let newKinds: number[];
    if (isSelected) {
      // Remove all kinds from this type
      newKinds = kinds.filter(k => !type.kinds.includes(k));
      // Ensure we always have at least one kind
      if (newKinds.length === 0) {
        return;
      }
    } else {
      // Add all kinds from this type
      newKinds = [...new Set([...kinds, ...type.kinds])];
    }

    this.updateKinds(newKinds);

    // Special handling for reposts - also update showReposts
    if (type.id === 'reposts') {
      this.updateShowReposts(!isSelected);
    }
  }

  /**
   * Handle show replies toggle
   */
  onShowRepliesChange(checked: boolean): void {
    this.updateShowReplies(checked);
  }

  /**
   * Handle source mode change (authored vs mentioned)
   */
  onSourceModeChange(mode: string): void {
    this.mentionedModeChanged.emit(mode === 'mentioned');
  }

  /**
   * Select all content types
   */
  selectAll(): void {
    if (this.hasCustomFilter()) {
      return;
    }

    const allKinds = CONTENT_TYPES.flatMap(t => t.kinds);
    const uniqueKinds = [...new Set(allKinds)];
    this.updateKinds(uniqueKinds);
    this.updateShowReposts(true);
  }

  /**
   * Clear all content types (keep only posts as minimum)
   */
  clearAll(): void {
    if (this.hasCustomFilter()) {
      return;
    }

    // Keep at least posts (kind 1)
    this.updateKinds([1]);
    this.updateShowReposts(false);
  }

  /**
   * Clear the custom filter and reset to posts and reposts
   */
  clearCustomFilter(): void {
    const feedConfig = this.feed();
    if (!feedConfig) {
      return;
    }

    // Reset to posts and reposts
    this.updateKinds([1, 1111, 6, 16]);
  }

  /**
   * Get default kinds for a feed type
   */
  private getDefaultKindsForFeedType(type: string): number[] {
    switch (type) {
      case 'notes':
        return [1, 1111, 6, 16]; // Text notes and reposts
      case 'articles':
        return [30023]; // Long-form content
      case 'photos':
        return [20]; // Pictures
      case 'videos':
        return [21, 22, 34235, 34236]; // Videos
      case 'music':
        return [32100, 36787, 34139]; // Music
      case 'polls':
        return [1068]; // Polls
      case 'custom':
      default:
        return [...DEFAULT_CONTENT_FILTER.kinds]; // Default: all standard kinds
    }
  }

  /**
   * Reset to default filter configuration
   */
  reset(): void {
    const feedConfig = this.feed();
    if (feedConfig) {
      // Reset feed to its type's default kinds
      const defaultKinds = this.getDefaultKindsForFeedType(feedConfig.type);
      this.updateKinds(defaultKinds);
      this.updateShowReplies(false);
      this.updateShowReposts(true);
    } else {
      // Reset global settings
      this.localSettings.resetContentFilter();
      this.kindsChanged.emit([...DEFAULT_CONTENT_FILTER.kinds]);
      this.showRepostsChanged.emit(DEFAULT_CONTENT_FILTER.showReposts);
      this.showRepliesChanged.emit(DEFAULT_CONTENT_FILTER.showReplies);
    }
  }

  /**
   * Update kinds - saves to feed config if available, otherwise to global settings
   */
  private updateKinds(newKinds: number[]): void {
    const feedConfig = this.feed();
    if (feedConfig) {
      // Update feed configuration
      this.feedService.updateFeed(feedConfig.id, { kinds: newKinds });
    } else {
      // Update global settings
      this.localSettings.setContentFilterKinds(newKinds);
    }
    this.kindsChanged.emit(newKinds);
  }

  /**
   * Update showReplies - saves to feed config if available, otherwise to global settings
   */
  private updateShowReplies(showReplies: boolean): void {
    const feedConfig = this.feed();
    if (feedConfig) {
      // Update feed configuration
      this.feedService.updateFeed(feedConfig.id, { showReplies });
    } else {
      // Update global settings
      this.localSettings.setContentFilterShowReplies(showReplies);
    }
    this.showRepliesChanged.emit(showReplies);
  }

  /**
   * Update showReposts - saves to feed config if available, otherwise to global settings
   */
  private updateShowReposts(showReposts: boolean): void {
    const feedConfig = this.feed();
    if (feedConfig) {
      // Update feed configuration
      this.feedService.updateFeed(feedConfig.id, { showReposts });
    } else {
      // Update global settings
      this.localSettings.setContentFilterShowReposts(showReposts);
    }
    this.showRepostsChanged.emit(showReposts);
  }
}
