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
import { ContentComponent } from '../../../components/content/content.component';
import { LayoutService } from '../../../services/layout.service';

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
    ContentComponent
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
  layout = inject(LayoutService);

  constructor() {
    // this.layout.debugScrollState();

    effect(() => {
      // Only react if scroll monitoring is ready to prevent early triggers
      if (this.layout.scrollMonitoringReady() && this.layout.scrolledToBottom()) {
        console.log('Scrolled to bottom, loading more notes...');

        

      }
    });

    // effect(() => {
    //   // Only react if scroll monitoring is ready to prevent early triggers
    //   if (this.layout.scrollMonitoringReady() && this.layout.scrolledToTop()) {
    //     console.log('Scrolled to top, loading more notes...');
        
    //   }
    // });
  }
}
