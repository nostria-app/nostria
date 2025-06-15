import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { RouterModule } from '@angular/router';
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
import { ContentComponent } from '../../../components/content/content.component';
import { LayoutService } from '../../../services/layout.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

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
    FormsModule,
    ContentComponent,
    MatProgressSpinnerModule
  ],
  templateUrl: './profile-notes.component.html',
  styleUrl: './profile-notes.component.scss'
})
export class ProfileNotesComponent {
  private logger = inject(LoggerService);
  profileState = inject(ProfileStateService);
  bookmark = inject(BookmarkService);
  layout = inject(LayoutService);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);

  constructor() {
    // Effect to handle scroll events from layout service when user scrolls to bottom
    effect(() => {
      // Only react if scroll monitoring is ready to prevent early triggers
      if (this.layout.scrollMonitoringReady() && 
          this.layout.scrolledToBottom() && 
          !this.profileState.isLoadingMoreNotes() &&
          this.profileState.hasMoreNotes() &&
          this.profileState.notes().length > 0) {
        
        this.logger.debug('Scrolled to bottom, loading more notes...');
        this.loadMoreNotes();
      }
    });
  }

  /**
   * Load more notes (older notes)
   */
  async loadMoreNotes(): Promise<void> {
    if (this.profileState.isLoadingMoreNotes()) {
      this.logger.debug('Already loading more notes, skipping');
      return;
    }

    this.logger.debug('Loading more notes for profile');

    try {
      const currentNotes = this.profileState.notes();
      const oldestTimestamp = currentNotes.length > 0
        ? Math.min(...currentNotes.map(n => n.event.created_at)) - 1
        : undefined;

      this.logger.debug(`Current notes count: ${currentNotes.length}, oldest timestamp: ${oldestTimestamp}`);

      // Load older notes from the profile state service
      const olderNotes = await this.profileState.loadMoreNotes(oldestTimestamp);

      this.logger.debug(`Loaded ${olderNotes.length} older notes`);

      if (olderNotes.length === 0) {
        this.logger.debug('No more notes available');
      }

    } catch (err) {
      this.logger.error('Failed to load more notes', err);
      this.error.set('Failed to load older notes. Please try again.');
    }
  }
}
