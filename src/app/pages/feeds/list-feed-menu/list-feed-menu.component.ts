import {
  Component,
  inject,
  signal,
  output,
  effect,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { LoggerService } from '../../../services/logger.service';
import { AccountStateService } from '../../../services/account-state.service';
import { FollowSetsService, FollowSet } from '../../../services/follow-sets.service';
import { CollectionSetsService, InterestSet } from '../../../services/collection-sets.service';

export interface ListFeedSelection {
  dTag: string;
  title: string;
  pubkeys: string[];
}

export interface InterestFeedSelection {
  dTag: string;
  title: string;
  hashtags: string[];
}

@Component({
  selector: 'app-list-feed-menu',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatDividerModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <button
      mat-icon-button
      [matMenuTriggerFor]="listMenu"
      matTooltip="List feeds"
      class="list-menu-trigger"
    >
      <mat-icon>people</mat-icon>
    </button>

    <mat-menu #listMenu="matMenu" class="list-feed-selector-menu">
      <!-- People Lists Section -->
      <div class="menu-header" role="presentation">
        <mat-icon>people</mat-icon>
        <span>People Lists</span>
      </div>

      <mat-divider></mat-divider>

      @if (isLoading()) {
        <div class="loading-state" role="presentation">
          <mat-spinner diameter="24"></mat-spinner>
          <span>Loading lists...</span>
        </div>
      } @else if (followSets().length === 0) {
        <div class="empty-state" role="presentation">
          <mat-icon>list_alt</mat-icon>
          <span>No lists found</span>
          <span class="empty-hint">Create lists in Collections → People Lists</span>
        </div>
      } @else {
        <div class="list-items">
          @for (list of followSets(); track list.dTag) {
            <button
              mat-menu-item
              (click)="onSelectList(list)"
              [class.active]="list.dTag === selectedList()"
            >
              <mat-icon class="list-item-icon">
                {{ list.isPrivate ? 'lock' : 'people' }}
              </mat-icon>
              <span class="list-item-name">{{ list.title }}</span>
              <span class="menu-item-count">{{ list.pubkeys.length }}</span>
            </button>
          }
        </div>
      }

      <!-- Interests Section -->
      <mat-divider></mat-divider>
      
      <div class="menu-header" role="presentation">
        <mat-icon>tag</mat-icon>
        <span>Interests</span>
      </div>

      <mat-divider></mat-divider>

      @if (isLoadingInterests()) {
        <div class="loading-state" role="presentation">
          <mat-spinner diameter="24"></mat-spinner>
          <span>Loading interests...</span>
        </div>
      } @else if (interestSets().length === 0) {
        <div class="empty-state" role="presentation">
          <mat-icon>tag</mat-icon>
          <span>No interests found</span>
          <span class="empty-hint">Add interests in Collections → Interests</span>
        </div>
      } @else {
        <div class="list-items">
          @for (interest of interestSets(); track interest.identifier) {
            <button
              mat-menu-item
              (click)="onSelectInterest(interest)"
              [class.active]="interest.identifier === selectedInterest()"
            >
              <mat-icon class="list-item-icon">tag</mat-icon>
              <span class="list-item-name">{{ interest.title }}</span>
              <span class="menu-item-count">{{ interest.hashtags.length }}</span>
            </button>
          }
        </div>
      }

      @if (selectedList() || selectedInterest()) {
        <mat-divider></mat-divider>
        <button mat-menu-item (click)="onClearSelection()">
          <mat-icon>close</mat-icon>
          <span>Clear selection</span>
        </button>
      }
    </mat-menu>
  `,
  styles: [
    `
      .list-menu-trigger {
        margin-left: 8px;
      }

      ::ng-deep .list-feed-selector-menu {
        min-width: 280px;
        max-height: 500px;
        margin-top: 8px;
      }

      .menu-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        cursor: default;
        background-color: var(--mat-sys-surface-container-low);

        mat-icon:first-child {
          color: var(--mat-sys-primary);
          font-size: 24px;
          width: 24px;
          height: 24px;
        }

        span {
          color: var(--mat-sys-on-surface);
          font-size: 1rem;
          font-weight: 600;
          flex: 1;
        }
      }

      .loading-state,
      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 24px 16px;
        gap: 8px;
        color: var(--mat-sys-on-surface-variant);

        mat-icon {
          font-size: 32px;
          width: 32px;
          height: 32px;
          opacity: 0.5;
        }

        .empty-hint {
          font-size: 12px;
          text-align: center;
          opacity: 0.7;
        }
      }

      .list-items {
        max-height: 350px;
        overflow-y: auto;
      }

      ::ng-deep .list-feed-selector-menu .mat-mdc-menu-item {
        position: relative;
        padding: 10px 16px !important;
        min-height: 44px !important;
        height: auto !important;

        // Force horizontal layout
        .mat-mdc-menu-item-text {
          display: flex !important;
          flex-direction: row !important;
          align-items: center !important;
          gap: 12px !important;
          width: 100% !important;
        }

        &.active {
          background-color: var(--mat-sys-primary-container);

          .list-item-icon {
            color: var(--mat-sys-primary);
          }

          .list-item-name {
            color: var(--mat-sys-on-primary-container);
            font-weight: 500;
          }

          .menu-item-count {
            background-color: var(--mat-sys-primary);
            color: var(--mat-sys-on-primary);
          }
        }
      }

      .list-item-icon {
        width: 20px;
        height: 20px;
        font-size: 20px;
        color: var(--mat-sys-on-surface-variant);
        flex-shrink: 0;
      }

      .list-item-name {
        font-size: 14px;
        color: var(--mat-sys-on-surface);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
        min-width: 0;
      }

      .menu-item-count {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        height: 20px;
        padding: 0 6px;
        border-radius: 10px;
        background-color: var(--mat-sys-surface-container-highest);
        font-size: 0.7rem;
        font-weight: 700;
        color: var(--mat-sys-on-surface);
        flex-shrink: 0;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListFeedMenuComponent {
  private logger = inject(LoggerService);
  private accountState = inject(AccountStateService);
  private followSetsService = inject(FollowSetsService);
  private collectionSetsService = inject(CollectionSetsService);

  // Outputs
  listSelected = output<ListFeedSelection | null>();
  interestSelected = output<InterestFeedSelection | null>();

  // State
  selectedList = signal<string>('');
  selectedInterest = signal<string>('');
  private lastLoadedPubkey = '';

  // Expose service signals for people lists, sorted alphabetically by title
  followSets = computed(() =>
    this.followSetsService.followSets().slice().sort((a, b) => a.title.localeCompare(b.title))
  );
  isLoading = this.followSetsService.isLoading;

  // Interest sets state
  interestSets = signal<InterestSet[]>([]);
  isLoadingInterests = signal(false);

  constructor() {
    // Load follow sets and interest sets when account changes
    effect(() => {
      const pubkey = this.accountState.pubkey();
      if (pubkey && pubkey !== this.lastLoadedPubkey) {
        this.lastLoadedPubkey = pubkey;
        // Follow sets are loaded automatically by the service when account changes
        this.logger.debug('[ListFeedMenu] Account changed, follow sets will be loaded by service');
        
        // Load interest sets
        this.loadInterestSets(pubkey);
      }
    });
  }

  private async loadInterestSets(pubkey: string): Promise<void> {
    this.isLoadingInterests.set(true);
    try {
      const sets = await this.collectionSetsService.getInterestSets(pubkey);
      this.interestSets.set(sets);
      this.logger.debug('[ListFeedMenu] Loaded interest sets:', sets.length);
    } catch (error) {
      this.logger.error('[ListFeedMenu] Error loading interest sets:', error);
      this.interestSets.set([]);
    } finally {
      this.isLoadingInterests.set(false);
    }
  }

  onSelectList(list: FollowSet): void {
    if (list.pubkeys.length === 0) {
      this.logger.warn('[ListFeedMenu] Selected list has no pubkeys');
      return;
    }

    // Clear interest selection when selecting a list
    this.selectedInterest.set('');
    this.selectedList.set(list.dTag);
    this.listSelected.emit({
      dTag: list.dTag,
      title: list.title,
      pubkeys: list.pubkeys,
    });
  }

  onSelectInterest(interest: InterestSet): void {
    if (interest.hashtags.length === 0) {
      this.logger.warn('[ListFeedMenu] Selected interest has no hashtags');
      return;
    }

    // Clear list selection when selecting an interest
    this.selectedList.set('');
    this.selectedInterest.set(interest.identifier);
    this.interestSelected.emit({
      dTag: interest.identifier,
      title: interest.title,
      hashtags: interest.hashtags,
    });
  }

  onClearSelection(): void {
    this.selectedList.set('');
    this.selectedInterest.set('');
    this.listSelected.emit(null);
    this.interestSelected.emit(null);
  }

  setSelectedList(dTag: string): void {
    this.selectedList.set(dTag);
    this.selectedInterest.set('');
  }

  setSelectedInterest(dTag: string): void {
    this.selectedInterest.set(dTag);
    this.selectedList.set('');
  }

  clearSelection(): void {
    this.selectedList.set('');
    this.selectedInterest.set('');
  }
}
