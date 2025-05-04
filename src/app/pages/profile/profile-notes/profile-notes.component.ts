import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { LoadingOverlayComponent } from '../../../components/loading-overlay/loading-overlay.component';
import { ProfileStateService } from '../../../services/profile-state.service';
import { MatCardModule } from '@angular/material/card';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BookmarkService } from '../../../services/bookmark.service';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { NostrEvent } from '../../../interfaces';

@Component({
  selector: 'app-profile-notes',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    LoadingOverlayComponent,
    MatCardModule,
    UserProfileComponent,
    RouterModule,
    MatTooltipModule,
    AgoPipe,
    MatIconModule,
    MatButtonModule,
    MatSlideToggleModule,
    FormsModule
  ],
  templateUrl: './profile-notes.component.html',
  styleUrl: './profile-notes.component.scss'
})
export class ProfileNotesComponent {
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  profileState = inject(ProfileStateService);
  bookmark = inject(BookmarkService);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  
  // Options
  showNewestFirst = signal<boolean>(true);
  sortedNotes = signal<NostrEvent[]>([]);

  constructor() {
    // Setup effect to sort notes when options or source data changes
    effect(() => {
      const notes = this.profileState.notes();
      const newestFirst = this.showNewestFirst();
      
      // Apply sorting based on options
      if (newestFirst) {
        this.sortedNotes.set([...notes].sort((a, b) => b.created_at - a.created_at));
      } else {
        this.sortedNotes.set([...notes].sort((a, b) => a.created_at - b.created_at));
      }
    });
  }

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }

  toggleSortOrder() {
    this.showNewestFirst.set(!this.showNewestFirst());
  }
}
