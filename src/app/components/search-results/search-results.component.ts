import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule, MatSelectionList } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { SearchService } from '../../services/search.service';
import { UtilitiesService } from '../../services/utilities.service';

@Component({
  selector: 'app-search-results',
  standalone: true,  imports: [
    CommonModule,
    MatListModule,
    MatIconModule,
    MatButtonModule
  ],
  template: `
    @if (searchService.searchResults().length > 0) {
    <div class="search-results">
      <div class="search-results-header">
        <span>Cached Profiles ({{ searchService.searchResults().length }})</span>
        <button mat-icon-button (click)="searchService.clearResults()">
          <mat-icon>close</mat-icon>
        </button>
      </div>      <mat-selection-list>
        @for (profile of searchService.searchResults(); track profile.event.pubkey) {
        <mat-list-option (click)="searchService.selectSearchResult(profile)">
          <div class="search-result-item">
            @if (profile.data.picture) {
            <img [src]="profile.data.picture" alt="Profile picture" class="search-result-avatar">
            } @else {
            <mat-icon class="search-result-avatar-icon">account_circle</mat-icon>
            }
            <div class="search-result-info">
              <div class="search-result-name">
                {{ profile.data.display_name || profile.data.name || utilities.getNpubFromPubkey(profile.event.pubkey) }}
              </div>
              @if (profile.data.nip05) {
              <div class="search-result-nip05">{{ utilities.parseNip05(profile.data.nip05) }}</div>
              }
              <!-- @if (profile.data.about) {
              <div class="search-result-about">{{ (profile.data.about | slice:0:80) }}@if (profile.data.about.length > 80) {...}</div>
              } -->
            </div>
          </div>
        </mat-list-option>
        }
      </mat-selection-list>
    </div>
    }
  `,
  styles: [`
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
      z-index: 1000;
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

    .search-result-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 0;
      width: 100%;
    }

    .search-result-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      object-fit: cover;
    }

    .search-result-avatar-icon {
      width: 40px;
      height: 40px;
      font-size: 40px;
      color: var(--mat-sys-on-surface-variant);
    }

    .search-result-info {
      flex: 1;
      min-width: 0;
    }

    .search-result-name {
      font-weight: 500;
      font-size: 14px;
      color: var(--mat-sys-on-surface);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .search-result-nip05 {
      font-size: 12px;
      color: var(--mat-sys-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .search-result-about {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      line-height: 1.3;
      margin-top: 2px;
    }

    mat-selection-list {
      padding: 0;
    }

    mat-list-option {
      padding: 8px 16px !important;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    mat-list-option:last-child {
      border-bottom: none;
    }

    mat-list-option:hover {
      background: var(--mat-sys-surface-container-high);
    }
  `]
})
export class SearchResultsComponent {
  searchService = inject(SearchService);
  utilities = inject(UtilitiesService);
}
