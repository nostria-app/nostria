import { Component, inject, output, computed, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { LocalSettingsService, DEFAULT_CONTENT_FILTER, getEffectiveWotMinRank, isWotFilterEnabled } from '../../../services/local-settings.service';
import { FeedConfig, FeedService } from '../../../services/feed.service';
import { FollowSetsService } from '../../../services/follow-sets.service';

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

interface ToggleFilterOption {
  id: 'showReplies' | 'hideWordle' | 'hideSeen';
  label: string;
  description: string;
  icon: string;
}

/**
 * All available content types with their Nostr kinds
 * Note: Articles are excluded as there's a dedicated Articles feature in the app
 */
const CONTENT_TYPES: ContentType[] = [
  { id: 'posts', label: 'Posts', description: 'Short text posts', kinds: [1, 1111], icon: 'description' },
  { id: 'articles', label: 'Articles', description: 'Long-form writing', kinds: [30023], icon: 'article' },
  { id: 'polls', label: 'Polls', description: 'Polls and zap polls', kinds: [1068, 6969], icon: 'poll' },
  { id: 'reposts', label: 'Reposts', description: 'Shared content from others', kinds: [6, 16], icon: 'repeat' },
  { id: 'voicePosts', label: 'Audio Posts', description: 'Audio posts and music', kinds: [1222, 1244], icon: 'audiotrack' },
  { id: 'photoPosts', label: 'Photo Posts', description: 'Image galleries', kinds: [20], icon: 'image' },
  { id: 'videoPosts', label: 'Video Posts', description: 'Video posts and clips', kinds: [21, 22, 34235, 34236], icon: 'movie' },
];

const TOGGLE_FILTER_OPTIONS: ToggleFilterOption[] = [
  { id: 'showReplies', label: 'Show Replies', description: 'Comments on other posts', icon: 'reply' },
  { id: 'hideWordle', label: 'Hide Wordle', description: 'Filter out posts tagged wordle', icon: 'grid_view' },
  { id: 'hideSeen', label: 'Hide Seen', description: 'Hide posts you\u2019ve already viewed', icon: 'visibility_off' },
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
    MatSliderModule,
  ],
  template: `
    <div class="filter-panel" (click)="$event.stopPropagation()">
      <div class="filter-column content-filter-column">
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

        <div class="combined-filter-header">
          <span class="combined-filter-title">Content types</span>
          @if (hasCustomFilter()) {
          <span class="combined-filter-status">Custom</span>
          }
        </div>

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

        <div class="toggle-options-grid">
          @for (option of toggleFilterOptions; track option.id) {
          <div class="toggle-option">
            <button
              class="content-type-chip full-width"
              [class.selected]="isToggleOptionSelected(option)"
              (click)="toggleOption(option)">
              <mat-icon class="chip-icon">{{ option.icon }}</mat-icon>
              <div class="chip-text">
                <span class="chip-label">{{ option.label }}</span>
                <span class="chip-description">{{ option.description }}</span>
              </div>
            </button>
          </div>
          }
        </div>

        @if (trustProviderEnabled()) {
        <div class="toggle-option">
          <button
            class="content-type-chip full-width"
            [class.selected]="currentWotEnabled()"
            (click)="onWotFilterChange(!currentWotEnabled())">
            <mat-icon class="chip-icon">shield</mat-icon>
            <div class="chip-text">
              <span class="chip-label">Web of Trust</span>
              <span class="chip-description">Only show events from trusted users</span>
            </div>
          </button>

          @if (currentWotEnabled()) {
          <div class="wot-slider-panel">
            <div class="wot-slider-header">
              <span class="section-label">Min WoT rank</span>
              <span class="wot-slider-value">{{ currentWotMinRankLabel() }}</span>
            </div>
            <mat-slider min="0" max="100" step="1" discrete>
              <input
                matSliderThumb
                [value]="currentWotMinRank()"
                title="Minimum Web of Trust rank"
                aria-label="Minimum Web of Trust rank"
                (valueChange)="onWotMinRankChange($any($event))" />
            </mat-slider>
            <p class="wot-slider-hint">0 includes authors with a positive trust rank.</p>
          </div>
          }
        </div>
        }

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

      <div class="combined-filter-divider"></div>

      <div class="filter-column list-filter-column">
        <div class="combined-filter-header">
          <span class="combined-filter-title">List filter</span>
          @if (currentListFilter() !== 'following') {
          <span class="combined-filter-status">Active</span>
          }
        </div>

        <button class="filter-option-chip" [class.selected]="currentListFilter() === 'following'"
          (click)="selectListFilter('following')">
          <mat-icon class="chip-icon">people</mat-icon>
          <div class="chip-text">
            <span class="chip-label">Following</span>
            <span class="chip-description">People you follow</span>
          </div>
        </button>

        @if (favoritesSet(); as favorites) {
        <button class="filter-option-chip" [class.selected]="currentListFilter() === 'nostria-favorites'"
          (click)="selectListFilter('nostria-favorites')">
          <mat-icon class="chip-icon">star</mat-icon>
          <div class="chip-text">
            <span class="chip-label">Favorites</span>
            <span class="chip-description">{{ favorites.pubkeys.length }} people</span>
          </div>
        </button>
        }

        @if (otherFollowSets().length > 0) {
        <mat-divider></mat-divider>
        @for (set of otherFollowSets(); track set.id) {
        <button class="filter-option-chip" [class.selected]="currentListFilter() === set.dTag"
          (click)="selectListFilter(set.dTag)">
          <mat-icon class="chip-icon">{{ set.isPrivate ? 'lock' : 'group' }}</mat-icon>
          <div class="chip-text">
            <span class="chip-label">{{ set.title }}</span>
            <span class="chip-description">{{ set.pubkeys.length }} people</span>
          </div>
        </button>
        }
        }

        <div class="actions-row single-action-row">
          <button mat-stroked-button class="action-btn" (click)="resetListFilter()">
            Reset
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .filter-panel {
      display: flex;
      flex-direction: row;
      gap: 1rem;
      padding: 1rem;
      width: min(720px, calc(100vw - 2rem));
      max-width: calc(100vw - 2rem);
      max-height: 75vh;
      overflow: hidden;
      background: var(--mat-sys-surface-container);
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      box-sizing: border-box;
      align-items: stretch;
    }

    .filter-column {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      flex: 1;
      min-width: 0;
      min-height: 0;
      overflow-y: auto;
      padding-right: 0.25rem;
    }

    .combined-filter-divider {
      width: 1px;
      background: var(--mat-sys-outline-variant);
      flex-shrink: 0;
    }

    .combined-filter-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }

    .combined-filter-title {
      color: var(--mat-sys-on-surface);
      font-size: 0.95rem;
    }

    .combined-filter-status {
      color: var(--mat-sys-on-primary-container);
      background: var(--mat-sys-primary-container);
      border-radius: 999px;
      padding: 0.2rem 0.55rem;
      font-size: 0.75rem;
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

    @media (max-width: 480px) {
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
      width: 100%;
      box-sizing: border-box;
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

    .filter-option-chip {
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
      width: 100%;
      box-sizing: border-box;
    }

    .filter-option-chip:hover {
      background: var(--mat-sys-surface-container-high);
      border-color: var(--mat-sys-outline);
    }

    .filter-option-chip.selected {
      background: var(--mat-sys-primary-container);
      border-color: var(--mat-sys-primary);
    }

    .filter-option-chip.selected .chip-icon,
    .filter-option-chip.selected .chip-label {
      color: var(--mat-sys-on-primary-container);
    }

    .filter-option-chip.selected .chip-description {
      color: var(--mat-sys-on-primary-container);
      opacity: 0.8;
    }

    .toggle-option {
      padding: 0.25rem 0;
    }

    .toggle-options-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.5rem;
    }

    @media (max-width: 480px) {
      .toggle-options-grid {
        grid-template-columns: 1fr;
      }
    }

    .wot-slider-panel {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      margin-top: 0.625rem;
      padding: 0.875rem 0.875rem 0.5rem;
      border-radius: 8px;
      background: var(--mat-sys-surface);
      border: 1px solid var(--mat-sys-outline-variant);
    }

    .wot-slider-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .wot-slider-value {
      font-size: 0.8125rem;
      color: var(--mat-sys-on-surface);
    }

    .wot-slider-hint {
      margin: 0;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .actions-row {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .single-action-row {
      margin-top: auto;
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

    @media (max-width: 640px) {
      .filter-panel {
        flex-direction: column;
      }

      .combined-filter-divider {
        width: 100%;
        height: 1px;
      }
    }
  `]
})
export class FeedFilterPanelComponent {
  readonly localSettings = inject(LocalSettingsService);
  readonly feedService = inject(FeedService);
  private readonly followSetsService = inject(FollowSetsService);

  // Input: the feed to configure (if provided, saves to feed; otherwise uses global)
  feed = input<FeedConfig | undefined>(undefined);

  // Input: whether the filter panel is being shown for a list feed
  isListFeed = input(false);

  // Input: currently selected people/list filter
  currentListFilter = input<string>('following');

  // Input: current mentioned mode state from parent
  mentionedMode = input(false);

  // Output events for filter changes (kept for backward compatibility)
  kindsChanged = output<number[]>();
  showRepliesChanged = output<boolean>();
  showRepostsChanged = output<boolean>();
  mentionedModeChanged = output<boolean>();
  wotFilterChanged = output<boolean>();
  listFilterChanged = output<string>();

  // Compute the current mentioned mode from input
  currentMentionedMode = computed(() => this.mentionedMode());

  // Compute available content types (all types for now, could be filtered based on feed type)
  availableContentTypes = computed(() => CONTENT_TYPES);

  readonly toggleFilterOptions = TOGGLE_FILTER_OPTIONS;

  favoritesSet = computed(() =>
    this.followSetsService.followSets().find(set => set.dTag === 'nostria-favorites') ?? null
  );

  otherFollowSets = computed(() =>
    this.followSetsService.followSets()
      .filter(set => set.dTag !== 'nostria-favorites')
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title))
  );

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

  currentHideWordle = computed(() => {
    const feedConfig = this.feed();
    if (feedConfig) {
      return feedConfig.hideWordle ?? true;
    }
    return this.localSettings.contentFilter().hideWordle;
  });

  currentHideSeen = computed(() => {
    const feedConfig = this.feed();
    if (feedConfig) {
      return feedConfig.hideSeen ?? false;
    }
    return this.localSettings.contentFilter().hideSeen ?? false;
  });

  // Track whether WoT filtering is enabled - from feed config if available
  currentWotEnabled = computed(() => {
    const feedConfig = this.feed();
    if (feedConfig) {
      return isWotFilterEnabled(feedConfig);
    }
    return isWotFilterEnabled(this.localSettings.contentFilter());
  });

  currentWotMinRank = computed(() => {
    const feedConfig = this.feed();
    if (feedConfig) {
      return Math.max(getEffectiveWotMinRank(feedConfig), 0);
    }

    return Math.max(getEffectiveWotMinRank(this.localSettings.contentFilter()), 0);
  });

  // Whether trust provider is enabled (show WoT filter only when trust service is available)
  trustProviderEnabled = computed(() => this.localSettings.trustEnabled());

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

  isToggleOptionSelected(option: ToggleFilterOption): boolean {
    switch (option.id) {
      case 'showReplies':
        return this.currentShowReplies();
      case 'hideWordle':
        return this.currentHideWordle();
      case 'hideSeen':
        return this.currentHideSeen();
    }
  }

  toggleOption(option: ToggleFilterOption): void {
    switch (option.id) {
      case 'showReplies':
        this.onShowRepliesChange(!this.currentShowReplies());
        return;
      case 'hideWordle':
        this.onHideWordleChange(!this.currentHideWordle());
        return;
      case 'hideSeen':
        this.onHideSeenChange(!this.currentHideSeen());
        return;
    }
  }

  /**
   * Handle show replies toggle
   */
  onShowRepliesChange(checked: boolean): void {
    this.updateShowReplies(checked);
  }

  onHideWordleChange(checked: boolean): void {
    this.updateHideWordle(checked);
  }

  onHideSeenChange(checked: boolean): void {
    this.updateHideSeen(checked);
  }

  /**
   * Handle WoT filter toggle
   */
  onWotFilterChange(enabled: boolean): void {
    this.updateWotMinRank(enabled ? this.currentWotMinRank() : undefined);
  }

  onWotMinRankChange(value: number): void {
    const nextValue = Number(value);
    this.updateWotMinRank(Number.isFinite(nextValue) ? Math.max(0, nextValue) : 0);
  }

  currentWotMinRankLabel(): string {
    return String(this.currentWotMinRank());
  }

  /**
   * Handle source mode change (authored vs mentioned)
   */
  onSourceModeChange(mode: string): void {
    this.mentionedModeChanged.emit(mode === 'mentioned');
  }

  selectListFilter(filter: string): void {
    this.listFilterChanged.emit(filter);
  }

  resetListFilter(): void {
    this.listFilterChanged.emit('following');
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
    this.updateHideWordle(false);
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
    this.updateHideWordle(true);
  }

  /**
   * Clear the custom filter and reset to posts and reposts
   */
  clearCustomFilter(): void {
    const feedConfig = this.feed();
    if (!feedConfig) {
      return;
    }

    this.updateKinds(this.getDefaultKindsForFeedType(feedConfig.type));
    this.updateShowReplies(false);
    this.updateShowReposts(true);
    this.updateHideWordle(true);
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
        return [1068, 6969]; // Polls + Zap Polls
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
      this.updateHideWordle(true);
      this.updateWotMinRank(undefined);
    } else {
      // Reset global settings
      this.localSettings.resetContentFilter();
      this.kindsChanged.emit([...DEFAULT_CONTENT_FILTER.kinds]);
      this.showRepostsChanged.emit(DEFAULT_CONTENT_FILTER.showReposts);
      this.showRepliesChanged.emit(DEFAULT_CONTENT_FILTER.showReplies);
      this.wotFilterChanged.emit(false);
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

  private updateHideWordle(hideWordle: boolean): void {
    const feedConfig = this.feed();
    if (feedConfig) {
      this.feedService.updateFeed(feedConfig.id, { hideWordle });
    } else {
      this.localSettings.setContentFilterHideWordle(hideWordle);
    }
  }

  private updateHideSeen(hideSeen: boolean): void {
    const feedConfig = this.feed();
    if (feedConfig) {
      this.feedService.updateFeed(feedConfig.id, { hideSeen });
    } else {
      this.localSettings.setContentFilterHideSeen(hideSeen);
    }
  }

  /**
   * Update wotFilter - saves to feed config if available, otherwise to global settings
   */
  private updateWotMinRank(wotMinRank: number | undefined): void {
    const feedConfig = this.feed();
    const wotFilter = wotMinRank !== undefined;

    if (feedConfig && feedConfig.source !== 'trending') {
      void this.feedService.updateFeed(feedConfig.id, { wotFilter, wotMinRank }).then(updated => {
        if (!updated) {
          this.localSettings.setContentFilterWotMinRank(wotMinRank);
        }
      }).catch(() => {
        this.localSettings.setContentFilterWotMinRank(wotMinRank);
      });
    } else {
      this.localSettings.setContentFilterWotMinRank(wotMinRank);
    }
    this.wotFilterChanged.emit(wotFilter);
  }
}
