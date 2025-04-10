import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute } from '@angular/router';
import { NostrService } from '../../../services/nostr.service';
import { LoggerService } from '../../../services/logger.service';
import { LoadingOverlayComponent } from '../../../components/loading-overlay/loading-overlay.component';

@Component({
  selector: 'app-profile-reads',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    LoadingOverlayComponent
  ],
  templateUrl: './profile-reads.component.html',
  styleUrl: './profile-reads.component.scss'
})
export class ProfileReadsComponent {
  private route = inject(ActivatedRoute);
  private nostrService = inject(NostrService);
  private logger = inject(LoggerService);

  isLoading = signal(true);
  reads = signal<any[]>([]);
  error = signal<string | null>(null);

  constructor() {
    // Load reads when component is initialized
    this.loadReads();
  }

  // Get the pubkey from the parent route
  getPubkey(): string {
    return this.route.parent?.snapshot.paramMap.get('id') || '';
  }

  async loadReads(): Promise<void> {
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
      this.reads.set([]);
      
      this.logger.debug('Loaded reads for pubkey:', pubkey);
    } catch (err) {
      this.logger.error('Error loading reads:', err);
      this.error.set('Failed to load reads');
    } finally {
      this.isLoading.set(false);
    }
  }
}
