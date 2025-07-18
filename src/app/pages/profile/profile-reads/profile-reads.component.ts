import { Component, inject, signal, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { ProfileStateService } from '../../../services/profile-state.service';
import { MatCardModule } from '@angular/material/card';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BookmarkService } from '../../../services/bookmark.service';
import { MatButtonModule } from '@angular/material/button';
import { UtilitiesService } from '../../../services/utilities.service';
import { TagsPipe } from '../../../pipes/tags';

@Component({
  selector: 'app-profile-reads',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatCardModule,
    UserProfileComponent,
    RouterModule,
    MatTooltipModule,
    MatButtonModule,
    TagsPipe
  ],
  templateUrl: './profile-reads.component.html',
  styleUrl: './profile-reads.component.scss'
})
export class ProfileReadsComponent implements OnChanges {
  @Input() isVisible = false;

  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  profileState = inject(ProfileStateService);
  bookmark = inject(BookmarkService);
  utilities = inject(UtilitiesService);

  isLoading = signal(true);
  reads = signal<any[]>([]);
  error = signal<string | null>(null);

  constructor() {
    // Initial load of reads
    this.loadReads();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Check if visibility changed to true
    if (changes['isVisible'] && 
        changes['isVisible'].currentValue === true && 
        (!changes['isVisible'].firstChange || changes['isVisible'].previousValue === false)) {
      this.logger.debug('Profile reads tab became visible, reloading data');
      this.loadReads();
    }
  }

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }

  async loadReads(): Promise<void> {
    // Don't load if not visible (unless it's the initial load)
    // if (!this.isVisible && this.reads().length > 0) {
    //   return;
    // }
    
    // const pubkey = this.getPubkey();
    
    // if (!pubkey) {
    //   this.error.set('No pubkey provided');
    //   this.isLoading.set(false);
    //   return;
    // }

    // try {
    //   this.isLoading.set(true);
    //   this.error.set(null);
      
    //   // Mock data for now - would be replaced with actual fetch from NostrService
    //   await new Promise(resolve => setTimeout(resolve, 500));

    //   // Set empty array for now
    //   this.reads.set([]);
      
    //   this.logger.debug('Loaded reads for pubkey:', pubkey);
    // } catch (err) {
    //   this.logger.error('Error loading reads:', err);
    //   this.error.set('Failed to load reads');
    // } finally {
    //   this.isLoading.set(false);
    // }
  }
}
