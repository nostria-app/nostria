import { CommonModule } from '@angular/common';
import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ContentComponent } from '../../../components/content/content.component';
import { EventComponent } from '../../../components/event/event.component';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { BookmarkService } from '../../../services/bookmark.service';
import { ProfileStateService } from '../../../services/profile-state.service';

@Component({
  selector: 'app-profile-replies',
  standalone: true,
  imports: [
    EventComponent,
    CommonModule,
    MatIconModule,
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
  ],
  templateUrl: './profile-replies.component.html',
  styleUrl: './profile-replies.component.scss',
})
export class ProfileRepliesComponent {
  private route = inject(ActivatedRoute);
  profileState = inject(ProfileStateService);
  bookmark = inject(BookmarkService);
  error = signal<string | null>(null);

  // Options
  showLegacyReplies = signal<boolean>(false);
  filteredReplies = signal<any[]>([]);

  constructor() {
    // Setup effect to filter replies when options or source data changes
    effect(() => {
      const replies = this.profileState.replies();
      const showLegacy = this.showLegacyReplies();

      // Apply filtering based on options
      if (showLegacy) {
        // Show older replies first or apply other legacy filtering logic
        this.filteredReplies.set(
          [...replies].sort((a, b) => a.event.created_at - b.event.created_at),
        );
      } else {
        // Default sorting (newest first)
        this.filteredReplies.set(
          [...replies].sort((a, b) => b.event.created_at - a.event.created_at),
        );
      }
    });
  }

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }

  toggleLegacyReplies() {
    this.showLegacyReplies.set(!this.showLegacyReplies());
  }
}
