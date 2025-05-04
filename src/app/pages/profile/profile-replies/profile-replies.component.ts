import { Component, inject, signal } from '@angular/core';
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

@Component({
  selector: 'app-profile-replies',
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
    MatButtonModule
  ],
  templateUrl: './profile-replies.component.html',
  styleUrl: './profile-replies.component.scss'
})
export class ProfileRepliesComponent {
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  profileState = inject(ProfileStateService);
  bookmark = inject(BookmarkService);
  error = signal<string | null>(null);

  constructor() {

  }

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }
}
