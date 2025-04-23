import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { RouterModule } from '@angular/router';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { NostrService } from '../../services/nostr.service';
import { LoggerService } from '../../services/logger.service';
import { StorageService, InfoRecord } from '../../services/storage.service';
import { debounceTime } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { UserProfileComponent } from '../../components/user-profile/user-profile.component';
import { Router } from '@angular/router';
import { AccountStateService } from '../../services/account-state.service';

// Define filter options interface
interface FilterOptions {
  hasRelayList: boolean;
  hasFollowingList: boolean;
  hasNip05: boolean;
  hasPicture: boolean;
  hasBio: boolean;
}

@Component({
  selector: 'app-people',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatButtonToggleModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatMenuModule,
    MatCheckboxModule,
    RouterModule,
    ScrollingModule,
    UserProfileComponent,
    MatMenuModule
  ],
  templateUrl: './people.component.html',
  styleUrls: ['./people.component.scss']
})
export class PeopleComponent {
  private router = inject(Router);
  private nostr = inject(NostrService);
  private logger = inject(LoggerService);
  private storage = inject(StorageService);
  private accountState = inject(AccountStateService);

  // People data signals
  people = signal<string[]>([]);
  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);
  
  // Search functionality
  searchTerm = signal<string>('');
  private searchChanged = new Subject<string>();

  // View mode
  viewMode = signal<string | any>('medium');
  
  // Filter options
  filters = signal<FilterOptions>({
    hasRelayList: false,
    hasFollowingList: false,
    hasNip05: false,
    hasPicture: false,
    hasBio: false
  });

  // Cache for user info records
  userInfoCache = signal<Map<string, InfoRecord>>(new Map());

  // Computed signal for filtered people
  filteredPeople = computed(() => {
    const search = this.searchTerm().toLowerCase();
    const activeFilters = this.filters();
    
    return this.people().filter(pubkey => {
      // If there's a search term, filter by it first
      if (search) {
        const metadata = this.nostr.usersMetadata().get(pubkey);
        if (!metadata) return false;
        
        const content = typeof metadata.content === 'string' 
          ? JSON.parse(metadata.content) 
          : metadata.content;
          
        const name = content?.name || '';
        const displayName = content?.display_name || '';
        const nip05 = content?.nip05 || '';
        const about = content?.about || '';
        
        const searchTerms = `${name} ${displayName} ${nip05} ${about}`.toLowerCase();
        if (!searchTerms.includes(search)) return false;
      }
      
      // Apply advanced filters if any are active
      if (this.hasActiveFilters()) {
        // Get user info record
        const userInfo = this.userInfoCache().get(pubkey);
        
        // Get user metadata
        const metadata = this.nostr.usersMetadata().get(pubkey);
        const content = metadata && metadata.content ? 
          (typeof metadata.content === 'string' ? JSON.parse(metadata.content) : metadata.content) : 
          null;
        
        // Apply filters
        if (activeFilters.hasRelayList && 
            (!userInfo || userInfo['hasRelayList'] !== true)) {
          return false;
        }
        
        if (activeFilters.hasFollowingList && 
            (!userInfo || userInfo['hasFollowingListRelays'] !== true)) {
          return false;
        }
        
        if (activeFilters.hasNip05 && 
            (!content || !content.nip05)) {
          return false;
        }
        
        if (activeFilters.hasPicture && 
            (!content || !content.picture)) {
          return false;
        }
        
        if (activeFilters.hasBio && 
            (!content || !content.about || content.about.trim() === '')) {
          return false;
        }
      }
      
      return true;
    });
  });

  // Virtual scrolling settings
  minBufferPx = 800;
  maxBufferPx = 1000;
  
  // Computed item size based on view mode
  itemSize = computed(() => {
    switch (this.viewMode()) {
      case 'large': return 200;
      case 'medium': return 150;
      case 'small': return 100;
      case 'details': return 72;
      case 'tiles': return 150;
      default: return 150;
    }
  });

  // Check if any filters are active
  hasActiveFilters = computed(() => {
    const activeFilters = this.filters();
    return Object.values(activeFilters).some(val => val === true);
  });

  constructor() {
    // Initialize search debounce
    this.searchChanged.pipe(
      debounceTime(300)
    ).subscribe(term => {
      this.searchTerm.set(term);
    });
    
    // Load people data on component init
    this.loadPeople();
    
    // Load view mode from localStorage if available
    const savedViewMode = localStorage.getItem('peopleViewMode');
    if (savedViewMode) {
      this.viewMode.set(savedViewMode);
    }
    
    // Load filters from localStorage if available
    const savedFilters = localStorage.getItem('peopleFilters');
    if (savedFilters) {
      try {
        this.filters.set(JSON.parse(savedFilters));
      } catch (e) {
        this.logger.error('Failed to load saved filters', e);
      }
    }
    
    // Save filters when they change
    effect(() => {
      localStorage.setItem('peopleFilters', JSON.stringify(this.filters()));
    });
  }

  private async loadPeople() {
    try {
      this.isLoading.set(true);
      this.error.set(null);
      
      // Get following list from account state
      const followingList = this.accountState.followingList();
      
      if (followingList.length === 0) {
        this.people.set([]);
        this.isLoading.set(false);
        return;
      }
      
      this.people.set(followingList);
      
      // Load user info records for filtering
      await this.loadUserInfoRecords(followingList);
      
      // Preload metadata for all people
      this.preloadMetadata(followingList);
      
      this.isLoading.set(false);
    } catch (err) {
      this.logger.error('Failed to load people', err);
      this.error.set('Failed to load people. Please try again later.');
      this.isLoading.set(false);
    }
  }
  
  private async loadUserInfoRecords(pubkeys: string[]) {
    try {
      // Get user info records for filtering
      const userInfoRecords = await this.storage.getInfoByType('user');
      
      // Build cache map
      const cache = new Map<string, InfoRecord>();
      for (const record of userInfoRecords) {
        if (pubkeys.includes(record.key)) {
          cache.set(record.key, record);
        }
      }
      
      this.userInfoCache.set(cache);
    } catch (err) {
      this.logger.error('Failed to load user info records', err);
    }
  }

  private preloadMetadata(pubkeys: string[]) {
    // Load metadata for the first 20 users to improve initial rendering
    const initialBatch = pubkeys.slice(0, 20);
    
    for (const pubkey of initialBatch) {
      this.nostr.getMetadataForUser(pubkey).catch(err => 
        this.logger.error(`Failed to preload metadata for ${pubkey}`, err));
    }
    
    // Load the rest in the background
    setTimeout(() => {
      const remainingBatch = pubkeys.slice(20);
      for (const pubkey of remainingBatch) {
        this.nostr.getMetadataForUser(pubkey).catch(err => 
          this.logger.error(`Failed to preload metadata for ${pubkey}`, err));
      }
    }, 1000);
  }

  updateSearch(term: string) {
    this.searchChanged.next(term);
  }

  changeViewMode(mode: string) {
    this.viewMode.set(mode);
    localStorage.setItem('peopleViewMode', mode);
  }
  
  toggleFilter(filterName: keyof FilterOptions, event?: Event | any) {
    this.filters.update(current => ({
      ...current,
      [filterName]: !current[filterName]
    }));
  }
  
  resetFilters() {
    this.filters.set({
      hasRelayList: false,
      hasFollowingList: false,
      hasNip05: false,
      hasPicture: false,
      hasBio: false
    });
  }
  
  preventPropagation(event: Event | any) {
    event.stopPropagation();
  }

  viewProfile(pubkey: string) {
    this.router.navigate(['/profile', pubkey]);
  }
}
