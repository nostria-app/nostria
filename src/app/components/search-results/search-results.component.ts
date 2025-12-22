import { Component, inject, signal, effect } from '@angular/core';
import { Router } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SearchService, SearchResultProfile } from '../../services/search.service';
import { UtilitiesService } from '../../services/utilities.service';
import { LayoutService } from '../../services/layout.service';

@Component({
  selector: 'app-search-results',
  standalone: true,
  imports: [MatListModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    @if (searchService.searchResults().length > 0 || searchService.searchActions().length > 0 || searchService.isSearchingRemote() || hasSearchInput()) {
      <div
        class="search-results"
        tabindex="0"
        (keydown)="onKeyDown($event)"
        (focus)="onContainerFocus()"
        #searchResultsContainer
      >
        @if (searchService.searchActions().length > 0) {
          <div class="search-results-header">
            <span>Actions</span>
            <div class="header-actions">
              <button mat-icon-button (click)="openAdvancedSearch()" matTooltip="Advanced Search">
                <mat-icon>manage_search</mat-icon>
              </button>
              <button mat-icon-button (click)="searchService.clearResults()">
                <mat-icon>close</mat-icon>
              </button>
            </div>
          </div>
          <div class="search-results-list">
            @for (action of searchService.searchActions(); track action.label) {
              <div class="search-result-item" (click)="action.callback()" (keydown.enter)="action.callback()" tabindex="0">
                <mat-icon class="search-result-avatar-icon">{{ action.icon }}</mat-icon>
                <div class="search-result-info">
                  <div class="search-result-name">{{ action.label }}</div>
                  <div class="search-result-about">{{ action.description }}</div>
                </div>
              </div>
            }
          </div>
        }

        @if (searchService.searchResults().length > 0) {
          <div class="search-results-header">
            <span>Found Profiles ({{ searchService.searchResults().length }})</span>
            <div class="header-actions">
              @if (searchService.isSearchingRemote()) {
                <mat-spinner diameter="16"></mat-spinner>
              }
              <button mat-icon-button (click)="openAdvancedSearch()" matTooltip="Advanced Search">
                <mat-icon>manage_search</mat-icon>
              </button>
              @if (searchService.searchActions().length === 0) {
                <button mat-icon-button (click)="searchService.clearResults()">
                  <mat-icon>close</mat-icon>
                </button>
              }
            </div>
          </div>
          <div class="search-results-list">
            @for (
              profile of searchService.searchResults();
              track profile.event.pubkey;
              let i = $index
            ) {
              <div
                class="search-result-item"
                [class.focused]="focusedIndex() === i"
                [class.remote-result]="profile.source === 'remote'"
                (click)="selectItem(profile, i)"
                (keydown.enter)="selectItem(profile, i)"
                (mouseenter)="setFocusedIndex(i)"
                tabindex="0"
              >
                @if (profile.data.picture) {
                  <img
                    [src]="profile.data.picture"
                    alt="Profile picture"
                    class="search-result-avatar"
                    [class.remote-avatar]="profile.source === 'remote'"
                  />
                } @else {
                  <mat-icon class="search-result-avatar-icon">account_circle</mat-icon>
                }
                <div class="search-result-info">
                  <div class="search-result-name">
                    {{
                      profile.data.display_name ||
                        profile.data.name ||
                        utilities.getNpubFromPubkey(profile.event.pubkey)
                    }}
                    @if (profile.source === 'remote') {
                      <span class="source-badge remote-badge">Remote</span>
                    } @else {
                      <span class="source-badge local-badge">Following</span>
                    }
                  </div>
                  @if (profile.data.nip05) {
                    <div class="search-result-nip05">
                      {{ utilities.parseNip05(profile.data.nip05) }}
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        } @else if (searchService.isSearchingRemote()) {
          <div class="search-results-header">
            <span>Searching...</span>
            <mat-spinner diameter="16"></mat-spinner>
          </div>
        } @else if (hasSearchInput()) {
          <div class="search-results-header">
            <span>Found Profiles (0)</span>
            <div class="header-actions">
              <button mat-icon-button (click)="openAdvancedSearch()" matTooltip="Advanced Search">
                <mat-icon>manage_search</mat-icon>
              </button>
              <button mat-icon-button (click)="searchService.clearResults()">
                <mat-icon>close</mat-icon>
              </button>
            </div>
          </div>
          <div class="no-results-message">
            No profiles found. Try Advanced Search for more options.
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      .search-results {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: var(--mat-sys-surface-container);
        border: 1px solid var(--mat-sys-outline-variant);
        border-radius: 8px;
        box-shadow: var(--mat-sys-level3);
        max-height: 400px;
        overflow-y: auto;
        overflow-x: hidden;
        z-index: 1000;
        outline: none;
      }

      .search-results:focus-within {
        border-color: var(--mat-sys-primary);
        box-shadow: 0 0 0 2px rgba(var(--mat-sys-primary-rgb), 0.1);
      }

      /* Mobile responsive styles - full width on mobile */
      @media (max-width: 599px) {
        .search-results {
          position: fixed;
          top: 64px; /* Height of mat-toolbar */
          left: 16px;
          right: 16px;
          width: auto;
          max-height: 400px; /* Account for toolbar (64px) and mobile menu (80px) */
          border-radius: 12px;
          margin: 0;
          z-index: 1000;
          margin-bottom: 120px; /* Additional margin to ensure clearance from mobile menu */
        }
      }

      .search-results-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 16px;
        border-bottom: 1px solid var(--mat-sys-outline-variant);
        background: var(--mat-sys-surface-container-high);
        font-weight: 500;
        font-size: 14px;
      }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: auto;
      }

      .header-actions mat-spinner {
        margin-right: 8px;
      }

      .search-results-list {
        padding: 0;
      }

      .search-result-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0.4rem 1rem;
        width: 100%;
        min-width: 0;
        border-bottom: 1px solid var(--mat-sys-outline-variant);
        cursor: pointer;
        transition: background-color 0.2s ease;
      }

      .search-result-item:last-child {
        border-bottom: none;
      }

      .search-result-item:hover,
      .search-result-item.focused {
        background: var(--mat-sys-surface-container-high);
      }

      .search-result-item.focused {
        background: var(--mat-sys-secondary-container);
        outline: 2px solid var(--mat-sys-primary);
        outline-offset: -2px;
      }
      .search-result-avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
      }

      .search-result-avatar-icon {
        width: 40px;
        height: 40px;
        font-size: 40px;
        color: var(--mat-sys-on-surface-variant);
        flex-shrink: 0;
      }
      .search-result-info {
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }

      .search-result-name {
        font-weight: 500;
        font-size: 14px;
        color: var(--mat-sys-on-surface);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        width: 100%;
      }

      .search-result-nip05 {
        font-size: 12px;
        color: var(--mat-sys-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        width: 100%;
      }

      .search-result-about {
        font-size: 12px;
        color: var(--mat-sys-on-surface-variant);
        line-height: 1.3;
        margin-top: 2px;
      }

      .source-badge {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 10px;
        margin-left: 8px;
        vertical-align: middle;
      }

      .local-badge {
        background: var(--mat-sys-primary-container);
        color: var(--mat-sys-on-primary-container);
      }

      .remote-badge {
        background: var(--mat-sys-secondary-container);
        color: var(--mat-sys-on-secondary-container);
      }

      .remote-result {
        background: var(--mat-sys-surface-container-lowest);
      }

      .remote-avatar {
        opacity: 0.9;
        border: 2px solid var(--mat-sys-secondary);
      }

      .no-results-message {
        padding: 16px;
        text-align: center;
        color: var(--mat-sys-on-surface-variant);
        font-size: 14px;
      }
    `,
  ],
})
export class SearchResultsComponent {
  searchService = inject(SearchService);
  utilities = inject(UtilitiesService);
  layout = inject(LayoutService);
  private router = inject(Router);

  focusedIndex = signal(-1);

  // Check if there's active search input
  hasSearchInput = () => this.layout.searchInput && this.layout.searchInput.trim().length > 0;

  constructor() {
    // Reset focused index when search results change
    effect(() => {
      const results = this.searchService.searchResults();
      const actions = this.searchService.searchActions();
      if (results.length === 0 && actions.length === 0) {
        this.focusedIndex.set(-1);
      }
    });
  }

  openAdvancedSearch() {
    const searchValue = this.layout.searchInput;
    this.searchService.clearResults();
    this.layout.toggleSearch();
    this.router.navigate(['/search'], {
      queryParams: searchValue ? { q: searchValue } : {},
    });
  }

  onKeyDown(event: KeyboardEvent) {
    const results = this.searchService.searchResults();
    if (results.length === 0) return;

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const nextIndex = Math.min(this.focusedIndex() + 1, results.length - 1);
        this.setFocusedIndex(nextIndex);
        this.scrollToFocusedItem();
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const prevIndex = Math.max(this.focusedIndex() - 1, 0);
        this.setFocusedIndex(prevIndex);
        this.scrollToFocusedItem();
        break;
      }
      case 'Enter':
        event.preventDefault();
        if (this.focusedIndex() >= 0 && this.focusedIndex() < results.length) {
          this.selectItem(results[this.focusedIndex()], this.focusedIndex());
        }
        break;
      case 'Escape':
        event.preventDefault();
        this.searchService.clearResults();
        break;
      case 'Tab':
        if (event.shiftKey) {
          // Shift+Tab should go back to search input
          event.preventDefault();
          const searchInput = document.querySelector('.search-input') as HTMLInputElement;
          if (searchInput) {
            searchInput.focus();
          }
        }
        // Regular Tab will naturally move to next focusable element
        break;
    }
  }

  onContainerFocus() {
    // Set focus to first item if none is focused
    if (this.focusedIndex() === -1 && this.searchService.searchResults().length > 0) {
      this.setFocusedIndex(0);
      this.scrollToFocusedItem();
    }
  }

  setFocusedIndex(index: number) {
    this.focusedIndex.set(index);
  }

  selectItem(profile: SearchResultProfile, index: number) {
    this.setFocusedIndex(index);
    this.searchService.selectSearchResult(profile);
  }

  /**
   * Scroll the focused item into view within the search results container
   */
  private scrollToFocusedItem(): void {
    const focusedIndex = this.focusedIndex();
    if (focusedIndex < 0) return;

    // Use setTimeout to ensure the DOM has updated
    setTimeout(() => {
      const searchResultsContainer = document.querySelector('.search-results') as HTMLElement;
      const focusedItem = document.querySelector('.search-result-item.focused') as HTMLElement;

      if (searchResultsContainer && focusedItem) {
        // Calculate positions relative to the container
        const containerTop = searchResultsContainer.scrollTop;
        const containerBottom = containerTop + searchResultsContainer.clientHeight;

        // Get the item's position relative to the scrollable container
        const itemTop = focusedItem.offsetTop;
        const itemBottom = itemTop + focusedItem.offsetHeight;

        // Check if item is above the visible area
        if (itemTop < containerTop) {
          searchResultsContainer.scrollTo({
            top: itemTop,
            behavior: 'smooth',
          });
        }
        // Check if item is below the visible area
        else if (itemBottom > containerBottom) {
          searchResultsContainer.scrollTo({
            top: itemBottom - searchResultsContainer.clientHeight,
            behavior: 'smooth',
          });
        }
      }
    }, 0);
  }
}
