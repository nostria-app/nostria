import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
  ElementRef,
  ChangeDetectionStrategy,
} from '@angular/core';

import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { AccountStateService } from '../../services/account-state.service';
import { UtilitiesService } from '../../services/utilities.service';
import { UserRelaysService } from '../../services/relays/user-relays';
import { DatabaseService } from '../../services/database.service';
import { UserDataService } from '../../services/user-data.service';
import { NostrRecord } from '../../interfaces';
import { nip19 } from 'nostr-tools';
import { FollowingService } from '../../services/following.service';
import { LoggerService } from '../../services/logger.service';

export interface MentionSelection {
  pubkey: string;
  nprofileUri: string;
  displayName: string;
}

export interface MentionAutocompleteConfig {
  /** Current cursor position in the text */
  cursorPosition: number;
  /** The mention search query (text after @) */
  query: string;
  /** Starting position of the @ mention in the text */
  mentionStart: number;
}

@Component({
  selector: 'app-mention-autocomplete',
  imports: [
    MatListModule,
    MatIconModule,
    MatProgressSpinnerModule,
    UserProfileComponent
],
  template: `
    @if (isVisible() && searchResults().length > 0) {
      <div 
        class="mention-autocomplete"
        [style.top.px]="position().top"
        [style.left.px]="position().left"
        [style.maxHeight.px]="maxHeight()"
        (keydown)="onKeyDown($event)"
        tabindex="0"
        #autocompleteContainer
      >
        <div class="mention-autocomplete-header">
          <mat-icon class="mention-icon">alternate_email</mat-icon>
          <span class="mention-title">Mention someone</span>
          <span class="mention-count">({{ searchResults().length }})</span>
        </div>
        
        <div class="mention-autocomplete-list">
          @for (profile of searchResults(); track profile.event.pubkey; let i = $index) {
            <div 
              class="mention-item"
              [class.focused]="focusedIndex() === i"
              (click)="selectMention(profile)"
              (mouseenter)="setFocusedIndex(i)"
              tabindex="0"
              role="button"
              [attr.aria-selected]="focusedIndex() === i"
              #mentionItem
            >
              <div class="mention-item-avatar">
                <app-user-profile
                  [pubkey]="profile.event.pubkey"
                  [view]="'small'"
                  [hostWidthAuto]="false"
                ></app-user-profile>
              </div>
              <div class="mention-item-details">
                <div class="mention-item-name">
                  {{ getDisplayName(profile) }}
                </div>
                @if (profile.data.nip05) {
                  <div class="mention-item-nip05">
                    {{ utilities.parseNip05(profile.data.nip05) }}
                  </div>
                }
                @if (profile.data.about) {
                  <div class="mention-item-about">
                    {{ getTruncatedAbout(profile.data.about) }}
                  </div>
                }
              </div>
              <div class="mention-item-meta">
                <div class="mention-item-pubkey">
                  {{ utilities.getTruncatedNpub(profile.event.pubkey) }}
                </div>
                @if (isFollowing(profile.event.pubkey)) {
                  <div class="mention-item-following">
                    <mat-icon class="following-icon">person_check</mat-icon>
                    <span>Following</span>
                  </div>
                }
              </div>
            </div>
          }
        </div>

        <div class="mention-autocomplete-footer">
          <small class="mention-hint">
            ↑↓ to navigate • Enter to select • Esc to close
          </small>
        </div>
      </div>
    }
  `,
  styleUrl: './mention-autocomplete.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MentionAutocompleteComponent {
  // Services
  private readonly accountState = inject(AccountStateService);
  private readonly followingService = inject(FollowingService);
  private readonly userRelaysService = inject(UserRelaysService);
  private readonly database = inject(DatabaseService);
  private readonly userData = inject(UserDataService);
  readonly utilities = inject(UtilitiesService);
  private readonly logger = inject(LoggerService);

  // Inputs
  config = input.required<MentionAutocompleteConfig | null>();
  /** Maximum number of results to show */
  maxResults = input<number>(8);
  /** Position for the autocomplete dropdown */
  position = input<{ top: number; left: number }>({ top: 0, left: 0 });
  /** Maximum height of the dropdown */
  maxHeight = input<number>(300);

  // Outputs
  mentionSelected = output<MentionSelection>();
  dismissed = output<void>();

  // View references
  autocompleteContainer = viewChild<ElementRef<HTMLDivElement>>('autocompleteContainer');

  // State
  isVisible = computed(() => {
    const cfg = this.config();
    return cfg !== null && cfg.query.length >= 0 && this.searchResults().length > 0;
  });

  searchResults = signal<NostrRecord[]>([]);
  focusedIndex = signal<number>(0);
  isLoading = signal<boolean>(false);

  // Search effect
  private searchEffect = effect(() => {
    const cfg = this.config();
    if (!cfg) {
      this.searchResults.set([]);
      return;
    }

    this.performSearch(cfg.query);
  });

  // Focus management effect - DO NOT take focus from textarea
  // private focusEffect = effect(() => {
  //   if (this.isVisible()) {
  //     // Focus the container when it becomes visible
  //     setTimeout(() => {
  //       this.autocompleteContainer()?.nativeElement?.focus();
  //     }, 0);
  //   }
  // });

  // Scroll to focused item when index changes
  private scrollEffect = effect(() => {
    const index = this.focusedIndex();
    const visible = this.isVisible();

    if (visible) {
      this.scrollToFocusedItem(index);
    }
  });

  constructor() {
    // Reset focused index when search results change
    effect(() => {
      this.searchResults();
      this.focusedIndex.set(0);
    });
  }

  private performSearch(query: string): void {
    if (query.length === 0) {
      // Show recent profiles when no query - just get first few from following list
      const recentProfiles = this.followingService.profiles().slice(0, this.maxResults());
      const records = this.followingService.toNostrRecords(recentProfiles);
      this.searchResults.set(records);
      return;
    }

    // Search following profiles using FollowingService (these get priority)
    const followingResults = this.followingService.searchProfiles(query);
    const followingRecords = this.followingService.toNostrRecords(followingResults);

    // If we have enough results from following, use those
    if (followingRecords.length >= this.maxResults()) {
      this.searchResults.set(followingRecords.slice(0, this.maxResults()));
      return;
    }

    // Otherwise, also search cached profiles in the database
    // This includes profiles you've viewed but don't follow
    this.searchCachedProfiles(query, followingRecords);
  }

  /**
   * Search cached profiles in the database and merge with following results
   * Following profiles appear first, then other cached profiles
   */
  private async searchCachedProfiles(query: string, followingRecords: NostrRecord[]): Promise<void> {
    try {
      this.isLoading.set(true);
      const followingPubkeys = new Set(followingRecords.map(r => r.event.pubkey));

      // Search all cached profiles in the database
      const cachedEvents = await this.database.searchCachedProfiles(query);

      // Convert to NostrRecord and filter out duplicates (already in following results)
      const additionalRecords: NostrRecord[] = [];
      for (const event of cachedEvents) {
        if (!followingPubkeys.has(event.pubkey)) {
          const record = this.userData.toRecord(event);
          additionalRecords.push(record);
        }
      }

      // Merge: following first, then other cached profiles
      const mergedResults = [
        ...followingRecords,
        ...additionalRecords,
      ].slice(0, this.maxResults());

      this.searchResults.set(mergedResults);
    } catch (error) {
      this.logger.warn('[MentionAutocomplete] Error searching cached profiles:', error);
      // Fall back to just following results
      this.searchResults.set(followingRecords.slice(0, this.maxResults()));
    } finally {
      this.isLoading.set(false);
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    const results = this.searchResults();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        this.focusedIndex.update(index =>
          Math.min(index + 1, results.length - 1)
        );
        break;

      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        this.focusedIndex.update(index => Math.max(index - 1, 0));
        break;

      case 'Enter': {
        event.preventDefault();
        event.stopPropagation();
        const focusedProfile = results[this.focusedIndex()];
        if (focusedProfile) {
          this.selectMention(focusedProfile);
        }
        break;
      } case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.dismissed.emit();
        break;
    }
  }

  private scrollToFocusedItem(index: number): void {
    setTimeout(() => {
      const container = this.autocompleteContainer()?.nativeElement;
      const items = container?.querySelectorAll('.mention-item');

      if (items && items[index]) {
        const item = items[index] as HTMLElement;
        item.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'nearest'
        });
      }
    }, 10);
  }

  setFocusedIndex(index: number): void {
    this.focusedIndex.set(index);
  }

  selectMention(profile: NostrRecord): void {
    // Create NIP-27 compliant mention
    const mentionSelection: MentionSelection = {
      pubkey: profile.event.pubkey,
      nprofileUri: this.createNprofileUri(profile.event.pubkey),
      displayName: this.getDisplayName(profile),
    };

    this.mentionSelected.emit(mentionSelection);
  }

  private createNprofileUri(pubkey: string): string {
    try {
      // Get user's relays for this pubkey
      const relays = this.userRelaysService.getRelaysForPubkey(pubkey);

      const nprofile = nip19.nprofileEncode({
        pubkey,
        relays: relays?.slice(0, 3) || [], // Include up to 3 relay hints
      });

      return `nostr:${nprofile}`;
    } catch (error) {
      this.logger.warn('Failed to create nprofile URI, falling back to npub:', error);

      // Fallback to npub if nprofile fails
      const npub = nip19.npubEncode(pubkey);
      return `nostr:${npub}`;
    }
  }

  getDisplayName(profile: NostrRecord): string {
    return (
      profile.data?.display_name ||
      profile.data?.name ||
      this.utilities.getTruncatedNpub(profile.event.pubkey)
    );
  }

  getTruncatedAbout(about: string): string {
    if (!about) return '';
    return about.length > 80 ? about.substring(0, 80) + '...' : about;
  }

  isFollowing(pubkey: string): boolean {
    return this.accountState.followingList().includes(pubkey);
  }
}