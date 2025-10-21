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
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { UserProfileComponent } from '../user-profile/user-profile.component';
import { AccountStateService } from '../../services/account-state.service';
import { UtilitiesService } from '../../services/utilities.service';
import { UserRelaysService } from '../../services/relays/user-relays';
import { NostrRecord } from '../../interfaces';
import { nip19 } from 'nostr-tools';

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
  standalone: true,
  imports: [
    CommonModule,
    MatListModule,
    MatIconModule,
    MatProgressSpinnerModule,
    UserProfileComponent,
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
export class MentionAutocompleteComponent implements OnInit {
  // Services
  private readonly accountState = inject(AccountStateService);
  private readonly userRelaysService = inject(UserRelaysService);
  readonly utilities = inject(UtilitiesService);

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

  ngOnInit(): void {
    // Reset focused index when search results change
    effect(() => {
      this.searchResults();
      this.focusedIndex.set(0);
    });
  }

  private performSearch(query: string): void {
    if (query.length === 0) {
      // Show recent profiles when no query - just get first few from following list
      const followingPubkeys = this.accountState.followingList().slice(0, this.maxResults());
      const recentProfiles: NostrRecord[] = [];

      for (const pubkey of followingPubkeys) {
        const profile = this.accountState.getCachedProfile(pubkey);
        if (profile) {
          recentProfiles.push(profile);
        }
      }

      this.searchResults.set(recentProfiles);
      return;
    }

    // Search following profiles first
    const followingResults = this.accountState.searchProfiles(query);
    this.searchResults.set(followingResults.slice(0, this.maxResults()));
  }

  onKeyDown(event: KeyboardEvent): void {
    const results = this.searchResults();

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.focusedIndex.update(index =>
          Math.min(index + 1, results.length - 1)
        );
        break;

      case 'ArrowUp':
        event.preventDefault();
        this.focusedIndex.update(index => Math.max(index - 1, 0));
        break;

      case 'Enter': {
        event.preventDefault();
        const focusedProfile = results[this.focusedIndex()];
        if (focusedProfile) {
          this.selectMention(focusedProfile);
        }
        break;
      } case 'Escape':
        event.preventDefault();
        this.dismissed.emit();
        break;
    }
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
      console.warn('Failed to create nprofile URI, falling back to npub:', error);

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