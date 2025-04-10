import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatGridListModule } from '@angular/material/grid-list';
import { ActivatedRoute } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { LoadingOverlayComponent } from '../../../components/loading-overlay/loading-overlay.component';

@Component({
  selector: 'app-profile-media',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatGridListModule,
    LoadingOverlayComponent
  ],
  templateUrl: './profile-media.component.html',
  styleUrl: './profile-media.component.scss'
})
export class ProfileMediaComponent {
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);

  isLoading = signal(true);
  media = signal<any[]>([]);
  error = signal<string | null>(null);

  constructor() {
    // Load media when component is initialized
    this.loadMedia();
  }

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }

  async loadMedia(): Promise<void> {
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
      this.media.set([]);
      
      this.logger.debug('Loaded media for pubkey:', pubkey);
    } catch (err) {
      this.logger.error('Error loading media:', err);
      this.error.set('Failed to load media');
    } finally {
      this.isLoading.set(false);
    }
  }
}
