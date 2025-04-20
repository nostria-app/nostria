import { Component, inject, signal, effect, OnInit, untracked, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { LayoutService } from '../../services/layout.service';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { ProfileStateService } from '../../services/profile-state.service';
import { NostrEvent, ViewMode } from '../../interfaces';
import { AccountStateService } from '../../services/account-state.service';

@Component({
  selector: 'app-people',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    MatDividerModule,
    MatProgressSpinnerModule,
    MatListModule,
    MatTooltipModule,
    MatButtonToggleModule,
    MatMenuModule,
    RouterLink,
    UserProfileComponent,
    ScrollingModule
  ],
  templateUrl: './people.component.html',
  styleUrl: './people.component.scss'
})
export class PeopleComponent implements OnInit {
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  layout = inject(LayoutService);
  accountState = inject(AccountStateService);

  // View state
  viewMode = signal<ViewMode>('medium');
  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);
  people = signal<string[]>([]);
  filteredPeople = signal<string[]>([]);
  searchTerm = signal<string>('');
  
  // Virtual scrolling properties
  itemSize = computed(() => {
    // Adjust item size based on view mode
    switch (this.viewMode()) {
      case 'large':
      case 'grid':
        return 320; // Height of large cards
      case 'medium':
        return 200; // Height of medium cards
      case 'small':
        return 120; // Height of small cards
      case 'details':
      case 'list':
        return 72;  // Height of list items
      case 'tiles':
        return 180; // Height of tile cards
      default:
        return 72;
    }
  });
  
  readonly minBufferPx = 200;
  readonly maxBufferPx = 400;

  constructor() {
    // React to changes in the following list
    effect(() => {
      const followingList = this.accountState.followingList();
      untracked(async () => {
        await this.loadPeople(followingList);
      });
    });

    // Search filter effect
    effect(() => {
      const search = this.searchTerm().toLowerCase();
      const allPeople = this.people();

      if (!search) {
        this.filteredPeople.set(allPeople);
      } else {
        // const filtered = allPeople.filter(person =>
        //   (person.displayName && person.displayName.toLowerCase().includes(search)) ||
        //   (person.name && person.name.toLowerCase().includes(search)) ||
        //   (person.about && person.about.toLowerCase().includes(search)) ||
        //   (person.nip05 && person.nip05.toLowerCase().includes(search)) ||
        //   (this.nostrService.getNpubFromPubkey(person.pubkey).toLowerCase().includes(search))
        // );
        // this.filteredPeople.set(filtered);
      }
    });
  }

  async ngOnInit(): Promise<void> {
    // Load the saved view mode preference if available
    const savedViewMode = localStorage.getItem('peopleViewMode');
    if (savedViewMode) {
      this.viewMode.set(savedViewMode as ViewMode);
    }

    // If there's no following list yet, try to load it
    // if (this.profileState.followingList().length === 0) {
    //   await this.loadFollowingList();
    // }
  }

  /**
   * Load the following list for the current user
   */
  async loadFollowingList(): Promise<void> {
    try {
      const pubkey = this.nostrService.activeAccount()?.pubkey;
      if (pubkey) {
        // The contacts event will be loaded by the NostrService and the
        // ProfileStateService will update the followingList signal
        // This is handled by effects in those services
        this.logger.debug('Requesting contacts load for pubkey:', pubkey);
      }
    } catch (error) {
      this.logger.error('Error loading following list:', error);
      this.error.set('Failed to load following list');
    }
  }

  /**
   * Load people details from their pubkeys
   */
  async loadPeople(pubkeys: string[]): Promise<void> {
    try {
      this.isLoading.set(true);
      this.error.set(null);

      if (!pubkeys || pubkeys.length === 0) {
        this.people.set([]);
        this.filteredPeople.set([]);
        this.isLoading.set(false);
        return;
      }

      console.log(this.accountState.followingList());

      this.people.set(this.accountState.followingList());
      this.filteredPeople.set(this.accountState.followingList());

      // const peopleList: Person[] = [];
      // this.people.set([...peopleList]);
      // this.filteredPeople.set([...peopleList]);

      // Process in batches to avoid overwhelming the UI
      // const batchSize = 10;
      // for (let i = 0; i < pubkeys.length; i += batchSize) {
      //   const batch = pubkeys.slice(i, i + batchSize);

      //   // Load metadata for each person in parallel
      //   const batchPromises = batch.map(async pubkey => {
      //     try {
      //       const metadata = await this.nostrService.getMetadataForUser(pubkey);

      //       const person: Person = {
      //         pubkey,
      //         following: true
      //       };

      //       if (metadata?.content) {
      //         person.displayName = metadata.content.display_name;
      //         person.name = metadata.content.name;
      //         person.picture = metadata.content.picture;
      //         person.about = metadata.content.about;
      //         person.nip05 = metadata.content.nip05;
      //         person.metadata = metadata;
      //       }

      //       return person;
      //     } catch (error) {
      //       this.logger.warn(`Failed to load metadata for ${pubkey}`, error);
      //       return { pubkey, following: true };
      //     }
      //   });

      //   const batchResults = await Promise.all(batchPromises);
      //   peopleList.push(...batchResults);

      //   // Update the lists incrementally
      //   this.people.set([...peopleList]);
      //   this.filteredPeople.set([...peopleList]);
      // }

      // this.logger.debug(`Loaded ${peopleList.length} people`);

    } catch (err) {
      this.logger.error('Error loading people:', err);
      this.error.set('Failed to load people data');
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Change the current view mode and save the preference
   */
  changeViewMode(mode: ViewMode): void {
    this.viewMode.set(mode);
    localStorage.setItem('peopleViewMode', mode);
  }

  /**
   * Update the search term
   */
  updateSearch(term: string): void {
    this.searchTerm.set(term);
  }

  /**
   * Navigate to a person's profile
   */
  viewProfile(pubkey: string): void {
    this.layout.navigateToProfile(pubkey);
  }

  /**
   * Follow a user
   */
  followUser(event: Event, pubkey: string): void {
    event.stopPropagation();
    this.logger.debug('Follow requested for:', pubkey);
    // TODO: Implement actual follow functionality
  }

  /**
   * Unfollow a user
   */
  unfollowUser(event: Event, pubkey: string): void {
    event.stopPropagation();
    this.logger.debug('Unfollow requested for:', pubkey);
    // TODO: Implement actual unfollow functionality
  }
}
