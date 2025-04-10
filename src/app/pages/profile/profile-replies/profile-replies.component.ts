import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { LoadingOverlayComponent } from '../../../components/loading-overlay/loading-overlay.component';

@Component({
  selector: 'app-profile-replies',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    LoadingOverlayComponent
  ],
  templateUrl: './profile-replies.component.html',
  styleUrl: './profile-replies.component.scss'
})
export class ProfileRepliesComponent {
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);

  isLoading = signal(true);
  replies = signal<any[]>([]);
  error = signal<string | null>(null);

  constructor() {
    // Load replies when component is initialized
    this.loadReplies();
  }

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }

  async loadReplies(): Promise<void> {
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
      this.replies.set([]);
      
      this.logger.debug('Loaded replies for pubkey:', pubkey);
    } catch (err) {
      this.logger.error('Error loading replies:', err);
      this.error.set('Failed to load replies');
    } finally {
      this.isLoading.set(false);
    }
  }
}
