import { Component, inject, signal, effect } from '@angular/core';
import { Router } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SearchService, SearchResultProfile, SearchTab, SearchResultEvent } from '../../services/search.service';
import { UtilitiesService } from '../../services/utilities.service';
import { LayoutService } from '../../services/layout.service';
import { Event, nip19, kinds } from 'nostr-tools';

@Component({
  selector: 'app-search-results',
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
        <!-- Minimalist Tab Control -->
        @if (hasSearchInput() && !hasActionsOnly()) {
          <div class="search-tabs">
            <button 
              class="search-tab" 
              [class.active]="searchService.activeTab() === 'all'"
              (click)="setActiveTab('all')"
            >All</button>
            <button 
              class="search-tab" 
              [class.active]="searchService.activeTab() === 'profiles'"
              (click)="setActiveTab('profiles')"
            >
              Profiles
              @if (searchService.searchResults().length > 0) {
                <span class="tab-count">{{ searchService.searchResults().length }}</span>
              }
            </button>
            <button 
              class="search-tab" 
              [class.active]="searchService.activeTab() === 'notes'"
              (click)="setActiveTab('notes')"
            >
              Notes
              @if (searchService.noteResults().length > 0) {
                <span class="tab-count">{{ searchService.noteResults().length }}</span>
              }
              @if (searchService.isSearchingNotes()) {
                <mat-spinner diameter="12" class="tab-spinner"></mat-spinner>
              }
            </button>
            <button 
              class="search-tab" 
              [class.active]="searchService.activeTab() === 'articles'"
              (click)="setActiveTab('articles')"
            >
              Articles
              @if (searchService.articleResults().length > 0) {
                <span class="tab-count">{{ searchService.articleResults().length }}</span>
              }
              @if (searchService.isSearchingArticles()) {
                <mat-spinner diameter="12" class="tab-spinner"></mat-spinner>
              }
            </button>
          </div>
        }

        @if (searchService.searchActions().length > 0) {
          <div class="search-results-header">
            <span>Actions</span>
            <div class="header-actions">
              <button mat-icon-button (click)="openAdvancedSearch()" matTooltip="Advanced Search">
                <mat-icon>manage_search</mat-icon>
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

        <!-- Profiles Section (show in 'all' or 'profiles' tab) -->
        @if ((searchService.activeTab() === 'all' || searchService.activeTab() === 'profiles') && searchService.searchResults().length > 0) {
          <div class="search-results-header">
            <span>Profiles ({{ searchService.searchResults().length }})</span>
            <div class="header-actions">
              @if (searchService.isSearchingRemote()) {
                <mat-spinner diameter="16"></mat-spinner>
              }
              <button mat-icon-button (click)="openAdvancedSearch()" matTooltip="Advanced Search">
                <mat-icon>manage_search</mat-icon>
              </button>
            </div>
          </div>
          <div class="search-results-list">
            @for (
              profile of getVisibleProfiles();
              track $index;
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
                    } @else if (profile.source === 'following') {
                      <span class="source-badge following-badge">Following</span>
                    } @else if (profile.source === 'cached') {
                      <span class="source-badge cached-badge">Cached</span>
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
        }

        <!-- Notes Section (show in 'all' or 'notes' tab) -->
        @if ((searchService.activeTab() === 'all' || searchService.activeTab() === 'notes') && searchService.noteResults().length > 0) {
          <div class="search-results-header">
            <span>Notes ({{ searchService.noteResults().length }})</span>
            <div class="header-actions">
              @if (searchService.isSearchingNotes()) {
                <mat-spinner diameter="16"></mat-spinner>
              }
            </div>
          </div>
          <div class="search-results-list">
            @for (note of getVisibleNotes(); track note.event.id; let i = $index) {
              <div
                class="search-result-item note-result"
                (click)="openNote(note)"
                (keydown.enter)="openNote(note)"
                tabindex="0"
              >
                <mat-icon class="search-result-avatar-icon">article</mat-icon>
                <div class="search-result-info">
                  <div class="search-result-content">{{ truncateContent(note.event.content, 100) }}</div>
                  <div class="search-result-meta">
                    {{ getNpubShort(note.event.pubkey) }} · {{ formatTime(note.event.created_at) }}
                  </div>
                </div>
              </div>
            }
          </div>
        }

        <!-- Articles Section (show in 'all' or 'articles' tab) -->
        @if ((searchService.activeTab() === 'all' || searchService.activeTab() === 'articles') && searchService.articleResults().length > 0) {
          <div class="search-results-header">
            <span>Articles ({{ searchService.articleResults().length }})</span>
            <div class="header-actions">
              @if (searchService.isSearchingArticles()) {
                <mat-spinner diameter="16"></mat-spinner>
              }
            </div>
          </div>
          <div class="search-results-list">
            @for (article of getVisibleArticles(); track article.event.id; let i = $index) {
              <div
                class="search-result-item article-result"
                (click)="openArticle(article)"
                (keydown.enter)="openArticle(article)"
                tabindex="0"
              >
                <mat-icon class="search-result-avatar-icon">description</mat-icon>
                <div class="search-result-info">
                  <div class="search-result-name">{{ getArticleTitle(article.event) }}</div>
                  <div class="search-result-meta">
                    {{ getNpubShort(article.event.pubkey) }} · {{ formatTime(article.event.created_at) }}
                  </div>
                </div>
              </div>
            }
          </div>
        }

        <!-- Loading state when searching -->
        @if (searchService.isSearchingRemote() && searchService.searchResults().length === 0 && searchService.searchActions().length === 0) {
          <div class="search-results-header">
            <span>Searching...</span>
            <mat-spinner diameter="16"></mat-spinner>
          </div>
        }

        <!-- No results message -->
        @if (hasSearchInput() && !hasAnyResults() && !isSearching()) {
          <div class="search-results-header">
            <span>No results found</span>
            <div class="header-actions">
              <button mat-icon-button (click)="openAdvancedSearch()" matTooltip="Advanced Search">
                <mat-icon>manage_search</mat-icon>
              </button>
            </div>
          </div>
          <div class="no-results-message">
            No results found. Try Advanced Search for more options.
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
        border-top: none;
        border-radius: 0 0 8px 8px;
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

      /* Minimalist Tab Control - Outlook-inspired */
      .search-tabs {
        display: flex;
        gap: 0;
        padding: 0 12px;
        border-bottom: 1px solid var(--mat-sys-outline-variant);
        background: var(--mat-sys-surface-container);
      }

      .search-tab {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 16px;
        border: none;
        background: transparent;
        color: var(--mat-sys-on-surface-variant);
        font-size: 13px;
        cursor: pointer;
        position: relative;
        transition: color 0.15s ease;
      }

      .search-tab:hover {
        color: var(--mat-sys-on-surface);
      }

      .search-tab.active {
        color: var(--mat-sys-primary);
      }

      .search-tab.active::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 8px;
        right: 8px;
        height: 2px;
        background: var(--mat-sys-primary);
        border-radius: 2px 2px 0 0;
      }

      .tab-count {
        font-size: 11px;
        color: var(--mat-sys-on-surface-variant);
        background: var(--mat-sys-surface-container-high);
        padding: 1px 6px;
        border-radius: 10px;
      }

      .search-tab.active .tab-count {
        background: var(--mat-sys-primary-container);
        color: var(--mat-sys-on-primary-container);
      }

      .tab-spinner {
        margin-left: 4px;
      }

      .search-results-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 16px;
        border-bottom: 1px solid color-mix(in srgb, var(--mat-sys-outline-variant) 50%, transparent);
        background: transparent;
        font-size: 12px;
        color: var(--mat-sys-on-surface-variant);
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
        padding: 0.6rem 1rem;
        width: 100%;
        min-width: 0;
        border-bottom: 1px solid color-mix(in srgb, var(--mat-sys-outline-variant) 50%, transparent);
        cursor: pointer;
        transition: background-color 0.2s ease;
      }

      .search-result-item:last-child {
        border-bottom: 1px solid color-mix(in srgb, var(--mat-sys-outline-variant) 50%, transparent);
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

      .note-result .search-result-avatar-icon,
      .article-result .search-result-avatar-icon {
        width: 32px;
        height: 32px;
        font-size: 32px;
      }

      .search-result-info {
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }

      .search-result-name {
        font-size: 14px;
        color: var(--mat-sys-on-surface);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        width: 100%;
      }

      .search-result-content {
        font-size: 13px;
        color: var(--mat-sys-on-surface);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        width: 100%;
        line-height: 1.4;
      }

      .search-result-meta {
        font-size: 11px;
        color: var(--mat-sys-on-surface-variant);
        margin-top: 2px;
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

      .following-badge {
        background: var(--mat-sys-primary-container);
        color: var(--mat-sys-on-primary-container);
      }

      .cached-badge {
        background: var(--mat-sys-tertiary-container);
        color: var(--mat-sys-on-tertiary-container);
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

  // Check if we only have actions (URLs) and no search results
  hasActionsOnly = () =>
    this.searchService.searchActions().length > 0 &&
    this.searchService.searchResults().length === 0 &&
    !this.searchService.isSearchingRemote();

  // Check if any search is in progress
  isSearching = () =>
    this.searchService.isSearchingRemote() ||
    this.searchService.isSearchingNotes() ||
    this.searchService.isSearchingArticles();

  // Check if we have any results
  hasAnyResults = () =>
    this.searchService.searchResults().length > 0 ||
    this.searchService.noteResults().length > 0 ||
    this.searchService.articleResults().length > 0 ||
    this.searchService.searchActions().length > 0;

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

  setActiveTab(tab: SearchTab): void {
    this.searchService.setActiveTab(tab);
  }

  // Get visible profiles based on active tab (limit for 'all' tab)
  getVisibleProfiles(): SearchResultProfile[] {
    const profiles = this.searchService.searchResults();
    if (this.searchService.activeTab() === 'all') {
      return profiles.slice(0, 5); // Show max 5 in 'all' view
    }
    return profiles;
  }

  // Get visible notes based on active tab
  getVisibleNotes(): SearchResultEvent[] {
    const notes = this.searchService.noteResults();
    if (this.searchService.activeTab() === 'all') {
      return notes.slice(0, 3); // Show max 3 in 'all' view
    }
    return notes;
  }

  // Get visible articles based on active tab
  getVisibleArticles(): SearchResultEvent[] {
    const articles = this.searchService.articleResults();
    if (this.searchService.activeTab() === 'all') {
      return articles.slice(0, 3); // Show max 3 in 'all' view
    }
    return articles;
  }

  // Truncate content for display
  truncateContent(content: string, maxLength: number): string {
    if (!content) return '';
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  }

  // Format timestamp to relative time
  formatTime(timestamp: number): string {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - timestamp;

    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;

    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString();
  }

  // Get shortened npub for display
  getNpubShort(pubkey: string): string {
    try {
      const npub = this.utilities.getNpubFromPubkey(pubkey);
      return npub.slice(0, 12) + '...';
    } catch {
      return pubkey.slice(0, 8) + '...';
    }
  }

  // Get article title from tags or content
  getArticleTitle(event: Event): string {
    const titleTag = event.tags.find(t => t[0] === 'title');
    if (titleTag && titleTag[1]) {
      return titleTag[1];
    }
    // Fallback to first line of content
    const firstLine = event.content.split('\n')[0];
    return this.truncateContent(firstLine, 60) || 'Untitled Article';
  }

  // Open a note - navigate to primary outlet and clear right pane
  openNote(note: SearchResultEvent): void {
    const nevent = nip19.neventEncode({
      id: note.event.id,
      author: note.event.pubkey,
      kind: note.event.kind,
    });
    this.router.navigate([{ outlets: { primary: ['e', nevent], right: null } }], {
      state: { event: note.event }
    });
    this.searchService.clearResults();
    this.layout.toggleSearch();
  }

  // Open an article - navigate to primary outlet and clear right pane
  openArticle(article: SearchResultEvent): void {
    // Articles use naddr encoding for long-form content
    const dTag = article.event.tags.find((t: string[]) => t[0] === 'd')?.[1] || '';
    const naddr = nip19.naddrEncode({
      kind: kinds.LongFormArticle,
      pubkey: article.event.pubkey,
      identifier: dTag,
    });
    this.router.navigate([{ outlets: { primary: ['a', naddr], right: null } }], {
      state: { event: article.event }
    });
    this.searchService.clearResults();
    this.layout.toggleSearch();
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
