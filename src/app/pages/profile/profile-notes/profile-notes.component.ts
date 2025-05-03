import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { LoadingOverlayComponent } from '../../../components/loading-overlay/loading-overlay.component';
import { ProfileStateService } from '../../../services/profile-state.service';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { UserProfileComponent } from '../../../components/user-profile/user-profile.component';
import { MatButtonModule } from '@angular/material/button';
import { AgoPipe } from '../../../pipes/ago.pipe';
import { DateToggleComponent } from '../../../components/date-toggle/date-toggle.component';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-profile-notes',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    LoadingOverlayComponent,
    MatCardModule,
    MatChipsModule,
    UserProfileComponent,
    MatButtonModule,
    DateToggleComponent,
    RouterModule,
    AgoPipe,
    MatTooltipModule
  ],
  templateUrl: './profile-notes.component.html',
  styleUrl: './profile-notes.component.scss'
})
export class ProfileNotesComponent {
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);
  profileState = inject(ProfileStateService);

  isLoading = signal(true);
  notes = signal<any[]>([]);
  error = signal<string | null>(null);

  constructor() {
    // Use effect to load notes when component is initialized
    this.loadNotes();
  }

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }

  async loadNotes(): Promise<void> {
    const pubkey = this.getPubkey();
    
    if (!pubkey) {
      this.error.set('No pubkey provided');
      this.isLoading.set(false);
      return;
    }

    try {
      this.isLoading.set(true);
      this.error.set(null);
      
      // Mock data for now - would be replaced with actual fetch from NostrService
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Set empty array for now
      this.notes.set([]);
      
      this.logger.debug('Loaded notes for pubkey:', pubkey);
    } catch (err) {
      this.logger.error('Error loading notes:', err);
      this.error.set('Failed to load notes');
    } finally {
      this.isLoading.set(false);
    }
  }
}
